import type { GithubRunState } from "#/core/config.js";
import {
	checkActionsOidc,
	checkActionsPermissions,
	checkActionsRetention,
	checkActionsWorkflow,
	checkEnvironments,
} from "#/core/github/actions.js";
import { ApiError, apiJson, repoPath } from "#/core/github/api.js";
import { checkPrChecks, checkReviews, readProtection } from "#/core/github/protection.js";
import {
	checkCodeowners,
	checkGeneral,
	checkIssueTemplates,
	checkReleases,
	checkRulesets,
} from "#/core/github/repo.js";
import { checkSecrets, checkSecurity } from "#/core/github/security.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { baseFor } from "#/core/github/shared.js";
import { resolveTargetRepo } from "#/core/github/target-repo.js";
import type { CheckResult } from "#/core/result.js";
import { failManual, skipped } from "#/core/result.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { findGithubEntry, blueprintRel } from "#/core/upstream/registry.js";
import { fetchGithubSettings, isNotFoundError } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";

export { forkApprovalPolicy } from "#/core/github/actions.js";
export { protectionPutBody } from "#/core/github/protection.js";
export { isPrivateVulnEnabled } from "#/core/github/security.js";

type GithubSettingsResult =
	| { rel: string; upstream: GithubSettings }
	| { rel: string }
	| Record<string, never>;

async function resolveGithubSettings(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<GithubSettingsResult> {
	const entry = findGithubEntry(blueprint, registry);
	if (entry === undefined) {
		return {};
	}
	const rel = blueprintRel(entry.path);
	try {
		const { upstream } = await fetchGithubSettings(id, ref, blueprint, registry);
		return { rel, upstream };
	} catch (error) {
		if (isNotFoundError(error)) {
			return { rel };
		}
		throw error;
	}
}

function checkUiOnly(blueprint: string, upstream: GithubSettings, target: string): CheckResult[] {
	const results: CheckResult[] = [];
	if (upstream.socialPreview) {
		results.push(
			skipped(
				baseFor(blueprint, "social-preview", target),
				"custom preview not readable via API",
				"upload in Settings → General → Social preview",
			),
		);
	}
	results.push(
		skipped(
			baseFor(blueprint, "agent-suggestions", target),
			`agent suggestions not readable via API (want ${upstream.agentSuggestions})`,
			"confirm Agent suggestions for issues in repo Settings",
		),
	);
	const archive = upstream.archiveSettings;
	const archiveWant = [
		`lfs-in-archives: ${String(archive.includeLfsInArchives)}`,
		`commit-comments: ${String(archive.commitComments)}`,
		...(archive.pushUpdateLimit === undefined
			? []
			: [`push-update-limit: ${String(archive.pushUpdateLimit)}`]),
	];
	results.push(
		skipped(
			baseFor(blueprint, "archive-settings", target),
			`archive toggles not readable via API (${archiveWant.join(", ")})`,
			"confirm in Settings → General → Archives/Pushes",
		),
		skipped(
			baseFor(blueprint, "copilot-autofix", target),
			`Copilot Autofix toggle not readable via API (want ${upstream.security.copilotAutofix ? "on" : "off"})`,
			`confirm Copilot Autofix is ${upstream.security.copilotAutofix ? "on" : "off"} in Settings → Code security`,
		),
		...(upstream.security.dependencyAutoSubmit
			? [
					skipped(
						baseFor(blueprint, "dependency-auto-submit", target),
						"dependency auto-submit not readable via repo API",
						"confirm automatic dependency submission in Settings → Code security",
					),
				]
			: []),
	);
	return results;
}

export async function runGithubChecks(
	state: GithubRunState,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	const settings = await resolveGithubSettings(state.id, state.ref, state.blueprint, registry);
	const repo = resolveTargetRepo(state.repo);
	const target = `${repo} (repo settings)`;
	if (!("upstream" in settings)) {
		const base = baseFor(state.blueprint, "settings", target);
		if (!("rel" in settings)) {
			return [
				failManual(
					base,
					"<settings reference missing>",
					`registry github_configs entry for "${state.blueprint}"`,
					`Add "${state.blueprint}" to registry.json github_configs (e.g. "./github-configs/<name>.json", see config/github-manifest.json), then re-check.`,
				),
			];
		}
		return [
			failManual(
				base,
				"<settings file missing>",
				settings.rel,
				`Settings file missing in tech-stack repo: ${settings.rel}`,
			),
		];
	}
	const { upstream } = settings;
	try {
		const read = await readProtection(repo, upstream.defaultBranch);
		// One GET /repos/{repo} shared by checkGeneral and checkSecurity.
		let repoInfo: Promise<Record<string, unknown>> | undefined;
		const getRepoInfo = (): Promise<Record<string, unknown>> => {
			repoInfo ??= apiJson(repoPath(repo, "")) as Promise<Record<string, unknown>>;
			return repoInfo;
		};
		// Listed in report order; mapWithConcurrency keeps that order.
		const checks: Array<() => CheckResult | Promise<CheckResult | CheckResult[]>> = [
			() => checkGeneral(state.blueprint, repo, upstream, target, getRepoInfo),
			() => checkReleases(state.blueprint, repo, upstream, target),
			() => checkCodeowners(state.blueprint, repo, upstream, target),
			() => checkIssueTemplates(state.blueprint, repo, upstream, target),
			() => checkPrChecks(state.blueprint, repo, upstream, read, target),
			() => checkReviews(state.blueprint, repo, upstream, read, target),
			() => checkRulesets(state.blueprint, repo, upstream, target),
			() => checkActionsPermissions(state.blueprint, repo, upstream, target),
			() => checkActionsWorkflow(state.blueprint, repo, upstream, target),
			() => checkActionsRetention(state.blueprint, repo, upstream, target),
			() => checkActionsOidc(state.blueprint, repo, upstream, target),
			() => checkEnvironments(state.blueprint, repo, upstream, target),
			() => checkSecurity(state.blueprint, repo, upstream, target, getRepoInfo),
			() => checkSecrets(state.blueprint, repo, upstream, target),
		];
		const settled = await mapWithConcurrency(checks, 6, (run) => Promise.resolve(run()));
		return [...settled.flat(), ...checkUiOnly(state.blueprint, upstream, target)];
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return [
				skipped(
					baseFor(state.blueprint, "auth", target),
					"cannot read repo settings",
					"set GITHUB_TOKEN (private repo or rate limit)",
				),
			];
		}
		throw error;
	}
}

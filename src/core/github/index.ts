import type { ScopeCheck } from "#/core/config.js";
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
import { resolveTargetRepo } from "#/core/github/target-repo.js";
import type { CheckResult } from "#/core/result.js";
import { checkBase, failManual, skipped } from "#/core/result.js";
import type { TechStack } from "#/core/upstream/tech-stack.js";
import { UpstreamMissingError } from "#/core/upstream/tech-stack.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";

// Lower than upstream fetches: GitHub's secondary rate limits punish bursts.
const GITHUB_API_CONCURRENCY = 6;

type GithubSettingsResult =
	| { rel: string; upstream: GithubSettings }
	| { rel: string }
	| Record<string, never>;

// A missing registry entry or settings file is a manual result with a hint,
// not an internal error: both are blueprint fixes the user can make.
async function resolveGithubSettings(
	techStack: TechStack,
	blueprint: string,
): Promise<GithubSettingsResult> {
	try {
		const { data, rel } = await techStack.blueprint("github_configs", blueprint);
		return { rel, upstream: data };
	} catch (error) {
		if (error instanceof UpstreamMissingError) {
			return error.what === "entry" ? {} : { rel: error.rel };
		}
		throw error;
	}
}

function checkUiOnly(blueprint: string, upstream: GithubSettings, target: string): CheckResult[] {
	const results: CheckResult[] = [];
	if (upstream.socialPreview) {
		results.push(
			skipped(
				checkBase("github", blueprint, "social-preview", target),
				"custom preview not readable via API",
				"upload in Settings → General → Social preview",
			),
		);
	}
	results.push(
		skipped(
			checkBase("github", blueprint, "agent-suggestions", target),
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
			checkBase("github", blueprint, "archive-settings", target),
			`archive toggles not readable via API (${archiveWant.join(", ")})`,
			"confirm in Settings → General → Archives/Pushes",
		),
		skipped(
			checkBase("github", blueprint, "copilot-autofix", target),
			`Copilot Autofix toggle not readable via API (want ${upstream.security.copilotAutofix ? "on" : "off"})`,
			`confirm Copilot Autofix is ${upstream.security.copilotAutofix ? "on" : "off"} in Settings → Code security`,
		),
		...(upstream.security.dependencyAutoSubmit
			? [
					skipped(
						checkBase("github", blueprint, "dependency-auto-submit", target),
						"dependency auto-submit not readable via repo API",
						"confirm automatic dependency submission in Settings → Code security",
					),
				]
			: []),
	);
	return results;
}

// Re-checks whole: one batch of API reads (ADR 0011).
export const runGithubChecks: ScopeCheck = async ({ state, techStack }) => {
	const settings = await resolveGithubSettings(techStack, state.blueprint);
	const repo = resolveTargetRepo(state.repo);
	const target = `${repo} (repo settings)`;
	if (!("upstream" in settings)) {
		const base = checkBase("github", state.blueprint, "settings", target);
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
		const settled = await mapWithConcurrency(checks, GITHUB_API_CONCURRENCY, (run) =>
			Promise.resolve(run()),
		);
		return [...settled.flat(), ...checkUiOnly(state.blueprint, upstream, target)];
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return [
				skipped(
					checkBase("github", state.blueprint, "auth", target),
					"cannot read repo settings",
					"set GITHUB_TOKEN (private repo or rate limit)",
				),
			];
		}
		throw error;
	}
};

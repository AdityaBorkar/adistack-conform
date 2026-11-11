import { ApiError, apiJson, repoPath } from "#/stack/github-api.js";
import {
	checkActionsOidc,
	checkActionsPermissions,
	checkActionsRetention,
	checkActionsWorkflow,
	checkEnvironments,
} from "#/stack/github/actions.js";
import { checkPrChecks, checkReviews, readProtection } from "#/stack/github/protection.js";
import {
	checkCodeowners,
	checkGeneral,
	checkIssueTemplates,
	checkReleases,
	checkRulesets,
} from "#/stack/github/repo.js";
import { checkSecrets, checkSecurity } from "#/stack/github/security.js";
import type { GithubSettings } from "#/stack/github/shared.js";
import { baseFor } from "#/stack/github/shared.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { findGithubEntry, blueprintRel } from "#/stack/registry.js";
import { fetchGithubSettings } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import type { GithubRunState } from "#/utils/config.js";
import { errorMessage } from "#/utils/fs.js";
import { assertRepoId } from "#/utils/net.js";
import type { CheckResult } from "#/utils/result.js";
import { failManual, skipped } from "#/utils/result.js";

export { forkApprovalPolicy } from "#/stack/github/actions.js";
export { protectionPutBody } from "#/stack/github/protection.js";
export { isPrivateVulnEnabled } from "#/stack/github/security.js";

function parseRepoSlug(text: string): string | undefined {
	const cleaned = text
		.trim()
		.replace(/\.git$/u, "")
		.replace(/\/+$/u, "");
	const withPath = /github\.com(?::\d+)?[/:]([^/\s?#]+\/[^/\s?#]+?)(?:[/?#].*)?$/iu.exec(cleaned);
	if (withPath?.[1] !== undefined) {
		return withPath[1];
	}
	const bare = /^([^/\s?#]+\/[^/\s?#]+)$/u.exec(cleaned);
	return bare?.[1];
}

function resolveTargetRepo(configured: string | undefined): string {
	let repo: string;
	if (configured !== undefined && configured !== "") {
		repo = configured;
	} else {
		const fromEnv = process.env["GITHUB_REPOSITORY"];
		if (fromEnv !== undefined && fromEnv !== "") {
			repo = fromEnv;
		} else {
			let slug: string | undefined;
			try {
				const proc = Bun.spawnSync(["git", "remote", "get-url", "origin"]);
				if (proc.exitCode === 0) {
					slug = parseRepoSlug(new TextDecoder().decode(proc.stdout as Uint8Array));
				}
			} catch {
				// Fall through to the error below.
			}
			if (slug === undefined) {
				throw new Error(
					"Cannot determine the GitHub repo to check: set github.repo in conform.json or $GITHUB_REPOSITORY.",
				);
			}
			repo = slug;
		}
	}
	assertRepoId(repo, "GitHub check");
	return repo;
}

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
		if (errorMessage(error).includes("HTTP 404") || errorMessage(error).includes("not found")) {
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
				"custom preview unverifiable via API",
				"upload in Settings → General → Social preview",
			),
		);
	}
	results.push(
		skipped(
			baseFor(blueprint, "agent-suggestions", target),
			`agent suggestions unverifiable via API (want ${upstream.agentSuggestions})`,
			"verify Agent suggestions for issues in repo Settings",
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
			`archive toggles unverifiable via API (${archiveWant.join(", ")})`,
			"verify in Settings → General → Archives/Pushes",
		),
		skipped(
			baseFor(blueprint, "copilot-autofix", target),
			`Copilot Autofix toggle unverifiable via API (want ${upstream.security.copilotAutofix ? "on" : "off"})`,
			`verify Copilot Autofix is ${upstream.security.copilotAutofix ? "on" : "off"} in Settings → Code security`,
		),
		...(upstream.security.dependencyAutoSubmit
			? [
					skipped(
						baseFor(blueprint, "dependency-auto-submit", target),
						"dependency auto-submit unverifiable via repo API",
						"verify automatic dependency submission in Settings → Code security",
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
					`Add "${state.blueprint}" to registry.json github_configs (e.g. "./github-configs/<name>.json", see config/github-manifest.json), then re-run check.`,
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
		const prChecks = checkPrChecks(state.blueprint, repo, upstream, read, target);
		// One GET /repos/{repo} shared by checkGeneral and checkSecurity.
		let repoInfo: Promise<Record<string, unknown>> | undefined;
		const getRepoInfo = (): Promise<Record<string, unknown>> => {
			repoInfo ??= apiJson(repoPath(repo, "")) as Promise<Record<string, unknown>>;
			return repoInfo;
		};
		const checks: Array<() => Promise<CheckResult | CheckResult[]>> = [
			() => checkGeneral(state.blueprint, repo, upstream, target, getRepoInfo),
			() => checkReleases(state.blueprint, repo, upstream, target),
			() => checkCodeowners(state.blueprint, repo, upstream, target),
			() => checkIssueTemplates(state.blueprint, repo, upstream, target),
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
		const settled = await mapWithConcurrency(checks, 6, (run) => run());
		const [
			general,
			releases,
			codeowners,
			issueTemplates,
			reviews,
			rulesets,
			permissions,
			workflow,
			retention,
			oidc,
			environments,
			security,
			secrets,
		] = settled as [
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult,
			CheckResult[],
			CheckResult,
		];
		return [
			general,
			releases,
			codeowners,
			issueTemplates,
			prChecks,
			reviews,
			rulesets,
			permissions,
			workflow,
			retention,
			oidc,
			environments,
			...security,
			secrets,
			...checkUiOnly(state.blueprint, upstream, target),
		];
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return [
				skipped(
					baseFor(state.blueprint, "auth", target),
					"cannot read repo settings",
					"set GITHUB_TOKEN to verify (private repo or rate limit)",
				),
			];
		}
		throw error;
	}
}

export function recheckGithubSelected(
	state: GithubRunState,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	if (![...selectedIds].some((id) => id.startsWith(`github:${state.blueprint}:`))) {
		return Promise.resolve([]);
	}
	return runGithubChecks(state, registry);
}

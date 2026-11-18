import type { ScopeCheck } from "#/core/config.js";
import {
	checkAccess,
	checkInteractionLimits,
	checkRequiredWorkflows,
} from "#/core/github/access.js";
import {
	checkActionsOidc,
	checkActionsPermissions,
	checkActionsRetention,
	checkActionsWorkflow,
	checkEnvironmentProtection,
	checkEnvironments,
	checkRunners,
} from "#/core/github/actions.js";
import { ApiError, apiJson, repoPath } from "#/core/github/api.js";
import { checkAutolinks } from "#/core/github/autolinks.js";
import {
	checkCodespaces,
	checkCommunity,
	checkDeployKeys,
	checkTagProtection,
} from "#/core/github/community.js";
import { checkPages } from "#/core/github/pages.js";
import { checkPrChecks, checkReviews, readProtection } from "#/core/github/protection.js";
import {
	checkCodeowners,
	checkCustomProperties,
	checkGeneral,
	checkIssueTemplates,
	checkMergeQueue,
	checkReleases,
	checkRulesets,
} from "#/core/github/repo.js";
import { checkSecrets, checkSecurity } from "#/core/github/security.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { resolveTargetRepo } from "#/core/github/target-repo.js";
import { checkWebhooks } from "#/core/github/webhooks.js";
import type { CheckResult } from "#/core/result.js";
import { checkBase, failManual, pass, skipped } from "#/core/result.js";
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
	} else {
		results.push(
			pass(
				checkBase("github", blueprint, "social-preview", target),
				"social preview off",
				"social preview match",
			),
		);
	}
	if (upstream.features.sponsorships) {
		results.push(
			skipped(
				checkBase("github", blueprint, "sponsorships", target),
				"sponsor button not readable via API (want on)",
				"confirm the Sponsor button is displayed in Settings → General → Sponsorships",
			),
		);
	} else {
		results.push(
			pass(
				checkBase("github", blueprint, "sponsorships", target),
				"sponsorships off",
				"sponsorships match",
			),
		);
	}
	if (upstream.planning.agentSuggestions === "disabled") {
		results.push(
			pass(
				checkBase("github", blueprint, "agent-suggestions", target),
				"agent suggestions disabled",
				"agent suggestions match",
			),
		);
	} else {
		results.push(
			skipped(
				checkBase("github", blueprint, "agent-suggestions", target),
				`agent suggestions not readable via API (want ${upstream.planning.agentSuggestions})`,
				"confirm automation level in Settings → Planning → Agent suggestions for issues (Full control, Cautious, Balanced, Full automation)",
			),
		);
	}
	const archive = upstream.archiveSettings;
	const archiveOff =
		!archive.includeLfsInArchives && !archive.commitComments && archive.pushUpdateLimit === null;
	if (archiveOff) {
		results.push(
			pass(
				checkBase("github", blueprint, "archive-settings", target),
				"archive toggles off",
				"archive toggles match",
			),
		);
	} else {
		const archiveWant = [
			`lfs-in-archives: ${String(archive.includeLfsInArchives)}`,
			`commit-comments: ${String(archive.commitComments)}`,
			...(archive.pushUpdateLimit === null
				? []
				: [`push-update-limit: ${String(archive.pushUpdateLimit)}`]),
		];
		results.push(
			skipped(
				checkBase("github", blueprint, "archive-settings", target),
				`archive toggles not readable via API (${archiveWant.join(", ")})`,
				"confirm in Settings → General → Archives/Pushes",
			),
		);
	}
	if (upstream.security.copilotAutofix) {
		results.push(
			skipped(
				checkBase("github", blueprint, "copilot-autofix", target),
				"Copilot Autofix toggle not readable via API (want on)",
				"confirm Copilot Autofix is on in Settings → Code security",
			),
		);
	} else {
		results.push(
			pass(
				checkBase("github", blueprint, "copilot-autofix", target),
				"copilot autofix off",
				"copilot autofix match",
			),
		);
	}
	if (upstream.notificationEmail !== undefined) {
		results.push(
			skipped(
				checkBase("github", blueprint, "notifications", target),
				`notification email ${upstream.notificationEmail} not readable via API`,
				"confirm the custom notification email in Settings → Notifications",
			),
		);
	}
	if (upstream.pullRequestLimits !== undefined) {
		const pr = upstream.pullRequestLimits;
		const want = [
			...(pr.maxOpen === undefined ? [] : [`max-open: ${String(pr.maxOpen)}`]),
			...(pr.countDrafts === undefined ? [] : [`count-drafts: ${String(pr.countDrafts)}`]),
			...(pr.minAccountAgeDays === undefined
				? []
				: [`min-age-days: ${String(pr.minAccountAgeDays)}`]),
			...(pr.minMergedPRs === undefined ? [] : [`min-merged: ${String(pr.minMergedPRs)}`]),
		].join(", ");
		results.push(
			skipped(
				checkBase("github", blueprint, "pull-request-limits", target),
				`pull request limits not readable via repo API (want ${want || "set"})`,
				"confirm in Settings → Moderation → Interaction limits → Pull request limits",
			),
		);
	}
	if (upstream.security.dependencyAutoSubmit) {
		results.push(
			skipped(
				checkBase("github", blueprint, "dependency-auto-submit", target),
				"dependency auto-submit not readable via repo API",
				"confirm automatic dependency submission in Settings → Code security",
			),
		);
	} else {
		results.push(
			pass(
				checkBase("github", blueprint, "dependency-auto-submit", target),
				"dependency auto-submit off",
				"dependency auto-submit match",
			),
		);
	}
	if (upstream.features.issues.autoClose !== undefined) {
		results.push(
			skipped(
				checkBase("github", blueprint, "auto-close", target),
				`auto-close linked issues not readable via repo API (want ${String(upstream.features.issues.autoClose)})`,
				"confirm in Settings → General → Issues → auto-close with merged linked pull requests",
			),
		);
	}
	if (upstream.features.issues.permissions !== undefined) {
		results.push(
			skipped(
				checkBase("github", blueprint, "issue-permissions", target),
				`issue permissions not readable via repo API (want ${upstream.features.issues.permissions})`,
				"confirm in Settings → General → Features → Issue permissions",
			),
		);
	}
	if (upstream.pullRequests.permissions !== undefined) {
		results.push(
			skipped(
				checkBase("github", blueprint, "pr-permissions", target),
				`pull request permissions not readable via repo API (want ${upstream.pullRequests.permissions})`,
				"confirm in Settings → General → Features → Pull request permissions",
			),
		);
	}
	if (upstream.actionsPolicies !== undefined && upstream.actionsPolicies.length > 0) {
		results.push(
			skipped(
				checkBase("github", blueprint, "actions-policies", target),
				`actions policies not readable via repo API (want ${upstream.actionsPolicies.join(", ")})`,
				"confirm in Settings → Actions → Policies",
			),
		);
	}
	if (upstream.copilot !== undefined) {
		const want = [
			...(upstream.copilot.codeReview === undefined
				? []
				: [`code-review: ${String(upstream.copilot.codeReview)}`]),
			...(upstream.copilot.codingAgent === undefined
				? []
				: [`coding-agent: ${String(upstream.copilot.codingAgent)}`]),
			...(upstream.copilot.internetAccessFirewall === undefined
				? []
				: [`internet-firewall: ${String(upstream.copilot.internetAccessFirewall)}`]),
			...(upstream.copilot.mcp === undefined ? [] : [`mcp: ${String(upstream.copilot.mcp)}`]),
			...(upstream.copilot.memory === undefined
				? []
				: [`memory: ${String(upstream.copilot.memory)}`]),
		].join(", ");
		results.push(
			skipped(
				checkBase("github", blueprint, "copilot", target),
				`copilot settings not readable via repo API (want ${want || "set"})`,
				"confirm in Settings → Copilot (code review, coding agent, internet access, MCP, memory)",
			),
		);
	}
	if (upstream.githubApps !== undefined && upstream.githubApps.length > 0) {
		results.push(
			skipped(
				checkBase("github", blueprint, "github-apps", target),
				`installed GitHub Apps not manageable via repo API (want ${upstream.githubApps.join(", ")})`,
				"confirm in Settings → Integrations → GitHub Apps (install via UI/marketplace)",
			),
		);
	}
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
			() => checkCustomProperties(state.blueprint, repo, upstream, target),
			() => checkAccess(state.blueprint, repo, upstream, target),
			() => checkInteractionLimits(state.blueprint, repo, upstream, target),
			() => checkReleases(state.blueprint, repo, upstream, target),
			() => checkCodeowners(state.blueprint, repo, upstream, target),
			() => checkIssueTemplates(state.blueprint, repo, upstream, target),
			() => checkCommunity(state.blueprint, repo, upstream, target),
			() => checkCodespaces(state.blueprint, repo, upstream, target),
			() => checkPrChecks(state.blueprint, repo, upstream, read, target),
			() => checkReviews(state.blueprint, repo, upstream, read, target),
			() => checkTagProtection(state.blueprint, repo, upstream, target),
			() => checkRulesets(state.blueprint, repo, upstream, target),
			() => checkRequiredWorkflows(state.blueprint, repo, upstream, target),
			() => checkMergeQueue(state.blueprint, repo, upstream, target),
			() => checkActionsPermissions(state.blueprint, repo, upstream, target),
			() => checkActionsWorkflow(state.blueprint, repo, upstream, target),
			() => checkActionsRetention(state.blueprint, repo, upstream, target),
			() => checkActionsOidc(state.blueprint, repo, upstream, target),
			() => checkRunners(state.blueprint, repo, upstream, target),
			() => checkEnvironments(state.blueprint, repo, upstream, target),
			() => checkEnvironmentProtection(state.blueprint, repo, upstream, target),
			() => checkPages(state.blueprint, repo, upstream, target),
			() => checkSecurity(state.blueprint, repo, upstream, target, getRepoInfo),
			() => checkDeployKeys(state.blueprint, repo, upstream, target),
			() => checkSecrets(state.blueprint, repo, upstream, target),
			() => checkWebhooks(state.blueprint, repo, upstream, target),
			() => checkAutolinks(state.blueprint, repo, upstream, target),
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

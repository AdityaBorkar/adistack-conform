import type { ScopeCheck } from "#/core/config.js";
import { checkAccess, checkInteractionLimits } from "#/core/github/access.js";
import {
	checkActionsAccess,
	checkActionsCache,
	checkActionsForkPrPrivate,
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
	checkDependabotVersionUpdates,
	checkDeployKeys,
} from "#/core/github/community.js";
import { checkCopilotCloud, checkCopilotCodeReview } from "#/core/github/copilot.js";
import { checkPages } from "#/core/github/pages.js";
import { checkPrChecks, checkReviews, readProtection } from "#/core/github/protection.js";
import {
	checkCodeowners,
	checkCustomProperties,
	checkGeneral,
	checkIssueTemplates,
	checkReleases,
} from "#/core/github/repo.js";
import { checkRulesets } from "#/core/github/rulesets.js";
import {
	checkAiScan,
	checkCodeScanning,
	checkDependabotRunner,
	checkDependencyGraph,
	checkSecrets,
	checkSecurity,
} from "#/core/github/security.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { uiOnly } from "#/core/github/shared.js";
import { resolveTargetRepo } from "#/core/github/target-repo.js";
import { checkWebhooks } from "#/core/github/webhooks.js";
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

type Item = [label: string, value: unknown, off: unknown];
type UiCheck = [id: string, path: string, items: Item[]];

// UI-only settings (no API), grouped by result id, in sidebar order. Each item
// passes at its off value (undefined off = any set value skips).
function uiChecks(upstream: GithubSettings): UiCheck[] {
	const { access, actions, advanced_security: adv, codespaces, copilot, planning, ...g } = upstream;
	const moderation = access?.moderation;
	const pvr = adv.private_vulnerability_reporting;
	const prLimits = moderation?.pull_request_limits;
	return [
		["social-preview", "General → Social preview", [["custom image", g.social_preview, false]]],
		[
			"wiki-editing",
			"General → Features → Wikis → Restrict editing to collaborators only",
			[["restrict editing", g.features.wikis.restrict_editing_to_collaborators, false]],
		],
		[
			"issue-permissions",
			"General → Features → Issues → Issue permissions",
			[["issue permissions", g.features.issues.permissions, undefined]],
		],
		[
			"sponsorships",
			"General → Features → Sponsorships",
			[["sponsor button", g.features.sponsorships, false]],
		],
		[
			"preserve-repository",
			"General → Features → Preserve this repository",
			[["preserve", g.features.preserve_repository, undefined]],
		],
		[
			"archive-settings",
			"General → Commits / Archives / Pushes",
			[
				["commit comments", g.commits.comments_allowed, false],
				["LFS in archives", g.archives.include_lfs_objects, false],
				["push update limit", g.pushes.update_limit, null],
			],
		],
		[
			"auto-close",
			"General → Issues → Auto-close issues with merged linked pull requests",
			[["auto-close", g.features.issues.auto_close, undefined]],
		],
		[
			"branch-protection-disabled",
			"General → Danger Zone → Disable branch protection rules",
			[["disabled", g.danger_zone?.branch_protection_rules_disabled, false]],
		],
		[
			"pull-request-limits",
			"Access → Moderation → Interaction limits → Pull request limits",
			[
				["max-open", prLimits?.max_open, undefined],
				["count-drafts", prLimits?.count_drafts, undefined],
				["min-age-days", prLimits?.min_account_age_days, undefined],
				["min-merged", prLimits?.min_merged_prs, undefined],
			],
		],
		[
			"code-review-limits",
			"Access → Moderation → Code review limits",
			[
				[
					"restrict to explicit access",
					moderation?.code_review_limits?.restrict_to_explicit_access,
					false,
				],
			],
		],
		["actions-policies", "Actions → Policies", [["policies", actions.policies, []]]],
		[
			"copilot",
			"Copilot → Code review / Cloud / Internet access / Memory / Dreaming",
			[
				["max review effort", copilot?.code_review?.max_review_effort, "no-limit"],
				["secret protection AI scan", copilot?.code_review?.secret_protection_ai_scan, false],
				["allow approvals", copilot?.code_review?.allow_approvals, false],
				["block external license", copilot?.code_review?.block_external_license, false],
				["sandbox size", copilot?.cloud?.sandbox_size, "default"],
				["shared automations", copilot?.cloud?.automations?.shared, false],
				[
					"only update triggering resource",
					copilot?.cloud?.automations?.only_update_triggering_resource,
					false,
				],
				[
					"workflow approval on automation PRs",
					copilot?.cloud?.automations?.require_workflow_approval_on_prs,
					false,
				],
				["code review firewall", copilot?.internet_access?.code_review?.firewall, false],
				[
					"code review recommended allowlist",
					copilot?.internet_access?.code_review?.recommended_allowlist,
					false,
				],
				[
					"code review custom allowlist",
					copilot?.internet_access?.code_review?.custom_allowlist,
					[],
				],
				["memory", copilot?.memory?.enabled, false],
				["dreaming", copilot?.dreaming?.enabled, false],
			],
		],
		[
			"agent-suggestions",
			"Planning → Agent suggestions for issues → Automation level",
			[["automation level", planning?.agent_suggestions, "cautious"]],
		],
		[
			"codespaces-prebuilds",
			"Codespaces → Prebuild configuration",
			[["prebuilds", codespaces?.prebuilds?.map((entry) => entry.branch), []]],
		],
		[
			"pvr-settings",
			"Advanced Security → Private vulnerability reporting → Settings",
			[
				["require CWE", pvr.require_cwe, false],
				["daily limit", pvr.daily_limit, 10],
				["trusted reporters", pvr.trusted_reporters, []],
			],
		],
		[
			"dependency-auto-submit",
			"Advanced Security → Dependency Scanning → Automatic dependency submission",
			[["automatic dependency submission", adv.automatic_dependency_submission, "disabled"]],
		],
		[
			"dependabot-rules",
			"Advanced Security → Dependabot → Dependabot auto-triage rules",
			[
				[
					"dismiss low-impact dev alerts",
					adv.dependabot.rules?.dismiss_low_impact_dev_alerts,
					false,
				],
				[
					"dismiss package malware alerts",
					adv.dependabot.rules?.dismiss_package_malware_alerts,
					false,
				],
				["custom rules", adv.dependabot.rules?.custom, []],
			],
		],
		[
			"copilot-autofix",
			"Advanced Security → Code Security → AI Scan → Copilot Autofix",
			[["copilot autofix", adv.code_scanning.copilot_autofix, false]],
		],
		[
			"advanced-security-ui",
			"Advanced Security (Dependabot malware/grouped updates, AI Scan, Protection rules)",
			[
				["malware alerts", adv.dependabot.malware_alerts, false],
				["grouped security updates", adv.dependabot.grouped_security_updates, false],
				["scan for AI applications", adv.code_scanning.ai_applications, false],
				["agentic autofix", adv.code_scanning.agentic_autofix, false],
				["check run thresholds", adv.code_scanning.check_run_thresholds, undefined],
			],
		],
		[
			"github-apps",
			"Integrations → GitHub Apps (install via the UI/marketplace)",
			[["apps", upstream.integrations?.github_apps, []]],
		],
		[
			"notifications",
			"Integrations → Email notifications (/settings/notifications)",
			[["email notifications", upstream.integrations?.email_notifications, undefined]],
		],
	];
}

function checkUiOnly(blueprint: string, upstream: GithubSettings, target: string): CheckResult[] {
	return uiChecks(upstream).flatMap(
		([id, path, items]) => uiOnly(checkBase("github", blueprint, id, target), path, items) ?? [],
	);
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
		const bp = state.blueprint;
		const branches = upstream.branches;
		const branch = upstream.default_branch;
		const read = branches === undefined ? undefined : await readProtection(repo, branch);
		// One GET /repos/{repo} shared by the checks that read it.
		let repoInfo: Promise<Record<string, unknown>> | undefined;
		const getRepoInfo = (): Promise<Record<string, unknown>> => {
			repoInfo ??= apiJson(repoPath(repo, "")) as Promise<Record<string, unknown>>;
			return repoInfo;
		};
		// Sidebar order; mapWithConcurrency keeps it. `undefined` = section not managed.
		type Check = CheckResult | CheckResult[] | undefined;
		const checks: Array<() => Check | Promise<Check>> = [
			() => checkGeneral(bp, repo, upstream, target, getRepoInfo),
			() => checkReleases(bp, repo, upstream, target),
			() => checkCustomProperties(bp, repo, upstream, target),
			() => checkAccess(bp, repo, upstream, target),
			() => checkInteractionLimits(bp, repo, upstream, target),
			() => checkRulesets(bp, repo, upstream, target),
			() =>
				branches === undefined || read === undefined
					? undefined
					: checkPrChecks(bp, repo, branch, branches, read, target),
			() =>
				branches === undefined || read === undefined
					? undefined
					: checkReviews(bp, repo, branch, branches, read, target),
			() => checkActionsPermissions(bp, repo, upstream, target),
			() => checkActionsWorkflow(bp, repo, upstream, target),
			() => checkActionsRetention(bp, repo, upstream, target),
			() => checkActionsForkPrPrivate(bp, repo, upstream, target),
			() => checkActionsAccess(bp, repo, upstream, target),
			() => checkActionsCache(bp, repo, upstream, target),
			() => checkRunners(bp, repo, upstream, target),
			() => checkActionsOidc(bp, repo, upstream, target),
			() => checkWebhooks(bp, repo, upstream, target),
			() => checkCopilotCodeReview(bp, repo, upstream, target),
			() => checkCopilotCloud(bp, repo, upstream, target),
			() => checkEnvironments(bp, repo, upstream, target),
			() => checkEnvironmentProtection(bp, repo, upstream, target),
			() => checkCodespaces(bp, repo, upstream, target),
			() => checkPages(bp, repo, upstream, target),
			() => checkSecurity(bp, repo, upstream, target, getRepoInfo),
			() => checkDependencyGraph(bp, upstream, target, getRepoInfo),
			() => checkDependabotVersionUpdates(bp, repo, upstream, target),
			() => checkDependabotRunner(bp, repo, upstream, target),
			() => checkCodeScanning(bp, repo, upstream, target),
			() => checkAiScan(bp, repo, upstream, target),
			() => checkDeployKeys(bp, repo, upstream, target),
			() => checkSecrets(bp, repo, upstream, target),
			() => checkAutolinks(bp, repo, upstream, target),
			() => checkCommunity(bp, repo, upstream, target),
			() => checkCodeowners(bp, repo, upstream, target),
			() => checkIssueTemplates(bp, repo, upstream, target),
		];
		const settled = await mapWithConcurrency(checks, GITHUB_API_CONCURRENCY, (run) =>
			Promise.resolve(run()),
		);
		return [
			...settled.flat().filter((result) => result !== undefined),
			...checkUiOnly(bp, upstream, target),
		];
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

import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

export function forkApprovalPolicy(approvalForExternal: boolean): string {
	return approvalForExternal ? "all_external_contributors" : "first_time_contributors";
}

export async function checkActionsPermissions(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-permissions", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions"))) as Record<string, unknown>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read Actions permissions",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	const compare = (key: string, want: unknown): void => {
		if (!Object.is(actual[key], want)) {
			diffs.push(`${key}: ${String(actual[key])} → ${String(want)}`);
			body[key] = want;
		}
	};
	compare("enabled", true);
	compare("allowed_actions", upstream.actions.allowed);
	compare("sha_pinning_required", upstream.actions.shaPinningRequired);
	const steps: GithubApiStep[] = [];
	if (diffs.length > 0) {
		steps.push({ body, method: "PUT", path: repoPath(repo, "/actions/permissions") });
	}
	if (upstream.actions.selectedPatterns !== undefined) {
		if (upstream.actions.allowed !== "selected") {
			return failManual(
				base,
				`selected patterns pinned but allowed is ${upstream.actions.allowed}`,
				"actions permissions match",
				"Set actions.allowed to selected to enforce selectedPatterns, then re-check.",
			);
		}
		try {
			const selected = (await apiJson(repoPath(repo, "/actions/permissions/selected-actions"))) as {
				patterns_allowed?: unknown;
			};
			const have = Array.isArray(selected.patterns_allowed)
				? selected.patterns_allowed.map(String).toSorted()
				: [];
			const want = [...upstream.actions.selectedPatterns].toSorted();
			if (JSON.stringify(have) !== JSON.stringify(want)) {
				diffs.push(`patterns: ${have.join(", ") || "<none>"} → ${want.join(", ")}`);
				steps.push({
					body: { patterns_allowed: upstream.actions.selectedPatterns },
					method: "PUT",
					path: repoPath(repo, "/actions/permissions/selected-actions"),
				});
			}
		} catch (error) {
			if (isAuthError(error)) {
				return skipped(
					base,
					"cannot read selected actions",
					"set GITHUB_TOKEN (private repo or rate limit)",
				);
			}
			throw error;
		}
	}
	if (diffs.length === 0) {
		return pass(base, "actions permissions match", "actions permissions match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} actions permissions`,
		steps,
	};
	return failFixable(base, diffs.join("; "), "actions permissions match", fix);
}

export async function checkActionsWorkflow(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-workflow", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions/workflow"))) as Record<
			string,
			unknown
		>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read workflow permissions",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	const compare = (key: string, want: unknown): void => {
		if (!Object.is(actual[key], want)) {
			diffs.push(`${key}: ${String(actual[key])} → ${String(want)}`);
			body[key] = want;
		}
	};
	compare("default_workflow_permissions", upstream.actions.defaultWorkflowPermissions);
	compare("can_approve_pull_request_reviews", upstream.actions.allowApprovePRs);
	const wantFork = forkApprovalPolicy(upstream.actions.approvalForExternal);
	let forkDiff = "";
	let forkUnknown = false;
	try {
		const fork = (await apiJson(
			repoPath(repo, "/actions/permissions/fork-pr-contributor-approval"),
			{
				allowStatuses: [404],
			},
		)) as Record<string, unknown> | undefined;
		if (fork === undefined) {
			forkUnknown = true;
		} else {
			const have = String(fork["approval_policy"] ?? fork["policy"] ?? "unknown");
			const forkOk = upstream.actions.approvalForExternal
				? have === wantFork
				: have === "first_time_contributors" || have === "first_time_contributors_new_to_github";
			if (!forkOk) {
				forkDiff = `fork approval: ${have} → ${wantFork}`;
			}
		}
	} catch (error) {
		if (isAuthError(error)) {
			forkDiff = "";
		} else {
			throw error;
		}
	}
	if (diffs.length === 0 && forkDiff === "") {
		if (forkUnknown) {
			return skipped(
				base,
				"cannot read fork approval policy",
				"confirm fork PR approval in Settings → Actions",
			);
		}
		return pass(base, "workflow permissions match", "workflow permissions match");
	}
	const steps: GithubApiStep[] = [];
	if (diffs.length > 0) {
		steps.push({ body, method: "PUT", path: repoPath(repo, "/actions/permissions/workflow") });
	}
	if (forkDiff !== "") {
		steps.push({
			body: { approval_policy: wantFork },
			method: "PUT",
			path: repoPath(repo, "/actions/permissions/fork-pr-contributor-approval"),
		});
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} workflow permissions`,
		steps,
	};
	const result = failFixable(
		base,
		forkDiff === ""
			? diffs.join("; ")
			: diffs.length === 0
				? forkDiff
				: `${diffs.join("; ")}; ${forkDiff}`,
		"workflow permissions match",
		fix,
	);
	if (forkUnknown) {
		result.hint = "Fork approval policy is unconfirmed; confirm it in Settings → Actions.";
	}
	return result;
}

export async function checkActionsRetention(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-retention", target);
	let actual: { days?: unknown };
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions/artifact-and-log-retention"))) as {
			days?: unknown;
		};
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read retention policy",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	if (Object.is(actual.days, upstream.actions.retentionDays)) {
		return pass(base, `retention ${String(actual.days)}d`, "retention matches");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} retention ${upstream.actions.retentionDays}d`,
		steps: [
			{
				body: { days: upstream.actions.retentionDays },
				method: "PUT",
				path: repoPath(repo, "/actions/permissions/artifact-and-log-retention"),
			},
		],
	};
	return failFixable(
		base,
		`retention ${String(actual.days)}d`,
		`retention ${upstream.actions.retentionDays}d`,
		fix,
	);
}

export async function checkActionsOidc(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-oidc", target);
	if (!upstream.actions.oidcImmutableSubject) {
		return pass(base, "immutable OIDC subject not required", "OIDC matches");
	}
	// Check-only: the customization endpoint has no documented immutable-subject mapping.
	let current: unknown;
	try {
		current = await apiJson(repoPath(repo, "/actions/oidc/customization/sub"), {
			allowStatuses: [404],
		});
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"OIDC customization unavailable",
				"confirm in Settings → Actions → OIDC",
			);
		}
		throw error;
	}
	if (current === undefined) {
		return skipped(base, "OIDC customization unavailable", "confirm in Settings → Actions → OIDC");
	}
	return skipped(
		base,
		`customization: ${JSON.stringify(current).slice(0, 120)}`,
		"confirm immutable subject claim in Settings → Actions → OIDC",
	);
}

export async function checkEnvironments(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "environments", target);
	if (upstream.environments.length === 0) {
		return pass(base, "no environments required", "environments match");
	}
	let names: string[];
	try {
		const items = (await apiJsonPaged(repoPath(repo, "/environments"), "environments")) as Array<{
			name?: unknown;
		}>;
		names = items.map((entry) => String(entry.name));
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot list environments",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const missing = upstream.environments.filter((name) => !names.includes(name));
	if (missing.length === 0) {
		return pass(base, `environments: ${names.join(", ")}`, "environments match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} environments (${missing.join(", ")})`,
		steps: missing.map((name) => ({
			method: "PUT" as const,
			path: repoPath(repo, `/environments/${encodeURIComponent(name)}`),
		})),
	};
	return failFixable(
		base,
		`missing: ${missing.join(", ")}`,
		`environments: ${upstream.environments.join(", ")}`,
		fix,
	);
}

// Actions → Runners (/settings/actions/runners). Runners are ephemeral hosts,
// so this is a presence audit: required names must be registered. Registering
// needs the host setup script, so the fix stays manual.
export async function checkRunners(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "runners", target);
	const want = upstream.runners ?? [];
	if (want.length === 0) {
		return pass(base, "no runners required", "runners match");
	}
	let names: string[];
	try {
		const res = (await apiJson(repoPath(repo, "/actions/runners?per_page=100"))) as {
			runners?: Array<{ name?: unknown }>;
		};
		names = Array.isArray(res.runners) ? res.runners.map((entry) => String(entry.name)) : [];
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list runners", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	const missing = want.filter((name) => !names.includes(name));
	if (missing.length === 0) {
		return pass(base, `runners: ${want.join(", ")}`, "runners match");
	}
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		`runners: ${want.join(", ")}`,
		`Register runner(s) ${missing.join(", ")} in Settings → Actions → Runners (run the setup script on the host), then re-check.`,
	);
}

interface EnvironmentState {
	deployment_branch_policy?: {
		custom_branch_policies?: unknown;
		protected_branches?: unknown;
	} | null;
	preventSelfReview?: boolean;
	protection_rules?: Array<{
		prevent_self_review?: unknown;
		reviewers?: Array<{ reviewer?: { login?: unknown; slug?: unknown }; type?: unknown }>;
		type?: unknown;
		wait_timer?: unknown;
	}>;
	waitMinutes?: number;
}

function branchPolicyType(
	state: Pick<EnvironmentState, "deployment_branch_policy">,
): "all" | "protected" | "selected" {
	if (
		state.deployment_branch_policy !== null &&
		state.deployment_branch_policy !== undefined &&
		state.deployment_branch_policy.custom_branch_policies === true
	) {
		return "selected";
	}
	if (
		state.deployment_branch_policy !== null &&
		state.deployment_branch_policy !== undefined &&
		state.deployment_branch_policy.protected_branches === true
	) {
		return "protected";
	}
	return "all";
}

function readEnvironmentState(current: Record<string, unknown>): EnvironmentState {
	const rules = Array.isArray(current["protection_rules"])
		? (current["protection_rules"] as EnvironmentState["protection_rules"])
		: [];
	let waitMinutes: number | undefined;
	let preventSelfReview: boolean | undefined;
	const reviewers: Array<{ reviewer?: { login?: unknown; slug?: unknown }; type?: unknown }> = [];
	for (const rule of rules ?? []) {
		if (typeof rule?.wait_timer === "number") {
			waitMinutes = rule.wait_timer;
		}
		if (typeof rule?.prevent_self_review === "boolean") {
			preventSelfReview = rule.prevent_self_review;
		}
		if (Array.isArray(rule?.reviewers)) {
			reviewers.push(...rule.reviewers);
		}
	}
	const policy =
		current["deployment_branch_policy"] === null ||
		typeof current["deployment_branch_policy"] === "object"
			? (current["deployment_branch_policy"] as EnvironmentState["deployment_branch_policy"])
			: undefined;
	return {
		deployment_branch_policy: policy,
		preventSelfReview,
		protection_rules: rules,
		waitMinutes,
	};
}

function reviewerNames(reviewers: NonNullable<EnvironmentState["protection_rules"]>): string[] {
	return reviewers.flatMap((rule) =>
		(Array.isArray(rule?.reviewers) ? rule.reviewers : []).map((entry) =>
			entry?.type === "Team"
				? String(entry.reviewer?.slug ?? "")
				: String(entry.reviewer?.login ?? ""),
		),
	);
}

// Environments → protection rules (per-environment page). Wait timer, self-review
// and branch policy fix via PUT; reviewers resolve user/team IDs via the API;
// branch patterns fix via POST. Unresolvable reviewers fall back to manual.
async function resolveReviewerIds(
	owner: string,
	reviewers: Array<{ name: string; type: "team" | "user" }>,
): Promise<Array<{ id: number; type: string }> | undefined> {
	const resolved = await Promise.all(
		reviewers.map(async (reviewer) => {
			const found =
				reviewer.type === "user"
					? ((await apiJson(`/users/${encodeURIComponent(reviewer.name)}`, {
							allowStatuses: [404],
						})) as { id?: unknown } | undefined)
					: ((await apiJson(
							`/orgs/${encodeURIComponent(owner)}/teams/${encodeURIComponent(reviewer.name)}`,
							{ allowStatuses: [404] },
						)) as { id?: unknown } | undefined);
			if (typeof found?.id !== "number") {
				return;
			}
			return { id: found.id, type: reviewer.type === "user" ? "User" : "Team" };
		}),
	);
	if (resolved.some((entry) => entry === undefined)) {
		return undefined;
	}
	return resolved as Array<{ id: number; type: string }>;
}

async function missingBranchPatterns(
	repo: string,
	env: string,
	patterns: string[],
): Promise<string[]> {
	const policies = (await apiJsonPaged(
		repoPath(repo, `/environments/${encodeURIComponent(env)}/deployment-branch-policies`),
	)) as Array<{ name?: unknown }>;
	const have = new Set(policies.map((policy) => String(policy.name)));
	return patterns.filter((name) => !have.has(name));
}

interface EnvDiff {
	diffs: string[];
	manualNote?: string;
	steps: GithubApiStep[];
}

async function diffOneEnvironment(
	repo: string,
	owner: string,
	env: string,
	entry: NonNullable<NonNullable<GithubSettings["environmentProtection"]>[string]>,
): Promise<EnvDiff> {
	const current = (await apiJson(repoPath(repo, `/environments/${encodeURIComponent(env)}`), {
		allowStatuses: [404],
	})) as Record<string, unknown> | undefined;
	const state = current === undefined ? undefined : readEnvironmentState(current);
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	const body: Record<string, unknown> = {};
	let manualNote: string | undefined;
	if (entry.waitMinutes !== undefined && state?.waitMinutes !== entry.waitMinutes) {
		diffs.push(`${env} wait: ${String(state?.waitMinutes)} → ${entry.waitMinutes}m`);
		body["wait_timer"] = entry.waitMinutes;
	}
	if (
		entry.preventSelfReview !== undefined &&
		state?.preventSelfReview !== entry.preventSelfReview
	) {
		diffs.push(
			`${env} self-review: ${String(state?.preventSelfReview)} → ${String(entry.preventSelfReview)}`,
		);
		body["prevent_self_review"] = entry.preventSelfReview;
	}
	if (entry.requiredReviewers !== undefined) {
		const have = state === undefined ? [] : reviewerNames(state.protection_rules ?? []).toSorted();
		const wantNames = entry.requiredReviewers
			.map((reviewer) => `${reviewer.type}:${reviewer.name}`)
			.toSorted();
		if (JSON.stringify(have.toSorted()) !== JSON.stringify(wantNames)) {
			diffs.push(`${env} reviewers: ${have.join(", ") || "<none>"} → ${wantNames.join(", ")}`);
			const ids = await resolveReviewerIds(owner, entry.requiredReviewers);
			if (ids === undefined) {
				manualNote = `${env} reviewers unresolvable`;
			} else {
				body["reviewers"] = ids;
			}
		}
	}
	if (entry.branchPolicy !== undefined) {
		const haveType = state === undefined ? "all" : branchPolicyType(state);
		if (haveType !== entry.branchPolicy.type) {
			diffs.push(`${env} branches: ${haveType} → ${entry.branchPolicy.type}`);
			body["deployment_branch_policy"] =
				entry.branchPolicy.type === "all"
					? null
					: {
							custom_branch_policies: entry.branchPolicy.type === "selected",
							protected_branches: entry.branchPolicy.type === "protected",
						};
		}
		if (entry.branchPolicy.type === "selected" && entry.branchPolicy.patterns !== undefined) {
			const missing = await missingBranchPatterns(repo, env, entry.branchPolicy.patterns);
			if (missing.length > 0) {
				diffs.push(`${env} patterns: missing ${missing.join(", ")}`);
				for (const name of missing) {
					steps.push({
						body: { name },
						method: "POST",
						path: repoPath(
							repo,
							`/environments/${encodeURIComponent(env)}/deployment-branch-policies`,
						),
					});
				}
			}
		}
	}
	if (Object.keys(body).length > 0) {
		steps.push({
			body,
			method: "PUT",
			path: repoPath(repo, `/environments/${encodeURIComponent(env)}`),
		});
	}
	return { diffs, manualNote, steps };
}

export async function checkEnvironmentProtection(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "environment-protection", target);
	const want = upstream.environmentProtection ?? {};
	const envs = Object.keys(want);
	if (envs.length === 0) {
		return pass(base, "no environment protection required", "environment protection match");
	}
	const [owner] = repo.split("/");
	try {
		const results = await Promise.all(
			envs.map((env) => {
				const entry = want[env];
				if (entry === undefined) {
					const empty: EnvDiff = { diffs: [], steps: [] };
					return Promise.resolve(empty);
				}
				return diffOneEnvironment(repo, owner ?? "", env, entry);
			}),
		);
		const diffs = results.flatMap((result) => result.diffs);
		const steps = results.flatMap((result) => result.steps);
		const manualNote = results.find((result) => result.manualNote !== undefined)?.manualNote;
		if (diffs.length === 0) {
			return pass(base, "environment protection match", "environment protection match");
		}
		if (manualNote !== undefined) {
			return failManual(
				base,
				diffs.join("; "),
				"environment protection match",
				`${manualNote}: assign reviewers in Settings → Environments, then re-check.`,
			);
		}
		const fix: GithubApiFix = {
			kind: "github-api",
			label: `github PUT ${repo} environment protection`,
			steps,
		};
		return failFixable(base, diffs.join("; "), "environment protection match", fix);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read environment protection",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
}

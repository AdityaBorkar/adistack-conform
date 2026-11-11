import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/stack/github-api.js";
import type { GithubSettings } from "#/stack/github/shared.js";
import { baseFor, diffSummary } from "#/stack/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/utils/result.js";
import { failFixable, pass, skipped } from "#/utils/result.js";

export function forkApprovalPolicy(approvalForExternal: boolean): string {
	return approvalForExternal ? "all_external_contributors" : "first_time_contributors";
}

export async function checkActionsPermissions(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-permissions", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions"))) as Record<string, unknown>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read Actions permissions", "set GITHUB_TOKEN to verify");
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
	if (diffs.length === 0) {
		return pass(base, "actions permissions match", "actions permissions match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} actions permissions`,
		steps: [{ body, method: "PUT", path: repoPath(repo, "/actions/permissions") }],
	};
	return failFixable(base, diffSummary(diffs), "actions permissions match", fix);
}

export async function checkActionsWorkflow(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-workflow", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions/workflow"))) as Record<
			string,
			unknown
		>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read workflow permissions", "set GITHUB_TOKEN to verify");
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
				"verify fork PR approval in Settings → Actions",
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
			? diffSummary(diffs)
			: diffs.length === 0
				? forkDiff
				: `${diffSummary(diffs)}; ${forkDiff}`,
		"workflow permissions match",
		fix,
	);
	if (forkUnknown) {
		result.hint = "Fork approval policy is unverified; verify it in Settings → Actions.";
	}
	return result;
}

export async function checkActionsRetention(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-retention", target);
	let actual: { days?: unknown };
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions/artifact-and-log-retention"))) as {
			days?: unknown;
		};
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read retention policy", "set GITHUB_TOKEN to verify");
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
	const base = baseFor(blueprint, "actions-oidc", target);
	if (!upstream.actions.oidcImmutableSubject) {
		return skipped(base, "immutable OIDC subject not required", "verify in Settings → Actions");
	}
	// Check-only: the customization endpoint has no documented immutable-subject mapping.
	let current: unknown;
	try {
		current = await apiJson(repoPath(repo, "/actions/oidc/customization/sub"), {
			allowStatuses: [404],
		});
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "OIDC customization unavailable", "verify in Settings → Actions → OIDC");
		}
		throw error;
	}
	if (current === undefined) {
		return skipped(base, "OIDC customization unavailable", "verify in Settings → Actions → OIDC");
	}
	return skipped(
		base,
		`customization: ${JSON.stringify(current).slice(0, 120)}`,
		"verify immutable subject claim in Settings → Actions → OIDC",
	);
}

export async function checkEnvironments(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "environments", target);
	if (upstream.environments.length === 0) {
		return skipped(base, "no environments required", "list environments to enforce presence");
	}
	let names: string[];
	try {
		const items = (await apiJsonPaged(repoPath(repo, "/environments"), "environments")) as Array<{
			name?: unknown;
		}>;
		names = items.map((entry) => String(entry.name));
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list environments", "set GITHUB_TOKEN to verify environments");
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

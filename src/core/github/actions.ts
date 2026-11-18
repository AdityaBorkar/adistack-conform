import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { checkSimpleEndpoint, diffField, fixOrPass, skipOnError } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

// Actions → General → Actions permissions (+ selected actions when allowed is selected).
export async function checkActionsPermissions(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-permissions", target);
	const want = upstream.actions.general;
	if (want.selected !== undefined && want.allowed !== "selected") {
		return failManual(
			base,
			`selected actions pinned but allowed is ${want.allowed}`,
			"actions permissions match",
			"Set actions.general.allowed to selected to enforce actions.general.selected, then re-check.",
		);
	}
	const enabled = want.enabled ?? true;
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const actual = (await apiJson(repoPath(repo, "/actions/permissions"))) as Record<
			string,
			unknown
		>;
		const body: Record<string, unknown> = {};
		diffField(diffs, body, actual, "enabled", enabled);
		if (enabled) {
			diffField(diffs, body, actual, "allowed_actions", want.allowed);
			diffField(diffs, body, actual, "sha_pinning_required", want.sha_pinning_required);
		}
		if (diffs.length > 0) {
			// PUT needs the full policy, not just the drifted keys.
			steps.push({
				body: enabled
					? {
							allowed_actions: want.allowed,
							enabled,
							sha_pinning_required: want.sha_pinning_required,
						}
					: { enabled },
				method: "PUT",
				path: repoPath(repo, "/actions/permissions"),
			});
		}
		if (enabled && want.selected !== undefined) {
			const selected = (await apiJson(repoPath(repo, "/actions/permissions/selected-actions"), {
				allowStatuses: [409],
			})) as Record<string, unknown> | undefined;
			const selectedBody: Record<string, unknown> = {};
			const before = diffs.length;
			diffField(diffs, selectedBody, selected, "github_owned_allowed", want.selected.github_owned);
			diffField(diffs, selectedBody, selected, "verified_allowed", want.selected.verified_creators);
			const patterns = want.selected.patterns?.toSorted();
			const havePatterns = Array.isArray(selected?.["patterns_allowed"])
				? (selected["patterns_allowed"] as unknown[]).map(String).toSorted()
				: [];
			diffField(
				diffs,
				selectedBody,
				{ patterns_allowed: havePatterns },
				"patterns_allowed",
				patterns,
			);
			if (diffs.length > before) {
				steps.push({
					// PUT the whole wanted policy (undefined fields drop out), not just the drift.
					body: {
						github_owned_allowed: want.selected.github_owned,
						patterns_allowed: patterns,
						verified_allowed: want.selected.verified_creators,
					},
					method: "PUT",
					path: repoPath(repo, "/actions/permissions/selected-actions"),
				});
			}
		}
	} catch (error) {
		return skipOnError(error, base, "Actions permissions");
	}
	return fixOrPass(
		base,
		diffs,
		steps,
		`github PUT ${repo} actions permissions`,
		"actions permissions match",
	);
}

// Actions → General → Workflow permissions + fork PR approval policy.
export async function checkActionsWorkflow(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-workflow", target);
	const want = upstream.actions.general;
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const [workflow, fork] = await Promise.all([
			apiJson(repoPath(repo, "/actions/permissions/workflow")) as Promise<Record<string, unknown>>,
			apiJson(repoPath(repo, "/actions/permissions/fork-pr-contributor-approval")) as Promise<
				Record<string, unknown>
			>,
		]);
		const body: Record<string, unknown> = {};
		diffField(
			diffs,
			body,
			workflow,
			"default_workflow_permissions",
			want.workflow_permissions.default,
		);
		diffField(
			diffs,
			body,
			workflow,
			"can_approve_pull_request_reviews",
			want.workflow_permissions.can_approve_pull_requests,
		);
		if (Object.keys(body).length > 0) {
			steps.push({
				body: {
					can_approve_pull_request_reviews: want.workflow_permissions.can_approve_pull_requests,
					default_workflow_permissions: want.workflow_permissions.default,
				},
				method: "PUT",
				path: repoPath(repo, "/actions/permissions/workflow"),
			});
		}
		const forkBody: Record<string, unknown> = {};
		diffField(diffs, forkBody, fork, "approval_policy", want.fork_pr_approval);
		if (Object.keys(forkBody).length > 0) {
			steps.push({
				body: forkBody,
				method: "PUT",
				path: repoPath(repo, "/actions/permissions/fork-pr-contributor-approval"),
			});
		}
	} catch (error) {
		return skipOnError(error, base, "workflow permissions");
	}
	return fixOrPass(
		base,
		diffs,
		steps,
		`github PUT ${repo} workflow permissions`,
		"workflow permissions match",
	);
}

export async function checkActionsRetention(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "actions-retention", target);
	const days = upstream.actions.general.retention_days;
	const path = repoPath(repo, "/actions/permissions/artifact-and-log-retention");
	const diffs: string[] = [];
	try {
		diffField(diffs, {}, (await apiJson(path)) as Record<string, unknown>, "days", days);
	} catch (error) {
		return skipOnError(error, base, "retention policy");
	}
	return fixOrPass(
		base,
		diffs,
		[{ body: { days }, method: "PUT", path }],
		`github PUT ${repo} retention ${days}d`,
		`retention ${days}d`,
	);
}

const PUBLIC_REPO = { 422: "only applies to private/internal repositories" };

// Actions → General → Fork pull request workflows in private repositories.
export function checkActionsForkPrPrivate(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> | undefined {
	const want = upstream.actions.general.fork_pr_workflows_private;
	if (want === undefined) {
		return undefined;
	}
	return checkSimpleEndpoint(
		checkBase("github", blueprint, "actions-fork-pr-private", target),
		repo,
		"/actions/permissions/fork-pr-workflows-private-repos",
		{
			require_approval_for_fork_pr_workflows: want.require_approval,
			run_workflows_from_fork_pull_requests: want.run_workflows,
			send_secrets_and_variables: want.send_secrets,
			send_write_tokens_to_workflows: want.send_write_tokens,
		},
		"fork PR workflows (private)",
		PUBLIC_REPO,
	);
}

// Actions → General → Access (share actions/workflows with other repos).
export function checkActionsAccess(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> | undefined {
	const want = upstream.actions.general.access_level;
	if (want === undefined) {
		return undefined;
	}
	return checkSimpleEndpoint(
		checkBase("github", blueprint, "actions-access", target),
		repo,
		"/actions/permissions/access",
		{ access_level: want },
		"actions access",
		PUBLIC_REPO,
	);
}

// Actions → cache retention and storage limits (402 without a payment method).
export async function checkActionsCache(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.actions.general.cache;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "actions-cache", target);
	const parts = (
		[
			["/actions/cache/retention-limit", "max_cache_retention_days", want.retention_days],
			["/actions/cache/storage-limit", "max_cache_size_gb", want.storage_limit_gb],
		] as const
	).filter(([, , value]) => value !== undefined);
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const actuals = await Promise.all(parts.map(([path]) => apiJson(repoPath(repo, path))));
		for (const [index, [path, key, value]] of parts.entries()) {
			const before = diffs.length;
			diffField(diffs, {}, actuals[index] as Record<string, unknown>, key, value);
			if (diffs.length > before) {
				steps.push({ body: { [key]: value }, method: "PUT", path: repoPath(repo, path) });
			}
		}
	} catch (error) {
		return skipOnError(error, base, "actions cache limits", {
			402: "needs a payment method on file (billing)",
		});
	}
	return fixOrPass(base, diffs, steps, `github PUT ${repo} actions cache`, "actions cache match");
}

// Actions → OIDC → subject claim (PUT /actions/oidc/customization/sub:
// use_default, include_claim_keys, use_immutable_subject).
export async function checkActionsOidc(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.actions.oidc;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "actions-oidc", target);
	const path = repoPath(repo, "/actions/oidc/customization/sub");
	const diffs: string[] = [];
	try {
		const actual = (await apiJson(path)) as Record<string, unknown>;
		diffField(diffs, {}, actual, "use_default", want.use_default);
		if (!want.use_default) {
			diffField(diffs, {}, actual, "include_claim_keys", want.include_claim_keys);
		}
		diffField(diffs, {}, actual, "use_immutable_subject", want.immutable_subject);
	} catch (error) {
		return skipOnError(error, base, "OIDC customization", {
			404: "OIDC customization unavailable",
		});
	}
	return fixOrPass(
		base,
		diffs,
		[
			{
				body: {
					use_default: want.use_default,
					...(want.use_default ? {} : { include_claim_keys: want.include_claim_keys ?? [] }),
					...(want.immutable_subject === undefined
						? {}
						: { use_immutable_subject: want.immutable_subject }),
				},
				method: "PUT",
				path,
			},
		],
		`github PUT ${repo} OIDC subject claim`,
		"OIDC match",
	);
}

export async function checkEnvironments(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "environments", target);
	const wanted = Object.keys(upstream.environments);
	if (wanted.length === 0) {
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
	const missing = wanted.filter((name) => !names.includes(name));
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
		`environments: ${wanted.join(", ")}`,
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
	const want = upstream.actions.runners ?? [];
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
	prevent_self_review?: boolean;
	protection_rules?: Array<{
		prevent_self_review?: unknown;
		reviewers?: Array<{ reviewer?: { login?: unknown; slug?: unknown }; type?: unknown }>;
		type?: unknown;
		wait_timer?: unknown;
	}>;
	wait_minutes?: number;
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

function haveTypeIsSelected(state: EnvironmentState | undefined): boolean {
	return state !== undefined && branchPolicyType(state) === "selected";
}

function livePutBody(state: EnvironmentState | undefined): Record<string, unknown> {
	if (state === undefined) {
		return {};
	}
	const reviewers: Array<{ id: unknown; type: unknown }> = [];
	for (const rule of state.protection_rules ?? []) {
		for (const entry of Array.isArray(rule?.reviewers) ? rule.reviewers : []) {
			const id = (entry.reviewer as { id?: unknown } | undefined)?.id;
			if (typeof id === "number") {
				reviewers.push({ id, type: entry.type });
			}
		}
	}
	return {
		deployment_branch_policy: state.deployment_branch_policy ?? null,
		prevent_self_review: state.prevent_self_review ?? false,
		reviewers,
		wait_timer: state.wait_minutes ?? 0,
	};
}

function readEnvironmentState(current: Record<string, unknown>): EnvironmentState {
	const rules = Array.isArray(current["protection_rules"])
		? (current["protection_rules"] as EnvironmentState["protection_rules"])
		: [];
	let wait_minutes: number | undefined;
	let prevent_self_review: boolean | undefined;
	const reviewers: Array<{ reviewer?: { login?: unknown; slug?: unknown }; type?: unknown }> = [];
	for (const rule of rules ?? []) {
		if (typeof rule?.wait_timer === "number") {
			wait_minutes = rule.wait_timer;
		}
		if (typeof rule?.prevent_self_review === "boolean") {
			prevent_self_review = rule.prevent_self_review;
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
		prevent_self_review,
		protection_rules: rules,
		wait_minutes,
	};
}

function reviewerNames(reviewers: NonNullable<EnvironmentState["protection_rules"]>): string[] {
	return reviewers.flatMap((rule) =>
		(Array.isArray(rule?.reviewers) ? rule.reviewers : []).map((entry) =>
			entry?.type === "Team"
				? `team:${String(entry.reviewer?.slug ?? "")}`
				: `user:${String(entry.reviewer?.login ?? "")}`,
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

// Selected branch/tag patterns as `type:name` keys missing from the live policies.
async function missingRefPatterns(
	repo: string,
	env: string,
	want: Array<{ name: string; type: "branch" | "tag" }>,
): Promise<Array<{ name: string; type: "branch" | "tag" }>> {
	const policies = (await apiJsonPaged(
		repoPath(repo, `/environments/${encodeURIComponent(env)}/deployment-branch-policies`),
		"branch_policies",
	)) as Array<{ name?: unknown; type?: unknown }>;
	const have = new Set(
		policies.map((policy) => `${String(policy.type ?? "branch")}:${String(policy.name)}`),
	);
	return want.filter((entry) => !have.has(`${entry.type}:${entry.name}`));
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
	entry: GithubSettings["environments"][string],
): Promise<EnvDiff> {
	const current = (await apiJson(repoPath(repo, `/environments/${encodeURIComponent(env)}`), {
		allowStatuses: [404],
	})) as Record<string, unknown> | undefined;
	const state = current === undefined ? undefined : readEnvironmentState(current);
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	const body: Record<string, unknown> = {};
	let manualNote: string | undefined;
	if (entry.wait_minutes !== undefined && state?.wait_minutes !== entry.wait_minutes) {
		diffs.push(`${env} wait: ${String(state?.wait_minutes)} → ${entry.wait_minutes}m`);
		body["wait_timer"] = entry.wait_minutes;
	}
	if (
		entry.prevent_self_review !== undefined &&
		state?.prevent_self_review !== entry.prevent_self_review
	) {
		diffs.push(
			`${env} self-review: ${String(state?.prevent_self_review)} → ${String(entry.prevent_self_review)}`,
		);
		body["prevent_self_review"] = entry.prevent_self_review;
	}
	if (entry.required_reviewers !== undefined) {
		const have = state === undefined ? [] : reviewerNames(state.protection_rules ?? []).toSorted();
		const wantNames = entry.required_reviewers
			.map((reviewer) => `${reviewer.type}:${reviewer.name}`)
			.toSorted();
		if (JSON.stringify(have.toSorted()) !== JSON.stringify(wantNames)) {
			diffs.push(`${env} reviewers: ${have.join(", ") || "<none>"} → ${wantNames.join(", ")}`);
			const ids = await resolveReviewerIds(owner, entry.required_reviewers);
			if (ids === undefined) {
				manualNote = `${env} reviewers unresolvable`;
			} else {
				body["reviewers"] = ids;
			}
		}
	}
	if (entry.branch_policy !== undefined) {
		const haveType = state === undefined ? "all" : branchPolicyType(state);
		if (haveType !== entry.branch_policy.type) {
			diffs.push(`${env} branches: ${haveType} → ${entry.branch_policy.type}`);
			body["deployment_branch_policy"] =
				entry.branch_policy.type === "all"
					? null
					: {
							custom_branch_policies: entry.branch_policy.type === "selected",
							protected_branches: entry.branch_policy.type === "protected",
						};
		}
		const refs = [
			...(entry.branch_policy.patterns ?? []).map((name) => ({ name, type: "branch" as const })),
			...(entry.branch_policy.tag_patterns ?? []).map((name) => ({ name, type: "tag" as const })),
		];
		if (entry.branch_policy.type === "selected" && refs.length > 0) {
			// 404 while the live policy is not "selected": every pattern is missing.
			const missing = haveTypeIsSelected(state) ? await missingRefPatterns(repo, env, refs) : refs;
			if (missing.length > 0) {
				diffs.push(
					`${env} patterns: missing ${missing.map((ref) => `${ref.type}:${ref.name}`).join(", ")}`,
				);
				for (const ref of missing) {
					steps.push({
						body: ref,
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
	if (entry.admin_bypass !== undefined && current?.["can_admins_bypass"] !== entry.admin_bypass) {
		diffs.push(
			`${env} admin bypass: ${String(current?.["can_admins_bypass"])} → ${String(entry.admin_bypass)}`,
		);
		// can_admins_bypass is read-only: the PUT body (additionalProperties: false) has no such field.
		manualNote = `${env} admin bypass must be set in the UI`;
	}
	if (entry.custom_protection_rules !== undefined && entry.custom_protection_rules.length > 0) {
		const rules =
			current === undefined
				? undefined
				: ((await apiJson(
						repoPath(repo, `/environments/${encodeURIComponent(env)}/deployment_protection_rules`),
					)) as { custom_deployment_protection_rules?: Array<{ app?: { slug?: unknown } }> });
		const slugs = new Set(
			(rules?.custom_deployment_protection_rules ?? []).map((rule) => String(rule.app?.slug)),
		);
		const missing = entry.custom_protection_rules.filter((slug) => !slugs.has(slug));
		if (missing.length > 0) {
			diffs.push(`${env} custom rules: missing ${missing.join(", ")}`);
			manualNote = `${env} custom protection rules (${missing.join(", ")}) need enabling`;
		}
	}
	// Steps go first so PUT creates the env before branch policies are POSTed.
	if (Object.keys(body).length > 0) {
		steps.unshift({
			// PUT replaces protection settings, so carry over live values the blueprint didn't change.
			body: { ...livePutBody(state), ...body },
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
	const want = upstream.environments;
	// An entry of `{}` only requires existence (the `environments` check).
	const envs = Object.keys(want).filter((env) =>
		Object.entries(want[env] ?? {}).some(
			([key, value]) => key !== "secrets" && key !== "variables" && value !== undefined,
		),
	);
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
				`${manualNote}: set them in Settings → Environments → ${envs.join("/")}, then re-check.`,
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

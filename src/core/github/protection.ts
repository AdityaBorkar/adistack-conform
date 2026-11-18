import { ApiError, apiJson, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass } from "#/core/result.js";

export interface ProtectionInput {
	allow_deletions?: boolean;
	allow_force_pushes?: boolean;
	branch: string;
	checks: string[];
	dismiss_stale: boolean;
	enforce_admins?: boolean;
	lock_branch?: boolean;
	require_code_owner: boolean;
	require_conversation_resolution: boolean;
	require_last_push_approval?: boolean;
	require_linear_history?: boolean;
	require_signed_commits: boolean;
	required_approvals: number;
	restrict_pushes: boolean;
	strict?: boolean;
}

export interface ProtectionRead {
	missingBranch: boolean;
	protection: Record<string, unknown> | undefined;
}

export async function readProtection(repo: string, branch: string): Promise<ProtectionRead> {
	const branchInfo = await apiJson(repoPath(repo, `/branches/${encodeURIComponent(branch)}`), {
		allowStatuses: [404],
	});
	if (branchInfo === undefined) {
		return { missingBranch: true, protection: undefined };
	}
	const protection = (await apiJson(
		repoPath(repo, `/branches/${encodeURIComponent(branch)}/protection`),
		{ allowStatuses: [404] },
	)) as Record<string, unknown> | undefined;
	return { missingBranch: false, protection };
}

function toLoginList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.map((entry) => {
		if (typeof entry === "string") {
			return entry;
		}
		if (typeof entry === "object" && entry !== null) {
			const record = entry as Record<string, unknown>;
			for (const key of ["login", "slug", "name"]) {
				if (typeof record[key] === "string") {
					return record[key] as string;
				}
			}
		}
		return String(entry);
	});
}

// GET returns allowances as user/team/app objects (plus url fields); PUT
// wants plain login/slug lists. `keys` are always sent, even when empty.
function toAllowances(kept: unknown, keys: readonly string[]): Record<string, string[]> {
	const record = typeof kept === "object" && kept !== null ? (kept as Record<string, unknown>) : {};
	const out: Record<string, string[]> = {};
	for (const key of ["apps", "teams", "users"]) {
		const list = toLoginList(record[key]);
		if (list !== undefined || keys.includes(key)) {
			out[key] = list ?? [];
		}
	}
	return out;
}

function nonEmptyList(entry: unknown): boolean {
	return Array.isArray(entry) && entry.length > 0;
}

function isRestrictionsEnabled(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const teams = record["teams"];
		const users = record["users"];
		const apps = record["apps"];
		if ("teams" in record || "users" in record || "apps" in record) {
			return nonEmptyList(teams) || nonEmptyList(users) || nonEmptyList(apps);
		}
		return true;
	}
	return false;
}

export function protectionPutBody(
	current: Record<string, unknown> | undefined,
	input: ProtectionInput,
): Record<string, unknown> {
	const curReviews = (current?.["required_pull_request_reviews"] as Record<string, unknown>) ?? {};
	const curChecks = (current?.["required_status_checks"] as Record<string, unknown>) ?? {};
	const flag = (key: string, fallback: boolean, want?: boolean): boolean => {
		if (want !== undefined) {
			return want;
		}
		const entry = current?.[key];
		if (typeof entry === "boolean") {
			return entry;
		}
		if (typeof entry === "object" && entry !== null && "enabled" in entry) {
			return (entry as { enabled?: unknown }).enabled === true;
		}
		return fallback;
	};
	const reviews: Record<string, unknown> = {
		bypass_pull_request_allowances: toAllowances(curReviews["bypass_pull_request_allowances"], [
			"apps",
			"teams",
			"users",
		]),
		dismiss_stale_reviews: input.dismiss_stale,
		dismissal_restrictions: toAllowances(curReviews["dismissal_restrictions"], ["teams", "users"]),
		require_code_owner_reviews: input.require_code_owner,
		require_last_push_approval:
			input.require_last_push_approval ??
			(typeof curReviews["require_last_push_approval"] === "boolean"
				? curReviews["require_last_push_approval"]
				: false),
		required_approving_review_count: input.required_approvals,
	};
	return {
		allow_deletions: flag("allow_deletions", false, input.allow_deletions),
		allow_force_pushes: flag("allow_force_pushes", false, input.allow_force_pushes),
		allow_fork_syncing: flag("allow_fork_syncing", false),
		block_creations: flag("block_creations", false),
		enforce_admins: flag("enforce_admins", true, input.enforce_admins),
		lock_branch: flag("lock_branch", false, input.lock_branch),
		required_conversation_resolution: input.require_conversation_resolution,
		required_linear_history: flag("required_linear_history", false, input.require_linear_history),
		required_pull_request_reviews: reviews,
		required_status_checks: {
			checks: input.checks.map((context) => ({ context })),
			strict:
				input.strict ?? (typeof curChecks["strict"] === "boolean" ? curChecks["strict"] : false),
		},
		restrictions: input.restrict_pushes
			? toAllowances(current?.["restrictions"], ["apps", "teams", "users"])
			: null,
	};
}

type Branches = NonNullable<GithubSettings["branches"]>;

function protectionInput(branch: string, b: Branches): ProtectionInput {
	return {
		allow_deletions: b.allow_deletions,
		allow_force_pushes: b.allow_force_pushes,
		branch,
		checks: b.required_status_checks,
		dismiss_stale: b.reviews.dismiss_stale,
		enforce_admins: b.enforce_admins,
		lock_branch: b.lock_branch,
		require_code_owner: b.reviews.require_code_owner,
		require_conversation_resolution: b.reviews.require_conversation_resolution,
		require_last_push_approval: b.require_last_push_approval,
		require_linear_history: b.require_linear_history,
		require_signed_commits: b.reviews.require_signed_commits,
		required_approvals: b.reviews.required_approvals,
		restrict_pushes: b.reviews.restrict_pushes,
		strict: b.strict_status_checks,
	};
}

// GET returns classic flags as booleans or {enabled}.
function enabledFlag(value: unknown): unknown {
	return typeof value === "object" && value !== null && "enabled" in value
		? (value as { enabled?: unknown }).enabled
		: value;
}

function checkNames(contexts: unknown): string[] {
	if (!Array.isArray(contexts)) {
		return [];
	}
	return contexts.map((entry) => String((entry as { context?: unknown }).context ?? entry));
}

export function checkPrChecks(
	blueprint: string,
	repo: string,
	branch: string,
	b: Branches,
	read: ProtectionRead,
	target: string,
): CheckResult {
	const base = checkBase("github", blueprint, "pr-checks", target);
	if (read.missingBranch) {
		return failManual(
			base,
			`<branch ${branch} missing>`,
			`required checks: ${b.required_status_checks.join(", ")}`,
			`Push branch ${branch} first, then re-check.`,
		);
	}
	const liveChecks = read.protection?.["required_status_checks"] as
		| Record<string, unknown>
		| undefined;
	const current = checkNames(liveChecks?.["checks"]).toSorted();
	const want = [...b.required_status_checks].toSorted();
	const strictOk =
		b.strict_status_checks === undefined || liveChecks?.["strict"] === b.strict_status_checks;
	if (
		read.protection !== undefined &&
		strictOk &&
		JSON.stringify(current) === JSON.stringify(want)
	) {
		return pass(base, `required checks: ${want.join(", ") || "<none>"}`, "required checks match");
	}
	// Enabling push restrictions from scratch needs a user/team allowlist the
	// boolean schema cannot express; the API rejects empty teams/users.
	if (b.reviews.restrict_pushes && !isRestrictionsEnabled(read.protection?.["restrictions"])) {
		return failManual(
			base,
			`required checks: ${current.join(", ") || "<none>"}`,
			`required checks: ${want.join(", ") || "<none>"}`,
			"Add a push allowlist (users/teams) in Settings → Branches, then re-check.",
		);
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} branch protection (${branch})`,
		steps: [
			{
				body: protectionPutBody(read.protection, protectionInput(branch, b)),
				method: "PUT",
				path: repoPath(repo, `/branches/${encodeURIComponent(branch)}/protection`),
			},
		],
	};
	return failFixable(
		base,
		read.protection === undefined
			? "<branch not protected>"
			: `required checks: ${current.join(", ") || "<none>"}${strictOk ? "" : `; strict: ${String(liveChecks?.["strict"])}`}`,
		`required checks: ${want.join(", ") || "<none>"}`,
		fix,
	);
}

export async function checkReviews(
	blueprint: string,
	repo: string,
	branch: string,
	b: Branches,
	read: ProtectionRead,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "reviews", target);
	if (read.missingBranch) {
		return failManual(
			base,
			`<branch ${branch} missing>`,
			"code reviews enforced",
			`Push branch ${branch} first, then re-check.`,
		);
	}
	const reviews =
		(read.protection?.["required_pull_request_reviews"] as Record<string, unknown>) ?? {};
	const diffs: string[] = [];
	const expect: Array<[string, unknown, unknown]> = [
		["approvals", reviews["required_approving_review_count"], b.reviews.required_approvals],
		["dismiss_stale", reviews["dismiss_stale_reviews"], b.reviews.dismiss_stale],
		["code_owner", reviews["require_code_owner_reviews"], b.reviews.require_code_owner],
		[
			"conversation_resolution",
			(
				read.protection?.["required_conversation_resolution"] as Record<string, unknown> | undefined
			)?.["enabled"],
			b.reviews.require_conversation_resolution,
		],
		[
			"restrict_pushes",
			isRestrictionsEnabled(read.protection?.["restrictions"]),
			b.reviews.restrict_pushes,
		],
		["last_push_approval", reviews["require_last_push_approval"], b.require_last_push_approval],
		[
			"linear_history",
			enabledFlag(read.protection?.["required_linear_history"]),
			b.require_linear_history,
		],
		["force_pushes", enabledFlag(read.protection?.["allow_force_pushes"]), b.allow_force_pushes],
		["deletions", enabledFlag(read.protection?.["allow_deletions"]), b.allow_deletions],
		["enforce_admins", enabledFlag(read.protection?.["enforce_admins"]), b.enforce_admins],
		["lock_branch", enabledFlag(read.protection?.["lock_branch"]), b.lock_branch],
	];
	for (const [label, have, want] of expect) {
		if (want !== undefined && !Object.is(have, want)) {
			diffs.push(`${label}: ${String(have)} → ${String(want)}`);
		}
	}
	let signaturesEnabled = false;
	try {
		const signatures = await apiJson(
			repoPath(repo, `/branches/${encodeURIComponent(branch)}/protection/required_signatures`),
			{ allowStatuses: [404] },
		);
		signaturesEnabled = signatures !== undefined;
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) {
			signaturesEnabled = false;
		} else {
			throw error;
		}
	}
	if (signaturesEnabled !== b.reviews.require_signed_commits) {
		diffs.push(
			`signed_commits: ${String(signaturesEnabled)} → ${String(b.reviews.require_signed_commits)}`,
		);
	}
	if (diffs.length === 0) {
		return pass(base, "code reviews match", "code reviews match");
	}
	// Enabling push restrictions from scratch needs a user/team allowlist the
	// boolean schema cannot express; the API rejects empty teams/users.
	if (
		b.reviews.restrict_pushes &&
		!isRestrictionsEnabled(read.protection?.["restrictions"]) &&
		diffs.some((entry) => entry.startsWith("restrict_pushes"))
	) {
		return failManual(
			base,
			diffs.join("; "),
			"code reviews match",
			"Add a push allowlist (users/teams) in Settings → Branches, then re-check.",
		);
	}
	const steps: GithubApiStep[] = [
		{
			body: protectionPutBody(read.protection, protectionInput(branch, b)),
			method: "PUT",
			path: repoPath(repo, `/branches/${encodeURIComponent(branch)}/protection`),
		},
	];
	if (signaturesEnabled !== b.reviews.require_signed_commits) {
		steps.push({
			method: b.reviews.require_signed_commits ? "POST" : "DELETE",
			path: repoPath(
				repo,
				`/branches/${encodeURIComponent(branch)}/protection/required_signatures`,
			),
		});
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} branch protection (${branch})`,
		steps,
	};
	return failFixable(base, diffs.join("; "), "code reviews match", fix);
}

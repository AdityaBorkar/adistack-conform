import { ApiError, apiJson, repoPath } from "#/stack/github-api.js";
import type { GithubSettings } from "#/stack/github/shared.js";
import { baseFor, diffSummary } from "#/stack/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/utils/result.js";
import { failFixable, failManual, pass } from "#/utils/result.js";

export interface ProtectionInput {
	branch: string;
	checks: string[];
	requireApprovals: number;
	requireCodeOwner: boolean;
	requireConversationResolution: boolean;
	dismissStale: boolean;
	restrictPushes: boolean;
	requireSignedCommits: boolean;
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
	const flag = (key: string, fallback: boolean): boolean => {
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
		dismiss_stale_reviews: input.dismissStale,
		require_code_owner_reviews: input.requireCodeOwner,
		require_last_push_approval:
			typeof curReviews["require_last_push_approval"] === "boolean"
				? curReviews["require_last_push_approval"]
				: false,
		required_approving_review_count: input.requireApprovals,
	};
	for (const [key, fallback] of [
		["dismissal_restrictions", { teams: [], users: [] }],
		["bypass_pull_request_allowances", { apps: [], teams: [], users: [] }],
	] as const) {
		const kept = curReviews[key];
		reviews[key] =
			typeof kept === "object" && kept !== null ? kept : (fallback as Record<string, unknown>);
	}
	return {
		allow_deletions: flag("allow_deletions", false),
		allow_force_pushes: flag("allow_force_pushes", false),
		allow_fork_syncing: flag("allow_fork_syncing", false),
		block_creations: flag("block_creations", false),
		enforce_admins: flag("enforce_admins", true),
		lock_branch: flag("lock_branch", false),
		required_conversation_resolution: input.requireConversationResolution,
		required_linear_history: flag("required_linear_history", false),
		required_pull_request_reviews: reviews,
		required_status_checks: {
			checks: input.checks.map((context) => ({ context })),
			strict: typeof curChecks["strict"] === "boolean" ? curChecks["strict"] : false,
		},
		restrictions: input.restrictPushes
			? ((): Record<string, unknown> => {
					const kept = current?.["restrictions"];
					if (typeof kept === "object" && kept !== null) {
						return {
							apps: toLoginList((kept as Record<string, unknown>)["apps"]) ?? [],
							teams: toLoginList((kept as Record<string, unknown>)["teams"]) ?? [],
							users: toLoginList((kept as Record<string, unknown>)["users"]) ?? [],
						};
					}
					return { apps: [], teams: [], users: [] };
				})()
			: null,
	};
}

export function protectionInput(golden: GithubSettings): ProtectionInput {
	return {
		branch: golden.defaultBranch,
		checks: golden.checks,
		dismissStale: golden.reviews.dismissStale,
		requireApprovals: golden.reviews.requiredApprovals,
		requireCodeOwner: golden.reviews.requireCodeOwner,
		requireConversationResolution: golden.reviews.requireConversationResolution,
		requireSignedCommits: golden.reviews.requireSignedCommits,
		restrictPushes: golden.reviews.restrictPushes,
	};
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
	golden: GithubSettings,
	read: ProtectionRead,
	target: string,
): CheckResult {
	const base = baseFor(blueprint, "pr-checks", target);
	if (read.missingBranch) {
		return failManual(
			base,
			`<branch ${golden.defaultBranch} missing>`,
			`required checks: ${golden.checks.join(", ")}`,
			`Push branch ${golden.defaultBranch} first, then re-run check.`,
		);
	}
	const current = checkNames(
		(read.protection?.["required_status_checks"] as Record<string, unknown> | undefined)?.[
			"checks"
		],
	).toSorted();
	const want = [...golden.checks].toSorted();
	if (JSON.stringify(current) === JSON.stringify(want)) {
		return pass(base, `required checks: ${want.join(", ") || "<none>"}`, "required checks match");
	}
	// Enabling push restrictions from scratch needs a user/team allowlist the
	// boolean schema cannot express; the API rejects empty teams/users.
	if (golden.reviews.restrictPushes && !isRestrictionsEnabled(read.protection?.["restrictions"])) {
		return failManual(
			base,
			`required checks: ${current.join(", ") || "<none>"}`,
			`required checks: ${want.join(", ") || "<none>"}`,
			"Add a push allowlist (users/teams) in Settings → Branches, then re-run check.",
		);
	}
	const input = protectionInput(golden);
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} branch protection (${golden.defaultBranch})`,
		steps: [
			{
				body: protectionPutBody(read.protection, input),
				method: "PUT",
				path: repoPath(repo, `/branches/${encodeURIComponent(golden.defaultBranch)}/protection`),
			},
		],
	};
	return failFixable(
		base,
		`required checks: ${current.join(", ") || "<none>"}`,
		`required checks: ${want.join(", ") || "<none>"}`,
		fix,
	);
}

export async function checkReviews(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	read: ProtectionRead,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "reviews", target);
	if (read.missingBranch) {
		return failManual(
			base,
			`<branch ${golden.defaultBranch} missing>`,
			"code reviews enforced",
			`Push branch ${golden.defaultBranch} first, then re-run check.`,
		);
	}
	const reviews =
		(read.protection?.["required_pull_request_reviews"] as Record<string, unknown>) ?? {};
	const diffs: string[] = [];
	const expect: Array<[string, unknown, unknown]> = [
		["approvals", reviews["required_approving_review_count"], golden.reviews.requiredApprovals],
		["dismiss_stale", reviews["dismiss_stale_reviews"], golden.reviews.dismissStale],
		["code_owner", reviews["require_code_owner_reviews"], golden.reviews.requireCodeOwner],
		[
			"conversation_resolution",
			(
				read.protection?.["required_conversation_resolution"] as Record<string, unknown> | undefined
			)?.["enabled"],
			golden.reviews.requireConversationResolution,
		],
		[
			"restrict_pushes",
			isRestrictionsEnabled(read.protection?.["restrictions"]),
			golden.reviews.restrictPushes,
		],
	];
	for (const [label, have, want] of expect) {
		if (!Object.is(have, want)) {
			diffs.push(`${label}: ${String(have)} → ${String(want)}`);
		}
	}
	let signaturesEnabled = false;
	try {
		const signatures = await apiJson(
			repoPath(
				repo,
				`/branches/${encodeURIComponent(golden.defaultBranch)}/protection/required_signatures`,
			),
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
	if (signaturesEnabled !== golden.reviews.requireSignedCommits) {
		diffs.push(
			`signed_commits: ${String(signaturesEnabled)} → ${String(golden.reviews.requireSignedCommits)}`,
		);
	}
	if (diffs.length === 0) {
		return pass(base, "code reviews match", "code reviews match");
	}
	// Enabling push restrictions from scratch needs a user/team allowlist the
	// boolean schema cannot express; the API rejects empty teams/users.
	if (
		golden.reviews.restrictPushes &&
		!isRestrictionsEnabled(read.protection?.["restrictions"]) &&
		diffs.some((entry) => entry.startsWith("restrict_pushes"))
	) {
		return failManual(
			base,
			diffSummary(diffs),
			"code reviews match",
			"Add a push allowlist (users/teams) in Settings → Branches, then re-run check.",
		);
	}
	const input = protectionInput(golden);
	const steps: GithubApiStep[] = [
		{
			body: protectionPutBody(read.protection, input),
			method: "PUT",
			path: repoPath(repo, `/branches/${encodeURIComponent(golden.defaultBranch)}/protection`),
		},
	];
	if (signaturesEnabled !== golden.reviews.requireSignedCommits) {
		steps.push({
			method: golden.reviews.requireSignedCommits ? "POST" : "DELETE",
			path: repoPath(
				repo,
				`/branches/${encodeURIComponent(golden.defaultBranch)}/protection/required_signatures`,
			),
		});
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} branch protection (${golden.defaultBranch})`,
		steps,
	};
	return failFixable(base, diffSummary(diffs), "code reviews match", fix);
}

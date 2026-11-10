import type * as z from "zod";

import type { CheckBase, CheckResult, GithubApiFix, GithubApiStep } from "#/checks.js";
import { failFixable, failManual, pass, skipped } from "#/checks.js";
import type { GithubRunSpec } from "#/config.js";
import { GithubSchema } from "#/schemas/github-manifest";
import type { RegistryDocument } from "#/stack/registry.js";
import { findGithubEntry, manifestRel } from "#/stack/registry.js";
import { fetchGithubConfig } from "#/stack/remote.js";
import { errorMessage } from "#/utils/fs.js";
import { FETCH_TIMEOUT_MS, apiHeaders, githubToken } from "#/utils/net.js";

export type GithubSettings = z.infer<typeof GithubSchema>;

const GITHUB_API = "https://api.github.com";

class ApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function apiJson(
	path: string,
	options: { allowStatuses?: readonly number[]; body?: unknown; method?: string } = {},
): Promise<unknown> {
	const method = options.method ?? "GET";
	const headers = apiHeaders();
	if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	let response: Response;
	try {
		response = await fetch(`${GITHUB_API}${path}`, {
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			headers,
			method,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Cannot reach GitHub API ${method} ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	if (options.allowStatuses?.includes(response.status) === true) {
		return undefined;
	}
	if (!response.ok) {
		const excerpt = (await response.text().catch(() => "")).slice(0, 300);
		if (response.status === 401 || response.status === 403) {
			throw new ApiError(
				response.status,
				`GitHub API refused ${method} ${path}: HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
			);
		}
		throw new ApiError(
			response.status,
			`GitHub API ${method} ${path} failed: HTTP ${response.status}. ${excerpt}`,
		);
	}
	if (response.status === 204) {
		return undefined;
	}
	const text = await response.text();
	if (text === "") {
		return undefined;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`GitHub API ${method} ${path} returned invalid JSON (HTTP ${response.status}): ${errorMessage(error)}`,
			{ cause: error },
		);
	}
}

async function apiJsonPaged(path: string): Promise<unknown[]> {
	const all: unknown[] = [];
	let next: string | undefined = path.includes("?") ? path : `${path}?per_page=100`;
	while (next !== undefined) {
		const headers = apiHeaders();
		let response: Response;
		try {
			response = await fetch(`${GITHUB_API}${next}`, {
				headers,
				method: "GET",
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch (error) {
			throw new Error(`Cannot reach GitHub API GET ${next}: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		if (!response.ok) {
			const excerpt = (await response.text().catch(() => "")).slice(0, 300);
			if (response.status === 401 || response.status === 403) {
				throw new ApiError(
					response.status,
					`GitHub API refused GET ${next}: HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
				);
			}
			throw new ApiError(
				response.status,
				`GitHub API GET ${next} failed: HTTP ${response.status}. ${excerpt}`,
			);
		}
		const text = await response.text();
		let parsed: unknown = [];
		try {
			parsed = text === "" ? [] : (JSON.parse(text) as unknown);
		} catch (error) {
			throw new Error(`GitHub API GET ${next} returned invalid JSON: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		const items = Array.isArray(parsed)
			? parsed
			: ((parsed as { environments?: unknown[]; secrets?: unknown[]; variables?: unknown[] })
					.environments ??
				(parsed as { secrets?: unknown[] }).secrets ??
				(parsed as { variables?: unknown[] }).variables ??
				[]);
		all.push(...(items as unknown[]));
		const link = response.headers.get("link") ?? "";
		const match = /<([^>]+)>;\s*rel="next"/u.exec(link);
		next = match?.[1]?.startsWith(GITHUB_API) ? match[1].slice(GITHUB_API.length) : match?.[1];
		if (all.length > 1000) {
			break;
		}
	}
	return all;
}

export async function applyGithubApiFix(fix: GithubApiFix): Promise<void> {
	if (githubToken() === undefined) {
		throw new Error(`Cannot apply ${fix.label}: set GITHUB_TOKEN with repo/admin scope.`);
	}
	for (const step of fix.steps) {
		await apiJson(step.path, { body: step.body, method: step.method });
	}
}

function parseRepoSlug(text: string): string | undefined {
	const cleaned = text
		.trim()
		.replace(/\.git$/u, "")
		.replace(/\/+$/u, "");
	const withPath = /github\.com(?::\d+)?[/:]([^/\s]+\/[^/\s]+?)(?:[/?#].*)?$/iu.exec(cleaned);
	if (withPath?.[1] !== undefined) {
		return withPath[1];
	}
	const bare = /^([^/\s]+\/[^/\s]+)$/u.exec(cleaned);
	return bare?.[1];
}

function resolveTargetRepo(configured: string | undefined): string {
	if (configured !== undefined && configured !== "") {
		return configured;
	}
	const fromEnv = process.env["GITHUB_REPOSITORY"];
	if (fromEnv !== undefined && fromEnv !== "") {
		return fromEnv;
	}
	try {
		const proc = Bun.spawnSync(["git", "remote", "get-url", "origin"]);
		if (proc.exitCode === 0) {
			const slug = parseRepoSlug(new TextDecoder().decode(proc.stdout as Uint8Array));
			if (slug !== undefined) {
				return slug;
			}
		}
	} catch {
		// Fall through to the error below.
	}
	throw new Error(
		"Cannot determine the GitHub repo to check: set github.repo in conform.json or $GITHUB_REPOSITORY.",
	);
}

type GithubSettingsResult =
	| { golden: GithubSettings; rel: string }
	| { rel: string }
	| Record<string, never>;

async function fetchGithubSettings(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<GithubSettingsResult> {
	const entry = findGithubEntry(blueprint, registry);
	if (entry === undefined) {
		return {};
	}
	const rel = manifestRel(entry.path);
	try {
		const { golden } = await fetchGithubConfig(id, ref, blueprint, registry);
		return { golden, rel };
	} catch (error) {
		if (errorMessage(error).includes("HTTP 404") || errorMessage(error).includes("not found")) {
			return { rel };
		}
		throw error;
	}
}

function baseFor(blueprint: string, name: string, target: string): CheckBase {
	return {
		id: `github:${blueprint}:${name}`,
		kind: "github",
		scope: "github",
		source: `tech-stack:${blueprint}`,
		target,
	};
}

function diffSummary(diffs: readonly string[]): string {
	return diffs.join("; ");
}

function repoPath(repo: string, rest: string): string {
	return `/repos/${repo}${rest}`;
}

const MERGE_TITLE_TO_API: Record<string, string> = {
	"merge-message": "MERGE_MESSAGE",
	"pr-title": "PR_TITLE",
};
const MERGE_MESSAGE_TO_API: Record<string, string> = {
	blank: "BLANK",
	"pr-body": "PR_BODY",
	"pr-title": "PR_TITLE",
};
const SQUASH_TITLE_TO_API: Record<string, string> = {
	"commit-title": "COMMIT_OR_PR_TITLE",
	"pr-title": "PR_TITLE",
};
const SQUASH_MESSAGE_TO_API: Record<string, string> = {
	blank: "BLANK",
	"commit-messages": "COMMIT_MESSAGES",
	"pr-body": "PR_BODY",
};

interface GeneralState {
	actual: Record<string, unknown>;
	body: Record<string, unknown>;
	diffs: string[];
	target: string;
}

function compareField(
	state: GeneralState,
	actual: Record<string, unknown>,
	key: string,
	want: unknown,
	label: string,
): void {
	state.actual[label] = actual[key];
	if (!Object.is(actual[key], want)) {
		state.diffs.push(`${label}: ${String(actual[key])} → ${String(want)}`);
		state.body[key] = want;
	}
}

async function checkGeneral(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "general", target);
	const actual = (await apiJson(repoPath(repo, ""))) as Record<string, unknown>;
	const state: GeneralState = { actual: {}, body: {}, diffs: [], target };
	compareField(state, actual, "default_branch", golden.defaultBranch, "default_branch");
	compareField(state, actual, "has_issues", golden.features.issues, "has_issues");
	compareField(state, actual, "has_wiki", golden.features.wiki, "has_wiki");
	compareField(state, actual, "has_projects", golden.features.projects, "has_projects");
	compareField(state, actual, "allow_merge_commit", golden.merge.mergeCommit, "allow_merge_commit");
	compareField(state, actual, "allow_squash_merge", golden.merge.squashMerge, "allow_squash_merge");
	compareField(state, actual, "allow_rebase_merge", golden.merge.rebaseMerge, "allow_rebase_merge");
	compareField(state, actual, "allow_auto_merge", golden.merge.autoMerge, "allow_auto_merge");
	compareField(
		state,
		actual,
		"delete_branch_on_merge",
		golden.merge.deleteHeadBranches,
		"delete_branch_on_merge",
	);
	compareField(
		state,
		actual,
		"merge_commit_title",
		MERGE_TITLE_TO_API[golden.merge.mergeTitle],
		"merge_commit_title",
	);
	compareField(
		state,
		actual,
		"merge_commit_message",
		MERGE_MESSAGE_TO_API[golden.merge.mergeMessage],
		"merge_commit_message",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_title",
		SQUASH_TITLE_TO_API[golden.merge.squashTitle],
		"squash_merge_commit_title",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_message",
		SQUASH_MESSAGE_TO_API[golden.merge.squashMessage],
		"squash_merge_commit_message",
	);
	compareField(
		state,
		actual,
		"web_commit_signoff_required",
		golden.signoffRequired,
		"web_commit_signoff_required",
	);
	let discussionsNote = "";
	if (!Object.is(actual["has_discussions"], golden.features.discussions)) {
		discussionsNote = `has_discussions: ${String(actual["has_discussions"])} → ${String(golden.features.discussions)} (set in Settings → General → Features)`;
	}
	if (state.diffs.length === 0 && discussionsNote === "") {
		return pass(base, "repo settings match", "repo settings match");
	}
	if (state.diffs.length === 0) {
		return failManual(
			base,
			discussionsNote,
			"repo settings match",
			"Toggle Discussions in Settings → General → Features, then re-run check.",
		);
	}
	const step: GithubApiStep = { body: state.body, method: "PATCH", path: repoPath(repo, "") };
	const fix: GithubApiFix = { kind: "github-api", label: `github PATCH ${repo}`, steps: [step] };
	const result = failFixable(
		base,
		discussionsNote === ""
			? diffSummary(state.diffs)
			: `${diffSummary(state.diffs)}; ${discussionsNote}`,
		"repo settings match",
		fix,
	);
	// has_discussions has no documented PATCH field; the fix covers the rest.
	result.hint =
		discussionsNote === ""
			? "Apply with `fix` (needs GITHUB_TOKEN with admin scope)."
			: "Apply with `fix` for the rest (needs GITHUB_TOKEN with admin scope); toggle Discussions in Settings → General → Features.";
	return result;
}

async function checkReleases(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "releases", target);
	let enabled: boolean;
	try {
		const current = await apiJson(repoPath(repo, "/immutable-releases"), { allowStatuses: [404] });
		enabled = current !== undefined;
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return skipped(base, "cannot read immutable releases", "set GITHUB_TOKEN to verify");
		}
		throw error;
	}
	if (enabled === golden.releasesImmutable) {
		return pass(base, `immutable releases ${enabled ? "on" : "off"}`, "immutable releases match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github ${golden.releasesImmutable ? "PUT" : "DELETE"} ${repo} immutable-releases`,
		steps: [
			{
				method: golden.releasesImmutable ? "PUT" : "DELETE",
				path: repoPath(repo, "/immutable-releases"),
			},
		],
	};
	return failFixable(
		base,
		`immutable releases ${enabled ? "on" : "off"}`,
		`immutable releases ${golden.releasesImmutable ? "on" : "off"}`,
		fix,
	);
}

async function contentExists(repo: string, path: string): Promise<boolean> {
	const current = await apiJson(repoPath(repo, `/contents/${path}`), { allowStatuses: [404] });
	return current !== undefined;
}

async function checkCodeowners(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "codeowners", target);
	if (golden.codeowners === undefined) {
		return skipped(base, "no codeowners configured", "set codeowners to enforce presence");
	}
	const candidates =
		golden.codeowners === ".github/CODEOWNERS"
			? [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]
			: [golden.codeowners];
	const found = await Promise.all(
		candidates.map(async (path) => ({ exists: await contentExists(repo, path), path })),
	);
	const hit = found.find((entry) => entry.exists);
	if (hit !== undefined) {
		return pass(base, `exists (${hit.path})`, "CODEOWNERS exists");
	}
	return failManual(
		base,
		"<missing>",
		`${golden.codeowners} exists`,
		`Create ${golden.codeowners} with per-team reviewers, then re-run check.`,
	);
}

async function checkIssueTemplates(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "issue-templates", target);
	if (!golden.features.issueTemplates) {
		return skipped(base, "issue templates not required", "set features.issueTemplates to enforce");
	}
	const candidates = [
		".github/ISSUE_TEMPLATE",
		".github/issue_template.md",
		".github/ISSUE_TEMPLATE.md",
	];
	const found = await Promise.all(
		candidates.map(async (candidate) => ({
			exists: await contentExists(repo, candidate),
			path: candidate,
		})),
	);
	const hit = found.find((entry) => entry.exists);
	if (hit !== undefined) {
		return pass(base, `exists (${hit.path})`, "issue templates exist");
	}
	return failManual(
		base,
		"<missing>",
		".github/ISSUE_TEMPLATE exists",
		"Add issue templates under .github/ISSUE_TEMPLATE/, then re-run check.",
	);
}

interface ProtectionInput {
	branch: string;
	checks: string[];
	requireApprovals: number;
	requireCodeOwner: boolean;
	requireConversationResolution: boolean;
	dismissStale: boolean;
	restrictPushes: boolean;
	requireSignedCommits: boolean;
}

async function readProtection(
	repo: string,
	branch: string,
): Promise<{ missingBranch: boolean; protection: Record<string, unknown> | undefined }> {
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

function protectionPutBody(
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
							teams: toLoginList((kept as Record<string, unknown>)["teams"]) ?? [],
							users: toLoginList((kept as Record<string, unknown>)["users"]) ?? [],
						};
					}
					return { teams: [], users: [] };
				})()
			: null,
	};
}

function protectionInput(golden: GithubSettings): ProtectionInput {
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

function checkPrChecks(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	read: { missingBranch: boolean; protection: Record<string, unknown> | undefined },
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

async function checkReviews(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	read: { missingBranch: boolean; protection: Record<string, unknown> | undefined },
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

async function checkRulesets(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "rulesets", target);
	if (golden.rulesets.length === 0) {
		return skipped(base, "no rulesets required", "list rulesets to enforce presence");
	}
	let current: Array<{ enforcement?: unknown; name?: unknown }>;
	try {
		current = (await apiJsonPaged(
			repoPath(repo, "/rulesets?includes_parents=true&per_page=100"),
		)) as Array<{
			enforcement?: unknown;
			name?: unknown;
		}>;
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return skipped(base, "cannot list rulesets", "set GITHUB_TOKEN to verify");
		}
		throw error;
	}
	const active = new Set(
		current.filter((entry) => entry.enforcement === "active").map((entry) => String(entry.name)),
	);
	const missing = golden.rulesets.filter((name) => !active.has(name));
	if (missing.length === 0) {
		return pass(base, `active: ${golden.rulesets.join(", ")}`, "rulesets match");
	}
	return failManual(
		base,
		`missing or inactive: ${missing.join(", ")}`,
		`active: ${golden.rulesets.join(", ")}`,
		`Create/activate ruleset(s) ${missing.join(", ")} in Settings → Rules, then re-run check.`,
	);
}

async function checkActionsPermissions(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-permissions", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions"))) as Record<string, unknown>;
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
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
	compare("allowed_actions", golden.actions.allowed);
	compare("sha_pinning_required", golden.actions.shaPinningRequired);
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

async function checkActionsWorkflow(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
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
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
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
	compare("default_workflow_permissions", golden.actions.defaultWorkflowPermissions);
	compare("can_approve_pull_request_reviews", golden.actions.allowApprovePRs);
	let forkNote = "";
	try {
		const fork = (await apiJson(
			repoPath(repo, "/actions/permissions/fork-pr-contributor-approval"),
			{
				allowStatuses: [404],
			},
		)) as Record<string, unknown> | undefined;
		if (fork !== undefined) {
			const want = golden.actions.approvalForExternal ? "all" : "first-contribution-only";
			const have = String(fork["approval_policy"] ?? fork["policy"] ?? "unknown");
			if (have !== want) {
				forkNote = `fork approval: ${have} → ${want} (set in Settings → Actions → General)`;
			}
		}
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			forkNote = "";
		} else if (error instanceof ApiError && error.status === 404) {
			forkNote = "";
		} else {
			throw error;
		}
	}
	if (diffs.length === 0 && forkNote === "") {
		return pass(base, "workflow permissions match", "workflow permissions match");
	}
	if (diffs.length === 0) {
		return failManual(
			base,
			forkNote,
			"external approval matches",
			"Set fork PR approval in Settings → Actions → General, then re-run check.",
		);
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} workflow permissions`,
		steps: [{ body, method: "PUT", path: repoPath(repo, "/actions/permissions/workflow") }],
	};
	const result = failFixable(
		base,
		forkNote === "" ? diffSummary(diffs) : `${diffSummary(diffs)}; ${forkNote}`,
		"workflow permissions match",
		fix,
	);
	if (forkNote !== "") {
		result.hint =
			"Fix covers workflow permissions; set fork PR approval in Settings → Actions → General.";
	}
	return result;
}

async function checkActionsRetention(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-retention", target);
	let actual: { days?: unknown };
	try {
		actual = (await apiJson(repoPath(repo, "/actions/permissions/artifact-and-log-retention"))) as {
			days?: unknown;
		};
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return skipped(base, "cannot read retention policy", "set GITHUB_TOKEN to verify");
		}
		throw error;
	}
	if (Object.is(actual.days, golden.actions.retentionDays)) {
		return pass(base, `retention ${String(actual.days)}d`, "retention matches");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} retention ${golden.actions.retentionDays}d`,
		steps: [
			{
				body: { days: golden.actions.retentionDays },
				method: "PUT",
				path: repoPath(repo, "/actions/permissions/artifact-and-log-retention"),
			},
		],
	};
	return failFixable(
		base,
		`retention ${String(actual.days)}d`,
		`retention ${golden.actions.retentionDays}d`,
		fix,
	);
}

async function checkActionsOidc(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "actions-oidc", target);
	if (!golden.actions.oidcImmutableSubject) {
		return skipped(base, "immutable OIDC subject not required", "verify in Settings → Actions");
	}
	// Check-only: the customization endpoint has no documented immutable-subject mapping.
	let current: unknown;
	try {
		current = await apiJson(repoPath(repo, "/actions/oidc/customization/sub"), {
			allowStatuses: [404],
		});
	} catch (error) {
		if (
			error instanceof ApiError &&
			(error.status === 401 || error.status === 403 || error.status === 404)
		) {
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

async function checkEnvironments(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "environments", target);
	if (golden.environments.length === 0) {
		return skipped(base, "no environments required", "list environments to enforce presence");
	}
	let names: string[];
	try {
		const items = (await apiJsonPaged(repoPath(repo, "/environments"))) as Array<{
			name?: unknown;
		}>;
		names = items.map((entry) => String(entry.name));
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return skipped(base, "cannot list environments", "set GITHUB_TOKEN to verify environments");
		}
		throw error;
	}
	const missing = golden.environments.filter((name) => !names.includes(name));
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
		`environments: ${golden.environments.join(", ")}`,
		fix,
	);
}

function securityStatus(entry: unknown): string | undefined {
	if (typeof entry === "object" && entry !== null && "status" in entry) {
		const status = (entry as { status?: unknown }).status;
		return typeof status === "string" ? status : undefined;
	}
	return undefined;
}

async function checkSecurity(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult[]> {
	const base = baseFor(blueprint, "security", target);
	const notes: CheckResult[] = [];
	const repoInfo = (await apiJson(repoPath(repo, ""))) as {
		security_and_analysis?: Record<string, unknown>;
	};
	const analysis = repoInfo.security_and_analysis ?? {};
	const diffs: string[] = [];
	const patch: Record<string, { status: string }> = {};
	const compareSecurity = (key: string, want: boolean): void => {
		const have = securityStatus(analysis[key]);
		if (have === undefined) {
			return;
		}
		if ((have === "enabled") !== want) {
			diffs.push(`${key}: ${have} → ${want ? "enabled" : "disabled"}`);
			patch[key] = { status: want ? "enabled" : "disabled" };
		}
	};
	compareSecurity("secret_scanning", golden.security.secretProtection);
	compareSecurity("secret_scanning_push_protection", golden.security.pushProtection);
	// Dependency graph has no toggle API; only enforce keys the API reports.
	compareSecurity("dependency_graph", golden.security.dependencyGraph);
	const steps: GithubApiStep[] = [];
	if (Object.keys(patch).length > 0) {
		steps.push({
			body: { security_and_analysis: patch },
			method: "PATCH",
			path: repoPath(repo, ""),
		});
	}
	try {
		const vuln = await apiJson(repoPath(repo, "/private-vulnerability-reporting"), {
			allowStatuses: [404],
		});
		const enabled = vuln !== undefined;
		if (enabled !== golden.security.privateVulnerabilityReporting) {
			diffs.push(
				`private_vulnerability_reporting: ${String(enabled)} → ${String(golden.security.privateVulnerabilityReporting)}`,
			);
			steps.push({
				method: golden.security.privateVulnerabilityReporting ? "PUT" : "DELETE",
				path: repoPath(repo, "/private-vulnerability-reporting"),
			});
		}
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			notes.push(
				skipped(
					baseFor(blueprint, "security-vuln-reporting", target),
					"cannot read private vulnerability reporting",
					"set GITHUB_TOKEN to verify",
				),
			);
		} else {
			throw error;
		}
	}
	try {
		const dependabot = (await apiJson(repoPath(repo, "/automated-security-fixes"), {
			allowStatuses: [404],
		})) as { enabled?: unknown; paused?: unknown } | undefined;
		if (dependabot !== undefined) {
			const enabled = dependabot["enabled"] === true && dependabot["paused"] !== true;
			if (enabled !== golden.security.dependabot) {
				diffs.push(`dependabot: ${String(enabled)} → ${String(golden.security.dependabot)}`);
				steps.push({
					method: golden.security.dependabot ? "PUT" : "DELETE",
					path: repoPath(repo, "/automated-security-fixes"),
				});
			}
		}
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			notes.push(
				skipped(
					baseFor(blueprint, "security-dependabot", target),
					"cannot read Dependabot status",
					"set GITHUB_TOKEN to verify",
				),
			);
		} else {
			throw error;
		}
	}
	if (diffs.length === 0) {
		return [pass(base, "security settings match", "security settings match"), ...notes];
	}
	if (steps.length === 0) {
		return [
			failManual(
				base,
				diffSummary(diffs),
				"security settings match",
				"Toggle in Settings → Code security, then re-run check (needs GITHUB_TOKEN).",
			),
			...notes,
		];
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github PATCH ${repo} security`, steps };
	return [failFixable(base, diffSummary(diffs), "security settings match", fix), ...notes];
}

async function checkSecrets(
	blueprint: string,
	repo: string,
	golden: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "secrets", target);
	if (golden.secrets.length === 0 && golden.variables.length === 0) {
		return skipped(base, "no secrets/variables required", "list names to enforce presence");
	}
	let haveSecrets: string[] = [];
	let haveVariables: string[] = [];
	try {
		const [secretItems, variableItems] = await Promise.all([
			apiJsonPaged(repoPath(repo, "/actions/secrets")),
			apiJsonPaged(repoPath(repo, "/actions/variables")),
		]);
		haveSecrets = (secretItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
		haveVariables = (variableItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return skipped(base, "cannot list secrets", "set GITHUB_TOKEN to verify secrets");
		}
		throw error;
	}
	const missingSecrets = golden.secrets.filter((name) => !haveSecrets.includes(name));
	const missingVariables = golden.variables.filter((name) => !haveVariables.includes(name));
	if (missingSecrets.length === 0 && missingVariables.length === 0) {
		return pass(base, "secrets/variables present", "secrets/variables match");
	}
	const missing = [
		...missingSecrets.map((name) => `secret:${name}`),
		...missingVariables.map((name) => `variable:${name}`),
	];
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		"secrets/variables present",
		`Add values with e.g. gh secret set ${missingSecrets[0] ?? "NAME"} --repo ${repo}, then re-run check.`,
	);
}

function checkUiOnly(blueprint: string, golden: GithubSettings, target: string): CheckResult[] {
	const results: CheckResult[] = [];
	if (golden.socialPreview) {
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
			`agent suggestions unverifiable via API (want ${golden.agentSuggestions})`,
			"verify Agent suggestions for issues in repo Settings",
		),
	);
	const archive = golden.archiveSettings;
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
	);
	if (!golden.security.copilotAutofix) {
		results.push(
			skipped(
				baseFor(blueprint, "copilot-autofix", target),
				"Copilot Autofix toggle unverifiable via API",
				"verify Copilot Autofix is off in Settings → Code security",
			),
		);
	}
	return results;
}

export async function runGithubChecks(
	spec: GithubRunSpec,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	const settings = await fetchGithubSettings(spec.id, spec.ref, spec.blueprint, registry);
	const repo = resolveTargetRepo(spec.repo);
	const target = `${repo} (repo settings)`;
	if (!("golden" in settings)) {
		const base = baseFor(spec.blueprint, "settings", target);
		if (!("rel" in settings)) {
			return [
				failManual(
					base,
					"<settings reference missing>",
					`registry github_configs entry for "${spec.blueprint}"`,
					`Add "${spec.blueprint}" to registry.json github_configs (e.g. "./github-configs/<name>.json", see configuration_schema/github.json), then re-run check.`,
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
	const { golden } = settings;
	try {
		const read = await readProtection(repo, golden.defaultBranch);
		const prChecks = checkPrChecks(spec.blueprint, repo, golden, read, target);
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
		] = await Promise.all([
			checkGeneral(spec.blueprint, repo, golden, target),
			checkReleases(spec.blueprint, repo, golden, target),
			checkCodeowners(spec.blueprint, repo, golden, target),
			checkIssueTemplates(spec.blueprint, repo, golden, target),
			checkReviews(spec.blueprint, repo, golden, read, target),
			checkRulesets(spec.blueprint, repo, golden, target),
			checkActionsPermissions(spec.blueprint, repo, golden, target),
			checkActionsWorkflow(spec.blueprint, repo, golden, target),
			checkActionsRetention(spec.blueprint, repo, golden, target),
			checkActionsOidc(spec.blueprint, repo, golden, target),
			checkEnvironments(spec.blueprint, repo, golden, target),
			checkSecurity(spec.blueprint, repo, golden, target),
			checkSecrets(spec.blueprint, repo, golden, target),
		]);
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
			...checkUiOnly(spec.blueprint, golden, target),
		];
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
			return [
				skipped(
					baseFor(spec.blueprint, "auth", target),
					"cannot read repo settings",
					"set GITHUB_TOKEN to verify (private repo or rate limit)",
				),
			];
		}
		throw error;
	}
}

export function recheckGithubSelected(
	spec: GithubRunSpec,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	if (![...selectedIds].some((id) => id.startsWith(`github:${spec.blueprint}:`))) {
		return Promise.resolve([]);
	}
	return runGithubChecks(spec, registry);
}

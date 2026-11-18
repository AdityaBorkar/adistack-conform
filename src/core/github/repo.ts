import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

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

export async function checkGeneral(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
	repoInfo: () => Promise<Record<string, unknown>>,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "general", target);
	let actual: Record<string, unknown>;
	try {
		actual = await repoInfo();
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read repo settings",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const state: GeneralState = { actual: {}, body: {}, diffs: [], target };
	compareField(state, actual, "default_branch", upstream.defaultBranch, "default_branch");
	compareField(state, actual, "has_issues", upstream.features.issues.enabled, "has_issues");
	compareField(state, actual, "has_wiki", upstream.features.wiki, "has_wiki");
	compareField(state, actual, "has_projects", upstream.features.projects, "has_projects");
	compareField(
		state,
		actual,
		"allow_merge_commit",
		upstream.pullRequests.mergeCommit,
		"allow_merge_commit",
	);
	compareField(
		state,
		actual,
		"allow_squash_merge",
		upstream.pullRequests.squashMerge,
		"allow_squash_merge",
	);
	compareField(
		state,
		actual,
		"allow_rebase_merge",
		upstream.pullRequests.rebaseMerge,
		"allow_rebase_merge",
	);
	compareField(
		state,
		actual,
		"allow_auto_merge",
		upstream.pullRequests.autoMerge,
		"allow_auto_merge",
	);
	compareField(
		state,
		actual,
		"delete_branch_on_merge",
		upstream.pullRequests.deleteHeadBranches,
		"delete_branch_on_merge",
	);
	compareField(
		state,
		actual,
		"merge_commit_title",
		MERGE_TITLE_TO_API[upstream.pullRequests.mergeTitle],
		"merge_commit_title",
	);
	compareField(
		state,
		actual,
		"merge_commit_message",
		MERGE_MESSAGE_TO_API[upstream.pullRequests.mergeMessage],
		"merge_commit_message",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_title",
		SQUASH_TITLE_TO_API[upstream.pullRequests.squashTitle],
		"squash_merge_commit_title",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_message",
		SQUASH_MESSAGE_TO_API[upstream.pullRequests.squashMessage],
		"squash_merge_commit_message",
	);
	compareField(
		state,
		actual,
		"web_commit_signoff_required",
		upstream.signoffRequired,
		"web_commit_signoff_required",
	);
	if (upstream.description !== undefined) {
		compareField(state, actual, "description", upstream.description, "description");
	}
	if (upstream.homepage !== undefined) {
		compareField(state, actual, "homepage", upstream.homepage, "homepage");
	}
	if (upstream.isTemplateRepo !== undefined) {
		compareField(state, actual, "is_template", upstream.isTemplateRepo, "is_template");
	}
	if (upstream.allowForking !== undefined) {
		compareField(state, actual, "allow_forking", upstream.allowForking, "allow_forking");
	}
	if (upstream.pullRequests.suggestUpdatingBranches !== undefined) {
		compareField(
			state,
			actual,
			"allow_update_branch",
			upstream.pullRequests.suggestUpdatingBranches,
			"allow_update_branch",
		);
	}
	if (upstream.visibility !== undefined) {
		compareField(state, actual, "private", upstream.visibility === "private", "private");
	}
	if (upstream.archived !== undefined) {
		compareField(state, actual, "archived", upstream.archived, "archived");
	}
	if (upstream.pullRequests.enabled !== undefined) {
		compareField(
			state,
			actual,
			"has_pull_requests",
			upstream.pullRequests.enabled,
			"has_pull_requests",
		);
	}
	let topicsDiff = false;
	if (upstream.topics !== undefined) {
		try {
			const topicsRes = (await apiJson(repoPath(repo, "/topics"))) as { names?: unknown };
			const have = Array.isArray(topicsRes.names) ? topicsRes.names.map(String).toSorted() : [];
			const want = [...upstream.topics].toSorted();
			if (JSON.stringify(have) !== JSON.stringify(want)) {
				state.diffs.push(`topics: ${have.join(", ") || "<none>"} → ${want.join(", ") || "<none>"}`);
				topicsDiff = true;
			}
		} catch (error) {
			if (isAuthError(error)) {
				return skipped(base, "cannot read topics", "set GITHUB_TOKEN (private repo or rate limit)");
			}
			throw error;
		}
	}
	let discussionsNote = "";
	if (!Object.is(actual["has_discussions"], upstream.features.discussions)) {
		discussionsNote = `has_discussions: ${String(actual["has_discussions"])} → ${String(upstream.features.discussions)} (set in Settings → General → Features)`;
	}
	if (state.diffs.length === 0 && discussionsNote === "") {
		return pass(base, "repo settings match", "repo settings match");
	}
	if (state.diffs.length === 0) {
		return failManual(
			base,
			discussionsNote,
			"repo settings match",
			"Toggle Discussions in Settings → General → Features, then re-check.",
		);
	}
	const steps: GithubApiStep[] = [];
	if (Object.keys(state.body).length > 0) {
		steps.push({ body: state.body, method: "PATCH", path: repoPath(repo, "") });
	}
	if (topicsDiff && upstream.topics !== undefined) {
		steps.push({
			body: { names: upstream.topics },
			method: "PUT",
			path: repoPath(repo, "/topics"),
		});
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github PATCH ${repo}`, steps };
	const result = failFixable(
		base,
		discussionsNote === ""
			? state.diffs.join("; ")
			: `${state.diffs.join("; ")}; ${discussionsNote}`,
		"repo settings match",
		fix,
	);
	// has_discussions has no documented PATCH field; the fix covers the rest.
	result.hint =
		discussionsNote === ""
			? "Run `fix` (needs GITHUB_TOKEN with admin scope)."
			: "Run `fix` for the rest (needs GITHUB_TOKEN with admin scope); toggle Discussions in Settings → General → Features.";
	return result;
}

export async function checkReleases(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "releases", target);
	let enabled: boolean;
	try {
		const current = await apiJson(repoPath(repo, "/immutable-releases"), { allowStatuses: [404] });
		enabled = current !== undefined;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read immutable releases",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	if (enabled === upstream.releases.immutable) {
		return pass(base, `immutable releases ${enabled ? "on" : "off"}`, "immutable releases match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github ${upstream.releases.immutable ? "PUT" : "DELETE"} ${repo} immutable-releases`,
		steps: [
			{
				method: upstream.releases.immutable ? "PUT" : "DELETE",
				path: repoPath(repo, "/immutable-releases"),
			},
		],
	};
	return failFixable(
		base,
		`immutable releases ${enabled ? "on" : "off"}`,
		`immutable releases ${upstream.releases.immutable ? "on" : "off"}`,
		fix,
	);
}

async function contentExists(repo: string, path: string): Promise<boolean> {
	const current = await apiJson(repoPath(repo, `/contents/${path}`), { allowStatuses: [404] });
	return current !== undefined;
}

export async function checkCodeowners(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "codeowners", target);
	if (upstream.codeowners === "") {
		return pass(base, "codeowners not required", "codeowners match");
	}
	const candidates =
		upstream.codeowners === ".github/CODEOWNERS"
			? [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]
			: [upstream.codeowners];
	let found: Array<{ exists: boolean; path: string }>;
	try {
		found = await Promise.all(
			candidates.map(async (path) => ({ exists: await contentExists(repo, path), path })),
		);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read CODEOWNERS",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const hit = found.find((entry) => entry.exists);
	if (hit !== undefined) {
		return pass(base, `exists (${hit.path})`, "CODEOWNERS exists");
	}
	return failManual(
		base,
		"<missing>",
		`${upstream.codeowners} exists`,
		`Create ${upstream.codeowners} with per-team reviewers, then re-check.`,
	);
}

export async function checkIssueTemplates(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "issue-templates", target);
	if (!upstream.features.issueTemplates) {
		return pass(base, "issue templates not required", "issue templates match");
	}
	const candidates = [
		".github/ISSUE_TEMPLATE",
		".github/issue_template.md",
		".github/ISSUE_TEMPLATE.md",
	];
	let found: Array<{ exists: boolean; path: string }>;
	try {
		found = await Promise.all(
			candidates.map(async (candidate) => ({
				exists: await contentExists(repo, candidate),
				path: candidate,
			})),
		);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read issue templates",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const hit = found.find((entry) => entry.exists);
	if (hit !== undefined) {
		return pass(base, `exists (${hit.path})`, "issue templates exist");
	}
	return failManual(
		base,
		"<missing>",
		".github/ISSUE_TEMPLATE exists",
		"Add issue templates under .github/ISSUE_TEMPLATE/, then re-check.",
	);
}

export async function checkRulesets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "rulesets", target);
	if (upstream.rulesets.length === 0) {
		return pass(base, "no rulesets required", "rulesets match");
	}
	let current: Array<{ enforcement?: unknown; name?: unknown }>;
	try {
		current = (await apiJsonPaged(
			repoPath(repo, "/rulesets?includes_parents=true&per_page=100"),
		)) as Array<{ enforcement?: unknown; name?: unknown }>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list rulesets", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	const active = new Set(
		current.filter((entry) => entry.enforcement === "active").map((entry) => String(entry.name)),
	);
	const missing = upstream.rulesets.filter((name) => !active.has(name));
	if (missing.length === 0) {
		return pass(base, `active: ${upstream.rulesets.join(", ")}`, "rulesets match");
	}
	return failManual(
		base,
		`missing or inactive: ${missing.join(", ")}`,
		`active: ${upstream.rulesets.join(", ")}`,
		`Create/activate ruleset(s) ${missing.join(", ")} in Settings → Rules, then re-check.`,
	);
}

// General → repository custom properties. Schemata are org-level (manage them
// in the org UI); values fix via PATCH /properties/values (replace-all).
export async function checkCustomProperties(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "custom-properties", target);
	const want = upstream.customProperties ?? {};
	const keys = Object.keys(want);
	if (keys.length === 0) {
		return pass(base, "no custom properties required", "custom properties match");
	}
	let have: Record<string, unknown> = {};
	try {
		const current = (await apiJson(repoPath(repo, "/properties/values"), {
			allowStatuses: [404],
		})) as { properties?: Array<{ property_name?: unknown; value?: unknown }> } | undefined;
		const items = Array.isArray(current) ? current : (current?.properties ?? []);
		for (const item of items as Array<{ property_name?: unknown; value?: unknown }>) {
			have[String(item.property_name)] = item.value;
		}
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read custom properties",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const diffs = keys.filter(
		(key) => JSON.stringify(have[key] ?? null) !== JSON.stringify(want[key] ?? null),
	);
	if (diffs.length === 0) {
		return pass(base, "custom properties match", "custom properties match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PATCH ${repo} custom properties`,
		steps: [
			{
				body: { properties: keys.map((key) => ({ property_name: key, value: want[key] })) },
				method: "PATCH",
				path: repoPath(repo, "/properties/values"),
			},
		],
	};
	return failFixable(base, `drifted: ${diffs.join(", ")}`, "custom properties match", fix);
}

// Rules → merge queue policy (rulesets only; there is no repo PATCH field).
// Check reads rulesets for a merge_queue rule; authoring stays manual in
// Settings → Rules, like the rulesets check itself.
export async function checkMergeQueue(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "merge-queue", target);
	const want = upstream.mergeQueue;
	if (want === undefined) {
		return pass(base, "merge queue not managed", "merge queue match");
	}
	let rules: Array<{ parameters?: Record<string, unknown>; type?: unknown }>;
	try {
		const items = (await apiJsonPaged(
			repoPath(repo, "/rulesets?includes_parents=true&per_page=100"),
		)) as Array<{ rules?: Array<{ parameters?: Record<string, unknown>; type?: unknown }> }>;
		rules = items.flatMap((entry) => entry.rules ?? []);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list rulesets", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	const found = rules.find((rule) => rule.type === "merge_queue")?.parameters ?? undefined;
	if (!want.enabled) {
		if (found === undefined) {
			return pass(base, "merge queue disabled", "merge queue match");
		}
		return failManual(
			base,
			"merge queue rule present",
			"merge queue disabled",
			"Remove the merge_queue rule from the ruleset in Settings → Rules, then re-check.",
		);
	}
	if (found === undefined) {
		return failManual(
			base,
			"merge queue: <no rule>",
			"merge queue enabled",
			"Add a merge_queue rule to a ruleset in Settings → Rules, then re-check.",
		);
	}
	const diffs: string[] = [];
	if (want.method !== undefined) {
		const have = String(found["merge_method"] ?? "").toLowerCase();
		if (have !== want.method) {
			diffs.push(`method: ${have || "<unset>"} → ${want.method}`);
		}
	}
	if (want.maxEntriesToMerge !== undefined) {
		const have = found["max_entries_to_merge"];
		if (have !== want.maxEntriesToMerge) {
			diffs.push(`max_entries: ${String(have)} → ${String(want.maxEntriesToMerge)}`);
		}
	}
	if (diffs.length === 0) {
		return pass(base, "merge queue match", "merge queue match");
	}
	return failManual(
		base,
		diffs.join("; "),
		"merge queue match",
		`Edit the merge_queue rule (${diffs.join("; ")}) in Settings → Rules, then re-check.`,
	);
}

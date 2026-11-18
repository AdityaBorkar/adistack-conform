import { apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { diffField, fixOrPass, skipOnError } from "#/core/github/shared.js";
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
const PR_CREATION_TO_API: Record<string, string> = {
	"all-users": "all",
	"collaborators-only": "collaborators_only",
};
const SQUASH_MESSAGE_TO_API: Record<string, string> = {
	blank: "BLANK",
	"commit-messages": "COMMIT_MESSAGES",
	"pr-body": "PR_BODY",
};

export async function checkGeneral(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
	repoInfo: () => Promise<Record<string, unknown>>,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "general", target);
	const g = upstream;
	const pr = g.pull_requests;
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	let topicsDiff = false;
	let actual: Record<string, unknown>;
	try {
		actual = await repoInfo();
		if (g.topics !== undefined) {
			const topicsRes = (await apiJson(repoPath(repo, "/topics"))) as { names?: unknown };
			const have = Array.isArray(topicsRes.names) ? topicsRes.names.map(String).toSorted() : [];
			const want = [...g.topics].toSorted();
			if (JSON.stringify(have) !== JSON.stringify(want)) {
				diffs.push(`topics: ${have.join(", ") || "<none>"} → ${want.join(", ") || "<none>"}`);
				topicsDiff = true;
			}
		}
	} catch (error) {
		return skipOnError(error, base, "repo settings");
	}
	const fields: Array<[string, unknown]> = [
		["description", g.description],
		["homepage", g.homepage],
		["is_template", g.template_repository],
		["default_branch", g.default_branch],
		["has_wiki", g.features.wikis.enabled],
		["has_issues", g.features.issues.enabled],
		["has_projects", g.features.projects],
		["has_pull_requests", pr.enabled],
		[
			"pull_request_creation_policy",
			pr.permissions === undefined ? undefined : PR_CREATION_TO_API[pr.permissions],
		],
		["allow_merge_commit", pr.merge_commit],
		// GitHub 422s (no_merge_strategy) when merge titles are sent while
		// merge commits are disabled: only manage them when enabled.
		...(pr.merge_commit === true
			? ([
					["merge_commit_title", MERGE_TITLE_TO_API[pr.merge_title]],
					["merge_commit_message", MERGE_MESSAGE_TO_API[pr.merge_message]],
				] as Array<[string, unknown]>)
			: []),
		["allow_squash_merge", pr.squash_merge],
		// Same as above: squash titles require squash merging to be allowed.
		...(pr.squash_merge === true
			? ([
					["squash_merge_commit_title", SQUASH_TITLE_TO_API[pr.squash_title]],
					["squash_merge_commit_message", SQUASH_MESSAGE_TO_API[pr.squash_message]],
				] as Array<[string, unknown]>)
			: []),
		["allow_rebase_merge", pr.rebase_merge],
		["allow_update_branch", pr.suggest_updating_branches],
		["allow_auto_merge", pr.auto_merge],
		["delete_branch_on_merge", pr.delete_head_branches],
		["web_commit_signoff_required", g.commits.signoff_required],
		[
			"private",
			g.danger_zone?.visibility === undefined ? undefined : g.danger_zone.visibility === "private",
		],
		["allow_forking", g.danger_zone?.allow_forking],
		["archived", g.danger_zone?.archived],
	];
	for (const [key, want] of fields) {
		diffField(diffs, body, actual, key, want);
	}
	// has_discussions has no PATCH field in the REST description: report it, fix in the UI.
	const discussionsNote = Object.is(actual["has_discussions"], g.features.discussions)
		? ""
		: `has_discussions: ${String(actual["has_discussions"])} → ${String(g.features.discussions)} (set in Settings → General → Features)`;
	if (diffs.length === 0 && discussionsNote === "") {
		return pass(base, "repo settings match", "repo settings match");
	}
	if (diffs.length === 0) {
		return failManual(
			base,
			discussionsNote,
			"repo settings match",
			"Toggle Discussions in Settings → General → Features, then re-check.",
		);
	}
	const steps: GithubApiStep[] = [];
	if (Object.keys(body).length > 0) {
		steps.push({ body, method: "PATCH", path: repoPath(repo, "") });
	}
	if (topicsDiff && g.topics !== undefined) {
		steps.push({ body: { names: g.topics }, method: "PUT", path: repoPath(repo, "/topics") });
	}
	const result = fixOrPass(
		base,
		discussionsNote === "" ? diffs : [...diffs, discussionsNote],
		steps,
		`github PATCH ${repo}`,
		"repo settings match",
	);
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
	const codeowners = upstream.codeowners ?? "";
	if (codeowners === "") {
		return pass(base, "codeowners not required", "codeowners match");
	}
	const candidates =
		codeowners === ".github/CODEOWNERS"
			? [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]
			: [codeowners];
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
		`${codeowners} exists`,
		`Create ${codeowners} with per-team reviewers, then re-check.`,
	);
}

export async function checkIssueTemplates(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "issue-templates", target);
	if (upstream.issue_templates !== true) {
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

// General → repository custom properties. Schemata are org-level (manage them
// in the org UI); values fix via PATCH /properties/values (replace-all).
export async function checkCustomProperties(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "custom-properties", target);
	const want = upstream.custom_properties ?? {};
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

import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/stack/github-api.js";
import type { GithubSettings } from "#/stack/github/shared.js";
import { baseFor, diffSummary } from "#/stack/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/utils/result.js";
import { failFixable, failManual, pass, skipped } from "#/utils/result.js";

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
	const base = baseFor(blueprint, "general", target);
	let actual: Record<string, unknown>;
	try {
		actual = await repoInfo();
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read repo settings", "set GITHUB_TOKEN to verify");
		}
		throw error;
	}
	const state: GeneralState = { actual: {}, body: {}, diffs: [], target };
	compareField(state, actual, "default_branch", upstream.defaultBranch, "default_branch");
	compareField(state, actual, "has_issues", upstream.features.issues, "has_issues");
	compareField(state, actual, "has_wiki", upstream.features.wiki, "has_wiki");
	compareField(state, actual, "has_projects", upstream.features.projects, "has_projects");
	compareField(
		state,
		actual,
		"allow_merge_commit",
		upstream.merge.mergeCommit,
		"allow_merge_commit",
	);
	compareField(
		state,
		actual,
		"allow_squash_merge",
		upstream.merge.squashMerge,
		"allow_squash_merge",
	);
	compareField(
		state,
		actual,
		"allow_rebase_merge",
		upstream.merge.rebaseMerge,
		"allow_rebase_merge",
	);
	compareField(state, actual, "allow_auto_merge", upstream.merge.autoMerge, "allow_auto_merge");
	compareField(
		state,
		actual,
		"delete_branch_on_merge",
		upstream.merge.deleteHeadBranches,
		"delete_branch_on_merge",
	);
	compareField(
		state,
		actual,
		"merge_commit_title",
		MERGE_TITLE_TO_API[upstream.merge.mergeTitle],
		"merge_commit_title",
	);
	compareField(
		state,
		actual,
		"merge_commit_message",
		MERGE_MESSAGE_TO_API[upstream.merge.mergeMessage],
		"merge_commit_message",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_title",
		SQUASH_TITLE_TO_API[upstream.merge.squashTitle],
		"squash_merge_commit_title",
	);
	compareField(
		state,
		actual,
		"squash_merge_commit_message",
		SQUASH_MESSAGE_TO_API[upstream.merge.squashMessage],
		"squash_merge_commit_message",
	);
	compareField(
		state,
		actual,
		"web_commit_signoff_required",
		upstream.signoffRequired,
		"web_commit_signoff_required",
	);
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

export async function checkReleases(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "releases", target);
	let enabled: boolean;
	try {
		const current = await apiJson(repoPath(repo, "/immutable-releases"), { allowStatuses: [404] });
		enabled = current !== undefined;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read immutable releases", "set GITHUB_TOKEN to verify");
		}
		throw error;
	}
	if (enabled === upstream.releasesImmutable) {
		return pass(base, `immutable releases ${enabled ? "on" : "off"}`, "immutable releases match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github ${upstream.releasesImmutable ? "PUT" : "DELETE"} ${repo} immutable-releases`,
		steps: [
			{
				method: upstream.releasesImmutable ? "PUT" : "DELETE",
				path: repoPath(repo, "/immutable-releases"),
			},
		],
	};
	return failFixable(
		base,
		`immutable releases ${enabled ? "on" : "off"}`,
		`immutable releases ${upstream.releasesImmutable ? "on" : "off"}`,
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
	const base = baseFor(blueprint, "codeowners", target);
	if (upstream.codeowners === undefined) {
		return skipped(base, "no codeowners configured", "set codeowners to enforce presence");
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
			return skipped(base, "cannot read CODEOWNERS", "set GITHUB_TOKEN to verify");
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
		`Create ${upstream.codeowners} with per-team reviewers, then re-run check.`,
	);
}

export async function checkIssueTemplates(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "issue-templates", target);
	if (!upstream.features.issueTemplates) {
		return skipped(base, "issue templates not required", "set features.issueTemplates to enforce");
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
			return skipped(base, "cannot read issue templates", "set GITHUB_TOKEN to verify");
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
		"Add issue templates under .github/ISSUE_TEMPLATE/, then re-run check.",
	);
}

export async function checkRulesets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "rulesets", target);
	if (upstream.rulesets.length === 0) {
		return skipped(base, "no rulesets required", "list rulesets to enforce presence");
	}
	let current: Array<{ enforcement?: unknown; name?: unknown }>;
	try {
		current = (await apiJsonPaged(
			repoPath(repo, "/rulesets?includes_parents=true&per_page=100"),
		)) as Array<{ enforcement?: unknown; name?: unknown }>;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list rulesets", "set GITHUB_TOKEN to verify");
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
		`Create/activate ruleset(s) ${missing.join(", ")} in Settings → Rules, then re-run check.`,
	);
}

import { apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

interface PagesState {
	build_type?: unknown;
	cname?: unknown;
	https_enforced?: unknown;
	source?: { branch?: unknown; path?: unknown };
}

// Code and automation → Pages (/settings/pages). Fix via the Pages API;
// DELETE disables Pages. Branch source needs a branch; without one the setup
// is manual (e.g. GitHub Actions workflow source in the UI).
export async function checkPages(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "pages", target);
	const want = upstream.pages;
	if (want === undefined) {
		return pass(base, "pages not managed", "pages match");
	}
	let current: PagesState | undefined;
	try {
		current = (await apiJson(repoPath(repo, "/pages"), { allowStatuses: [404] })) as
			| PagesState
			| undefined;
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot read Pages", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	if (!want.enabled) {
		if (current === undefined) {
			return pass(base, "pages disabled", "pages match");
		}
		const fix: GithubApiFix = {
			kind: "github-api",
			label: `github DELETE ${repo} pages`,
			steps: [{ method: "DELETE", path: repoPath(repo, "/pages") }],
		};
		return failFixable(base, "pages enabled", "pages disabled", fix);
	}
	if (want.branch === undefined) {
		return failManual(
			base,
			current === undefined ? "pages: <not configured>" : "pages: <branch source unpinned>",
			"pages configured",
			"Set the Pages source branch/folder or GitHub Actions in Settings → Pages, then re-check.",
		);
	}
	const branch = want.branch;
	const path = want.path ?? "/";
	if (current === undefined) {
		const fix: GithubApiFix = {
			kind: "github-api",
			label: `github POST ${repo} pages`,
			steps: [
				{
					body: { source: { branch, path } },
					method: "POST",
					path: repoPath(repo, "/pages"),
				},
			],
		};
		return failFixable(base, "pages: <not configured>", `pages: ${branch} ${path}`, fix);
	}
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	if (current.source?.branch !== branch) {
		diffs.push(`branch: ${String(current.source?.branch)} → ${branch}`);
	}
	if (current.source?.path !== path) {
		diffs.push(`path: ${String(current.source?.path)} → ${path}`);
	}
	const sourceChanged = diffs.length > 0;
	if (sourceChanged) {
		body["source"] = { branch, path };
	}
	if (want.customDomain !== undefined && current.cname !== want.customDomain) {
		diffs.push(`cname: ${String(current.cname)} → ${want.customDomain}`);
		body["cname"] = want.customDomain;
	}
	if (want.httpsEnforced !== undefined && current.https_enforced !== want.httpsEnforced) {
		diffs.push(`https: ${String(current.https_enforced)} → ${String(want.httpsEnforced)}`);
		body["https_enforced"] = want.httpsEnforced;
	}
	if (diffs.length === 0) {
		return pass(base, `pages: ${branch} ${path}`, "pages match");
	}
	const fix: GithubApiFix = {
		kind: "github-api",
		label: `github PUT ${repo} pages`,
		steps: [{ body, method: "PUT", path: repoPath(repo, "/pages") }],
	};
	return failFixable(base, diffs.join("; "), "pages match", fix);
}

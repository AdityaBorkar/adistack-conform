import { apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { diffField, fixOrPass } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

interface PagesState {
	build_type?: unknown;
	cname?: unknown;
	https_enforced?: unknown;
	public?: unknown;
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
): Promise<CheckResult | undefined> {
	const want = upstream.pages;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "pages", target);
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
	const workflow = want.build_type === "workflow";
	if (!workflow && want.branch === undefined) {
		return failManual(
			base,
			current === undefined ? "pages: <not configured>" : "pages: <branch source unpinned>",
			"pages configured",
			"Set pages.branch (or build_type: workflow), or pick the source in Settings → Pages, then re-check.",
		);
	}
	const source = workflow ? undefined : { branch: want.branch, path: want.path ?? "/" };
	const wanted = `pages: ${workflow ? "workflow" : `${String(source?.branch)} ${String(source?.path)}`}`;
	if (current === undefined) {
		const fix: GithubApiFix = {
			kind: "github-api",
			label: `github POST ${repo} pages`,
			steps: [
				{
					body: {
						build_type: want.build_type ?? "legacy",
						...(source === undefined ? {} : { source }),
					},
					method: "POST",
					path: repoPath(repo, "/pages"),
				},
			],
		};
		return failFixable(base, "pages: <not configured>", wanted, fix);
	}
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	diffField(diffs, body, current as Record<string, unknown>, "build_type", want.build_type);
	if (
		source !== undefined &&
		(current.source?.branch !== source.branch || current.source?.path !== source.path)
	) {
		diffs.push(
			`source: ${String(current.source?.branch)} ${String(current.source?.path)} → ${String(source.branch)} ${source.path}`,
		);
		body["source"] = source;
	}
	diffField(diffs, body, current as Record<string, unknown>, "cname", want.custom_domain);
	diffField(diffs, body, current as Record<string, unknown>, "https_enforced", want.https_enforced);
	diffField(diffs, body, current as Record<string, unknown>, "public", want.public);
	return fixOrPass(
		base,
		diffs,
		[{ body, method: "PUT", path: repoPath(repo, "/pages") }],
		`github PUT ${repo} pages`,
		wanted,
	);
}

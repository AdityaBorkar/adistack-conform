import { ApiError, apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult } from "#/core/result.js";
import { checkBase, failManual, pass, skipped } from "#/core/result.js";

async function contentExists(repo: string, path: string): Promise<boolean> {
	const current = await apiJson(repoPath(repo, `/contents/${path}`), { allowStatuses: [404] });
	return current !== undefined;
}

async function firstExisting(repo: string, candidates: string[]): Promise<string | undefined> {
	const found = await Promise.all(
		candidates.map(async (path) => ({ exists: await contentExists(repo, path), path })),
	);
	return found.find((entry) => entry.exists)?.path;
}

// Community files have no settings API: presence via the contents API,
// fix is manual (commit the file). Covers General → Sponsorships button
// (FUNDING.yml) and the community standards files.
export async function checkCommunity(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "community", target);
	const want = upstream.community;
	if (
		want === undefined ||
		![
			want.prTemplate,
			want.funding,
			want.license,
			want.codeOfConduct,
			want.readme,
			want.dependabotConfig,
		].some((entry) => entry === true)
	) {
		return pass(base, "no community files required", "community match");
	}
	const required: Array<{ candidates: string[]; label: string; on: boolean | undefined }> = [
		{
			candidates: [
				".github/PULL_REQUEST_TEMPLATE.md",
				"PULL_REQUEST_TEMPLATE.md",
				"docs/PULL_REQUEST_TEMPLATE.md",
			],
			label: "PR template",
			on: want.prTemplate,
		},
		{ candidates: [".github/FUNDING.yml"], label: "funding", on: want.funding },
		{ candidates: ["LICENSE", "LICENSE.md", "LICENSE.txt"], label: "license", on: want.license },
		{ candidates: ["CODE_OF_CONDUCT.md"], label: "code of conduct", on: want.codeOfConduct },
		{ candidates: ["README.md"], label: "readme", on: want.readme },
		{
			candidates: [".github/dependabot.yml"],
			label: "dependabot config",
			on: want.dependabotConfig,
		},
	];
	try {
		const checks = await Promise.all(
			required.map(async (entry) => ({
				entry,
				found:
					entry.on === true ? (await firstExisting(repo, entry.candidates)) !== undefined : true,
			})),
		);
		const missing = checks
			.filter((check) => !check.found)
			.map((check) => check.entry.candidates[0] ?? check.entry.label);
		if (missing.length === 0) {
			return pass(base, "community files present", "community match");
		}
		return failManual(
			base,
			`missing: ${missing.join(", ")}`,
			"community files present",
			`Add ${missing.join(", ")} and commit, then re-check.`,
		);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read community files",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
}

// Security → Deploy keys (/settings/keys). Presence by title; key material is
// write-only and adding keys is high-risk, so the fix stays manual even
// though POST /keys exists.
export async function checkDeployKeys(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "deploy-keys", target);
	const want = upstream.deployKeys ?? [];
	if (want.length === 0) {
		return pass(base, "no deploy keys required", "deploy keys match");
	}
	let titles: string[];
	try {
		const items = (await apiJsonPaged(repoPath(repo, "/keys"))) as Array<{ title?: unknown }>;
		titles = items.map((entry) => String(entry.title));
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot list deploy keys",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const missing = want.filter((title) => !titles.includes(title));
	if (missing.length === 0) {
		return pass(base, `deploy keys: ${want.join(", ")}`, "deploy keys match");
	}
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		`deploy keys: ${want.join(", ")}`,
		`Add deploy key(s) ${missing.join(", ")} in Settings → Deploy keys, then re-check.`,
	);
}

// Code and automation → Tags → Tag protection (/settings/tags). The legacy
// tags/protection API is closing down in favour of Repository Rulesets, so
// this check is read-only with a manual hint to author a tag ruleset.
export async function checkTagProtection(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "tag-protection", target);
	const want = upstream.tagProtection ?? [];
	if (want.length === 0) {
		return pass(base, "no tag protection required", "tag protection match");
	}
	let patterns: string[];
	try {
		const items = (await apiJson(repoPath(repo, "/tags/protection"), {
			allowStatuses: [404],
		})) as Array<{ pattern?: unknown }> | undefined;
		patterns = Array.isArray(items) ? items.map((entry) => String(entry.pattern)) : [];
	} catch (error) {
		if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
			return failManual(
				base,
				`tag protection API unavailable (want ${want.join(", ")})`,
				"tag protection match",
				`Create tag protection via Rulesets in Settings → Rules (patterns ${want.join(", ")}), then re-check.`,
			);
		}
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read tag protection",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const missing = want.filter((pattern) => !patterns.includes(pattern));
	if (missing.length === 0) {
		return pass(base, `tag protection: ${want.join(", ")}`, "tag protection match");
	}
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		`tag protection: ${want.join(", ")}`,
		`Create tag ruleset pattern(s) ${missing.join(", ")} in Settings → Rules, then re-check (legacy tag API is closing down).`,
	);
}

// Codespaces file requirement. Machine types and access/spending policies are
// org-level or UI-only; the repo-scoped bit a blueprint can own is the
// devcontainer definition, checked by presence like other community files.
export async function checkCodespaces(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "codespaces", target);
	if (upstream.codespaces?.devcontainerRequired !== true) {
		return pass(base, "no codespaces files required", "codespaces match");
	}
	try {
		const found = await firstExisting(repo, [
			".devcontainer/devcontainer.json",
			".devcontainer.json",
		]);
		if (found !== undefined) {
			return pass(base, `exists (${found})`, "devcontainer exists");
		}
		return failManual(
			base,
			"<missing>",
			".devcontainer/devcontainer.json exists",
			"Add .devcontainer/devcontainer.json with the image/features the repo needs, then re-check.",
		);
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read devcontainer",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
}

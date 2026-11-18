import { apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { skipOnError } from "#/core/github/shared.js";
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
	const want = upstream;
	if (
		![want.pr_template, want.funding, want.license, want.code_of_conduct, want.readme].some(
			(entry) => entry === true,
		)
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
			on: want.pr_template,
		},
		{ candidates: [".github/FUNDING.yml"], label: "funding", on: want.funding },
		{ candidates: ["LICENSE", "LICENSE.md", "LICENSE.txt"], label: "license", on: want.license },
		{ candidates: ["CODE_OF_CONDUCT.md"], label: "code of conduct", on: want.code_of_conduct },
		{ candidates: ["README.md"], label: "readme", on: want.readme },
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

// Security and quality → Deploy keys (/settings/keys). Presence by title plus
// read-only flag; key material is write-only and there is no update API
// (re-adding a key needs the key), so the fix stays manual.
export async function checkDeployKeys(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.deploy_keys;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "deploy-keys", target);
	let live: Array<{ read_only?: unknown; title?: unknown }>;
	try {
		live = (await apiJsonPaged(repoPath(repo, "/keys"))) as typeof live;
	} catch (error) {
		return skipOnError(error, base, "deploy keys");
	}
	const diffs = want.flatMap((key) => {
		const found = live.find((entry) => entry.title === key.title);
		if (found === undefined) {
			return [`missing: ${key.title}`];
		}
		return key.read_only === undefined || found.read_only === key.read_only
			? []
			: [`${key.title} read_only: ${String(found.read_only)} → ${String(key.read_only)}`];
	});
	const expected = `deploy keys: ${want.map((key) => key.title).join(", ") || "<none>"}`;
	if (diffs.length === 0) {
		return pass(base, expected, expected);
	}
	return failManual(
		base,
		diffs.join("; "),
		expected,
		"Add or re-add the deploy key(s) in Settings → Deploy keys (Allow write access = !read_only), then re-check.",
	);
}

// Advanced Security → Dependabot version updates: on means .github/dependabot.yml exists.
export async function checkDependabotVersionUpdates(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.advanced_security.dependabot.version_updates;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "dependabot-version-updates", target);
	let found: string | undefined;
	try {
		found = await firstExisting(repo, [".github/dependabot.yml", ".github/dependabot.yaml"]);
	} catch (error) {
		return skipOnError(error, base, "dependabot.yml");
	}
	const expected = `version updates ${want ? "on" : "off"}`;
	if ((found !== undefined) === want) {
		return pass(base, expected, expected);
	}
	return failManual(
		base,
		`version updates ${want ? "off" : "on"}`,
		expected,
		want
			? "Commit .github/dependabot.yml (Settings → Advanced Security → Dependabot version updates → Create dependabot.yml), then re-check."
			: "Delete .github/dependabot.yml, then re-check.",
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
	if (upstream.codespaces?.devcontainer_required !== true) {
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

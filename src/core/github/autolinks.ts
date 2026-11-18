import { apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix } from "#/core/result.js";
import { checkBase, failFixable, pass, skipped } from "#/core/result.js";

interface AutolinkState {
	id?: unknown;
	is_alphanumeric?: unknown;
	key_prefix?: unknown;
	url_template?: unknown;
}

// Integrations → Autolink references (/settings/autolink_references).
// Matched by prefix; extras ignored. The API has no update: mismatches are
// fixed as delete + recreate.
export async function checkAutolinks(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "autolinks", target);
	const want = upstream.integrations?.autolinks ?? [];
	if (want.length === 0) {
		return pass(base, "no autolinks required", "autolinks match");
	}
	let current: AutolinkState[];
	try {
		current = (await apiJsonPaged(repoPath(repo, "/autolinks"))) as AutolinkState[];
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot list autolinks",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const diffs: string[] = [];
	const steps: GithubApiFix["steps"] = [];
	for (const entry of want) {
		const found = current.find((item) => item.key_prefix === entry.prefix);
		if (found === undefined) {
			diffs.push(`missing: ${entry.prefix}`);
			steps.push({
				body: {
					is_alphanumeric: entry.alphanumeric ?? false,
					key_prefix: entry.prefix,
					url_template: entry.url_template,
				},
				method: "POST",
				path: repoPath(repo, "/autolinks"),
			});
			continue;
		}
		const mismatches: string[] = [];
		if (found.url_template !== entry.url_template) {
			mismatches.push(`url: ${String(found.url_template)} → ${entry.url_template}`);
		}
		if ((found.is_alphanumeric ?? false) !== (entry.alphanumeric ?? false)) {
			mismatches.push(
				`alphanumeric: ${String(found.is_alphanumeric ?? false)} → ${String(entry.alphanumeric ?? false)}`,
			);
		}
		if (mismatches.length > 0) {
			diffs.push(`${entry.prefix} (${mismatches.join("; ")})`);
			const deletePath = repoPath(repo, `/autolinks/${String(found.id)}`);
			const recreate = {
				body: {
					is_alphanumeric: entry.alphanumeric ?? false,
					key_prefix: entry.prefix,
					url_template: entry.url_template,
				},
				method: "POST" as const,
				path: repoPath(repo, "/autolinks"),
			};
			steps.push({ method: "DELETE" as const, path: deletePath }, recreate);
		}
	}
	if (diffs.length === 0) {
		return pass(
			base,
			`autolinks: ${want.map((entry) => entry.prefix).join(", ")}`,
			"autolinks match",
		);
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github autolinks ${repo}`, steps };
	return failFixable(base, diffs.join("; "), "autolinks match", fix);
}

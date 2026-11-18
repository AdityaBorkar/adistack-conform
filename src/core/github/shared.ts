import type * as z from "zod";

import { ApiError, apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { CheckBase, CheckResult, GithubApiStep } from "#/core/result.js";
import { failFixable, pass, skipped } from "#/core/result.js";
import { GithubSchema } from "#/schemas/github-settings.js";

export type GithubSettings = z.infer<typeof GithubSchema>;

// Compares one API field; `want === undefined` means not managed.
export function diffField(
	diffs: string[],
	body: Record<string, unknown>,
	have: Record<string, unknown> | undefined,
	key: string,
	want: unknown,
): void {
	if (want === undefined || JSON.stringify(have?.[key]) === JSON.stringify(want)) {
		return;
	}
	diffs.push(`${key}: ${JSON.stringify(have?.[key]) ?? "<unset>"} → ${JSON.stringify(want)}`);
	body[key] = want;
}

// Pass when nothing drifted, otherwise a github-api fix running `steps`.
export function fixOrPass(
	base: CheckBase,
	diffs: string[],
	steps: GithubApiStep[],
	label: string,
	expected: string,
): CheckResult {
	if (diffs.length === 0) {
		return pass(base, expected, expected);
	}
	return failFixable(base, diffs.join("; "), expected, { kind: "github-api", label, steps });
}

// Auth failures and the listed "not available here" statuses (422 public
// repo, 402 billing, 404 feature off) skip; anything else is a real error.
export function skipOnError(
	error: unknown,
	base: CheckBase,
	what: string,
	unavailable: Record<number, string> = {},
): CheckResult {
	const reason = error instanceof ApiError ? unavailable[error.status] : undefined;
	if (reason !== undefined) {
		return skipped(base, what, reason);
	}
	if (isAuthError(error)) {
		return skipped(base, `cannot read ${what}`, "set GITHUB_TOKEN (private repo or rate limit)");
	}
	throw error;
}

// UI-only settings (no API): pass when every item is off (or unmanaged),
// otherwise skipped naming the exact Settings path. `off === undefined`
// means any set value skips.
export function uiOnly(
	base: CheckBase,
	path: string,
	items: Array<[label: string, value: unknown, off: unknown]>,
): CheckResult | undefined {
	const managed = items.filter(([, value]) => value !== undefined);
	if (managed.length === 0) {
		return undefined;
	}
	const on = managed.filter(([, value, off]) => JSON.stringify(value) !== JSON.stringify(off));
	if (on.length === 0) {
		return pass(base, "off", "off");
	}
	const want = on.map(([label, value]) => `${label}: ${JSON.stringify(value)}`).join(", ");
	return skipped(base, `want ${want} (no API)`, `confirm in Settings → ${path}`);
}

// One GET + PUT/PATCH endpoint whose fields map 1:1 from the manifest
// (undefined = not managed). Statuses in `unavailable` skip with a reason.
export async function checkSimpleEndpoint(
	base: CheckBase,
	repo: string,
	path: string,
	want: Record<string, unknown>,
	what: string,
	unavailable: Record<number, string>,
	method: "PATCH" | "PUT" = "PUT",
): Promise<CheckResult> {
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	try {
		const actual = (await apiJson(repoPath(repo, path))) as Record<string, unknown>;
		for (const [key, value] of Object.entries(want)) {
			diffField(diffs, body, actual, key, value);
		}
	} catch (error) {
		return skipOnError(error, base, what, unavailable);
	}
	return fixOrPass(
		base,
		diffs,
		[{ body: method === "PUT" ? want : body, method, path: repoPath(repo, path) }],
		`github ${method} ${repo} ${what}`,
		`${what} match`,
	);
}

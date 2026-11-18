export type CheckScope = "project" | "machine" | "github";

export interface OverwriteFileFix {
	filePath: string;
	kind: "overwrite-file";
	// Octal mode (e.g. "0600") applied before the content lands, so the file is never wider.
	mode?: string;
	newContent: string;
	// newContent holds decrypted secrets: reports must never print it.
	secret?: boolean;
}

export interface RunCommandFix {
	args: string[];
	command: string;
	kind: "run-command";
	label: string;
}

// The fix writes `content` (the upstream bytes the check compared) to
// `cachePath`, then points `targetAbs` at it, so it links exactly what was checked.
export interface SymlinkFix {
	cachePath: string;
	content: Uint8Array;
	kind: "symlink";
	label: string;
	targetAbs: string;
}

export interface GithubApiStep {
	body?: unknown;
	method: "DELETE" | "PATCH" | "POST" | "PUT";
	path: string;
}

export interface GithubApiFix {
	kind: "github-api";
	label: string;
	steps: GithubApiStep[];
}

export type CheckFix = OverwriteFileFix | RunCommandFix | SymlinkFix | GithubApiFix;

export interface CheckResult {
	actual: string;
	expected: string;
	fix?: CheckFix;
	hint?: string;
	id: string;
	kind: string;
	ok: boolean;
	scope: CheckScope;
	skipped?: boolean;
	target: string;
	upstream?: string;
}

export type CheckBase = Pick<CheckResult, "id" | "kind" | "scope" | "target" | "upstream">;

export function isFixable(result: CheckResult): boolean {
	return result.fix !== undefined;
}

export function pass(base: CheckBase, actual: string, expected: string): CheckResult {
	return { actual, expected, ok: true, ...base };
}

export function skipped(base: CheckBase, expected: string, reason: string): CheckResult {
	return { actual: reason, expected, ok: false, skipped: true, ...base };
}

export function failFixable(
	base: CheckBase,
	actual: string,
	expected: string,
	fix: CheckFix,
): CheckResult {
	return { actual, expected, fix, ok: false, ...base };
}

export function failManual(
	base: CheckBase,
	actual: string,
	expected: string,
	hint: string,
): CheckResult {
	return { actual, expected, hint, ok: false, ...base };
}

// Drift = a failing result that is not a skip; it decides exit codes and summaries.
export function isDrift(result: CheckResult): boolean {
	return !result.ok && result.skipped !== true;
}

export function partitionResults(results: CheckResult[]): {
	failed: CheckResult[];
	fixable: CheckResult[];
	manual: CheckResult[];
} {
	const failed = results.filter((item) => isDrift(item));
	return {
		failed,
		fixable: failed.filter((item) => isFixable(item)),
		manual: failed.filter((item) => !isFixable(item)),
	};
}

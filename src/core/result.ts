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

export interface RunCommandStep {
	args: string[];
	command: string;
	label: string;
}

export interface RunCommandFix extends RunCommandStep {
	kind: "run-command";
	// Setup steps run in order before the main command (e.g. refresh, upgrade
	// and autoremove before a package install).
	preCommands?: RunCommandStep[];
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

export type CheckFix = OverwriteFileFix | RunCommandFix | GithubApiFix;

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

// Every check result id is `<scope>:<blueprint>:<name>`. Ids are wire output
// (ADR 0012) and the key re-check narrowing and merging match on (ADR 0011).
export function checkId(scope: CheckScope, blueprint: string, name: string): string {
	return `${scope}:${blueprint}:${name}`;
}

export function checkBase(
	scope: CheckScope,
	blueprint: string,
	name: string,
	target: string,
): CheckBase {
	return {
		id: checkId(scope, blueprint, name),
		kind: scope,
		scope,
		target,
		upstream: `tech-stack:${blueprint}`,
	};
}

// A repeated id would make a re-check replace or resolve the wrong result.
export function assertUniqueIds(results: CheckResult[]): CheckResult[] {
	const seen = new Set<string>();
	for (const { id } of results) {
		if (seen.has(id)) {
			throw new Error(`Duplicate check result id "${id}"; give each blueprint entry its own name.`);
		}
		seen.add(id);
	}
	return results;
}

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

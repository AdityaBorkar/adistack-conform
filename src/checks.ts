import { writeFileEnsuringDir } from "#/utils/fs.js";

export type CheckScope = "project" | "machine";
export type FixKind = "overwrite-file";

export interface CheckFix {
	filePath: string;
	kind: FixKind;
	newContent: string;
}

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
	source?: string;
	target: string;
}

export type CheckBase = Pick<CheckResult, "id" | "kind" | "scope" | "source" | "target">;

export function isFixable(result: CheckResult): boolean {
	return result.fix !== undefined;
}

export function pass(base: CheckBase, actual: string, expected: string): CheckResult {
	return { actual, expected, ok: true, ...base };
}

export function skipped(base: CheckBase, expected: string, reason: string): CheckResult {
	return { actual: reason, expected, ok: true, skipped: true, ...base };
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

export function partitionResults(results: CheckResult[]): {
	failed: CheckResult[];
	fixable: CheckResult[];
	unfixable: CheckResult[];
} {
	const failed = results.filter((item) => !item.ok);
	return {
		failed,
		fixable: failed.filter((item) => isFixable(item)),
		unfixable: failed.filter((item) => !isFixable(item)),
	};
}

export function desiredContent(result: CheckResult): string {
	return result.fix?.newContent ?? result.expected;
}

export async function applyFix(result: CheckResult): Promise<void> {
	if (!result.fix) {
		throw new Error(`Check ${result.id} is not fixable.`);
	}
	await writeFileEnsuringDir(result.fix.filePath, result.fix.newContent);
}

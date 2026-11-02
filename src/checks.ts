import { outputFile } from "fs-extra";

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
	fixable: boolean;
	hint?: string;
	id: string;
	kind: string;
	ok: boolean;
	scope: CheckScope;
	skipped?: boolean;
	source?: string;
	target: string;
}

export async function readActualContent(result: CheckResult): Promise<string> {
	if (result.fix?.kind === "overwrite-file") {
		const file = Bun.file(result.fix.filePath);
		if (!(await file.exists())) {
			return "<missing>";
		}
		return file.text();
	}
	return result.actual;
}

export function desiredContent(result: CheckResult): string {
	return result.fix?.newContent ?? result.expected;
}

export async function applyFix(result: CheckResult): Promise<void> {
	if (!result.fix) {
		throw new Error(`Check ${result.id} is not fixable.`);
	}
	await outputFile(result.fix.filePath, result.fix.newContent);
}

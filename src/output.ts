import pc from "picocolors";

import type { CheckResult } from "#/checks.js";

export function okMark(ok: boolean): string {
	return ok ? pc.green("✓") : pc.red("✗");
}

export function formatResult(result: CheckResult): string[] {
	const lines: string[] = [];
	const source = result.source === undefined ? "" : ` (${result.source})`;
	if (result.skipped === true) {
		return [`${pc.gray("○")} ${pc.bold(result.id)}${source} skipped: ${result.actual}`];
	}
	const tag = result.fixable ? ` ${pc.yellow("[fixable]")}` : "";
	lines.push(
		`${okMark(result.ok)} ${pc.bold(result.id)}${tag}${source}`,
		`    target   : ${result.target}`,
	);
	if (!result.ok) {
		lines.push(`    expected : ${result.expected}`, `    actual   : ${result.actual}`);
		if (result.hint) {
			lines.push(`    hint     : ${result.hint}`);
		}
		if (result.fixable && result.fix !== undefined) {
			lines.push(`    fix      : overwrite ${result.fix.filePath}`);
		}
	}
	return lines;
}

export function printResults(results: CheckResult[]): void {
	for (const result of results) {
		for (const line of formatResult(result)) {
			console.log(line);
		}
	}
	const failed = results.filter((item) => !item.ok);
	const fixable = failed.filter((item) => item.fixable);
	const skipped = results.filter((item) => item.skipped === true);
	console.log(
		`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed (${fixable.length} fixable), ${skipped.length} skipped.`,
	);
}

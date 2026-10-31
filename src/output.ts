import pc from "picocolors";

import type { CheckResult } from "#/checks.js";

export function okMark(ok: boolean): string {
	return ok ? pc.green("✓") : pc.red("✗");
}

export function printResults(results: CheckResult[]): void {
	for (const result of results) {
		const source = result.source === undefined ? "" : ` (${result.source})`;
		if (result.skipped === true) {
			console.log(`${pc.gray("○")} ${pc.bold(result.id)}${source} skipped: ${result.actual}`);
			continue;
		}
		const tag = result.fixable ? ` ${pc.yellow("[fixable]")}` : "";
		console.log(`${okMark(result.ok)} ${pc.bold(result.id)}${tag}${source}`);
		console.log(`    target   : ${result.target}`);
		if (!result.ok) {
			console.log(`    expected : ${result.expected}`);
			console.log(`    actual   : ${result.actual}`);
			if (result.hint) {
				console.log(`    hint     : ${result.hint}`);
			}
		}
	}
	const failed = results.filter((item) => !item.ok);
	const fixable = failed.filter((item) => item.fixable);
	const skipped = results.filter((item) => item.skipped === true);
	console.log(
		`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed (${fixable.length} fixable), ${skipped.length} skipped.`,
	);
}

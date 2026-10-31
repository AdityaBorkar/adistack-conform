import type { CheckResult } from "#/checks.js";

const BOLD = "\u001B[1m";
const GREEN = "\u001B[32m";
const GREY = "\u001B[90m";
const RED = "\u001B[31m";
const RESET = "\u001B[0m";
const YELLOW = "\u001B[33m";

export function okMark(ok: boolean): string {
	return ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
}

export function printResults(results: CheckResult[]): void {
	for (const result of results) {
		const source = result.source === undefined ? "" : ` (${result.source})`;
		if (result.skipped === true) {
			console.log(
				`${GREY}○${RESET} ${BOLD}${result.id}${RESET}${source} skipped: ${result.actual}`,
			);
			continue;
		}
		const tag = result.fixable ? ` ${YELLOW}[fixable]${RESET}` : "";
		console.log(`${okMark(result.ok)} ${BOLD}${result.id}${RESET}${tag}${source}`);
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

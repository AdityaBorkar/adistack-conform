import * as prompts from "@clack/prompts";
import pc from "picocolors";

import type { CheckResult } from "#/checks.js";
import { desiredContent, isFixable, partitionResults } from "#/checks.js";
import { renderDiff } from "#/diff.js";

export function okMark(ok: boolean): string {
	return ok ? pc.green("✓") : pc.red("✗");
}

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatResult(result: CheckResult): string {
	const source = result.source === undefined ? "" : ` (${result.source})`;
	if (result.skipped === true) {
		return `${pc.gray("○")} ${pc.bold(result.id)}${source} skipped: ${short(result.actual)}`;
	}
	const tag = isFixable(result) ? ` ${pc.yellow("[fixable]")}` : "";
	const lines = [
		`${okMark(result.ok)} ${pc.bold(result.id)}${tag}${source}`,
		`    target   : ${result.target}`,
	];
	if (!result.ok) {
		lines.push(
			`    expected : ${short(result.expected)}`,
			`    actual   : ${short(result.actual)}`,
		);
		if (result.hint) {
			lines.push(`    hint     : ${short(result.hint)}`);
		}
		if (result.fix !== undefined) {
			lines.push(`    fix      : overwrite ${result.fix.filePath}`);
		}
	}
	return lines.join("\n");
}

export function printResults(results: CheckResult[]): void {
	for (const result of results) {
		console.log(formatResult(result));
	}
	const { failed, fixable } = partitionResults(results);
	const skipped = results.filter((item) => item.skipped === true);
	console.log(
		`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed (${fixable.length} fixable), ${skipped.length} skipped.`,
	);
}

export function printJsonSummary(configs: string[], results: CheckResult[]): void {
	const { failed } = partitionResults(results);
	const skipped = results.filter((item) => item.skipped === true);
	console.log(
		JSON.stringify(
			{
				configs,
				failed: failed.length,
				ok: failed.length === 0,
				passed: results.length - failed.length - skipped.length,
				results,
				skipped: skipped.length,
				total: results.length,
			},
			null,
			2,
		),
	);
}

export function reportUnfixable(unfixable: CheckResult[]): void {
	for (const item of unfixable) {
		console.error(formatResult(item));
		if (item.hint === undefined) {
			console.error(`    fix manually: see target ${item.target}`);
		}
	}
}

export function printDryRun(fixable: CheckResult[]): void {
	console.log(`\nDry run: ${fixable.length} item(s) would be fixed.`);
	for (const item of fixable) {
		console.log(`  - ${item.id} (${item.target})`);
	}
}

export function renderFixDiffs(fixable: CheckResult[]): void {
	const rendered = fixable.map(
		(item) =>
			`\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", item.actual, desiredContent(item))}`,
	);
	for (const text of rendered) {
		console.log(text);
	}
}

export function printWarning(message: string): void {
	console.warn(message);
}

export function outroAllPassed(): void {
	prompts.outro("All conform checks passed.");
}

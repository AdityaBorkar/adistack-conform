import pc from "picocolors";

import type { CheckResult } from "#/checks.js";
import { desiredContent, isFixable, partitionResults } from "#/checks.js";

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
			lines.push(
				result.fix.kind === "overwrite-file"
					? `    fix      : overwrite ${result.fix.filePath}`
					: `    fix      : run ${result.fix.label}`,
			);
		}
	}
	return lines.join("\n");
}

export function formatDuration(ms: number): string {
	const safe = Number.isFinite(ms) && ms >= 0 ? ms : 0;
	const rounded = Math.round(safe);
	if (rounded < 1000) {
		return `${rounded}ms`;
	}
	return `${(safe / 1000).toFixed(2)}s`;
}

export function printResults(results: CheckResult[], elapsedMs?: number): void {
	const lines = results.filter((result) => !result.ok).map((result) => formatResult(result));
	const { failed, fixable } = partitionResults(results);
	const skipped = results.filter((item) => item.skipped === true);
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	lines.push(
		`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed (${fixable.length} fixable), ${skipped.length} skipped${timing}.`,
	);
	process.stdout.write(`${lines.join("\n")}\n`);
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

export function printDryRun(fixable: CheckResult[], elapsedMs?: number): void {
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	const lines = [`\nDry run: ${fixable.length} item(s) would be fixed${timing}.`];
	for (const item of fixable) {
		lines.push(`  - ${item.id} (${item.target})`);
	}
	process.stdout.write(`${lines.join("\n")}\n`);
}

export async function renderFixDiffs(fixable: CheckResult[]): Promise<void> {
	const { renderDiff } = await import("#/diff.js");
	const rendered = fixable.map((item) => {
		if (item.fix?.kind === "run-command") {
			return `\nrun ${item.id} (${item.target})\n${item.fix.label}`;
		}
		return `\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", item.actual, desiredContent(item))}`;
	});
	process.stdout.write(`${rendered.join("\n")}\n`);
}

export function printWarning(message: string): void {
	console.warn(message);
}

export async function outroAllPassed(elapsedMs?: number): Promise<void> {
	const { outro } = await import("@clack/prompts");
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	outro(`All conform checks passed${timing}.`);
}

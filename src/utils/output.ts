import pc from "picocolors";

import { renderDiff } from "#/utils/diff.js";
import type { CheckResult, CheckScope } from "#/utils/result.js";
import { describeFix, desiredContent, isFixable, partitionResults } from "#/utils/result.js";

export function okMark(ok: boolean): string {
	return ok ? pc.green("✓") : pc.red("✗");
}

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	if (flat.length <= max) {
		return flat;
	}
	// Keep both ends so a long single-line error still shows its cause.
	const head = Math.ceil((max - 1) / 2);
	const tailLength = max - head - 1;
	return `${flat.slice(0, head)}…${flat.slice(-tailLength)}`;
}

// Blueprint-controlled strings (ids, paths, labels) reach the terminal through
// picocolors: strip control characters so a hostile name cannot emit escapes.
function sanitize(value: string): string {
	// oxlint-disable-next-line no-control-regex
	return value.replaceAll(/[\u0000-\u001F\u007F]/gu, "");
}

export function formatResult(result: CheckResult): string {
	const source = result.source === undefined ? "" : ` (${sanitize(result.source)})`;
	if (result.skipped === true) {
		return `${pc.gray("○")} ${pc.bold(sanitize(result.id))}${source} skipped: ${short(sanitize(result.actual))}`;
	}
	const tag = isFixable(result) ? ` ${pc.yellow("[fixable]")}` : "";
	const lines = [
		`${okMark(result.ok)} ${pc.bold(sanitize(result.id))}${tag}${source}`,
		`    target   : ${sanitize(result.target)}`,
	];
	if (!result.ok) {
		lines.push(
			`    expected : ${short(sanitize(result.expected))}`,
			`    actual   : ${short(sanitize(result.actual))}`,
		);
		if (result.hint) {
			lines.push(`    hint     : ${short(sanitize(result.hint))}`);
		}
		if (result.fix !== undefined) {
			lines.push(`    fix      : ${sanitize(describeFix(result))}`);
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

function scopeSummary(scope: CheckScope, items: CheckResult[]): string | undefined {
	// Scopes that did not run are omitted by the caller.
	if (items.length === 0) {
		return undefined;
	}
	// The machine scope is always a single nix result, so report its state in
	// words instead of a meaningless "1 passed".
	if (scope === "machine") {
		const failed = items.filter((item) => !item.ok);
		if (failed.length === 0) {
			return `${okMark(true)} machine: in sync`;
		}
		if (failed.every((item) => isFixable(item))) {
			return `${okMark(false)} machine: drift (fixable)`;
		}
		if (failed.some((item) => isFixable(item))) {
			return `${okMark(false)} machine: drift (fixable + manual)`;
		}
		return `${okMark(false)} machine: manual (see above)`;
	}
	const { failed, fixable } = partitionResults(items);
	const skipped = items.filter((item) => item.skipped === true).length;
	const passed = items.length - failed.length - skipped;
	return `${okMark(failed.length === 0)} ${scope}: ${passed} passed, ${failed.length} failed (${fixable.length} fixable), ${skipped} skipped`;
}

export function printResults(
	results: CheckResult[],
	timings?: Partial<Record<CheckScope, number | undefined>>,
	options?: { verbose?: boolean },
): void {
	const verbose = options?.verbose === true;
	const visible = verbose ? results : results.filter((result) => !result.ok);
	const lines = visible.map((result) => formatResult(result));
	const summaries: string[] = [];
	for (const scope of ["project", "machine", "github"] as const) {
		const summary = scopeSummary(
			scope,
			results.filter((result) => result.scope === scope),
		);
		if (summary === undefined) {
			continue;
		}
		const elapsedMs = timings?.[scope];
		summaries.push(elapsedMs === undefined ? summary : `${summary} (${formatDuration(elapsedMs)})`);
	}
	lines.push("", ...(summaries.length > 0 ? summaries : ["No results."]));
	process.stdout.write(`${lines.join("\n")}\n`);
}

export function printJsonSummary(desiredStates: string[], results: CheckResult[]): void {
	const failed = results.filter((item) => !item.ok);
	const skipped = results.filter((item) => item.ok && item.skipped === true);
	const passed = results.filter((item) => item.ok && item.skipped !== true);
	console.log(
		JSON.stringify(
			{
				desiredStates,
				failed: failed.length,
				ok: failed.length === 0,
				passed: passed.length,
				results,
				skipped: skipped.length,
				total: results.length,
			},
			null,
			2,
		),
	);
}

export function reportManual(manual: CheckResult[]): void {
	for (const item of manual) {
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
		lines.push(`  - ${sanitize(item.id)} (${sanitize(item.target)})`);
	}
	process.stdout.write(`${lines.join("\n")}\n`);
}

const MAX_DIFFS_SHOWN = 20;

export function renderFixDiffs(fixable: CheckResult[]): void {
	const shown = fixable.slice(0, MAX_DIFFS_SHOWN);
	const rendered = shown.map((item) => {
		if (item.fix?.kind === "run-command") {
			return `\nrun ${sanitize(item.id)} (${sanitize(item.target)})\n${sanitize(item.fix.label)}`;
		}
		if (item.fix?.kind === "github-api") {
			return `\napi ${sanitize(item.id)} (${sanitize(item.target)})\n${item.fix.steps.map((step) => `${step.method} ${sanitize(step.path)}`).join("\n")}`;
		}
		return `\ndiff ${sanitize(item.id)} (${sanitize(item.target)})\n${renderDiff("actual", "expected", item.actual, desiredContent(item))}`;
	});
	if (fixable.length > shown.length) {
		rendered.push(`\n… and ${fixable.length - shown.length} more (use --no-diff to hide).`);
	}
	process.stdout.write(`${rendered.join("\n")}\n`);
}

export async function outroAllPassed(elapsedMs?: number): Promise<void> {
	const { outro } = await import("@clack/prompts");
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	outro(`All conform checks passed${timing}.`);
}

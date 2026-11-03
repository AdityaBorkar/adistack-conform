import pc from "picocolors";

import type { CheckResult, CheckScope } from "#/checks.js";
import { desiredContent, isFixable, partitionResults } from "#/checks.js";

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
	return `${flat.slice(0, head)}…${flat.slice(head - max + 1)}`;
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
					: result.fix.kind === "github-api"
						? `    fix      : api ${result.fix.label}`
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

function scopeSummary(scope: CheckScope, items: CheckResult[]): string | undefined {
	// Scopes that did not run are omitted by the caller.
	if (items.length === 0) {
		return undefined;
	}
	// The machine scope is always a single nix check, so report its state in
	// words instead of a meaningless "1 passed".
	if (scope === "machine") {
		const failed = items.filter((item) => !item.ok);
		if (failed.length === 0) {
			return `${okMark(true)} machine: in sync`;
		}
		return failed.some((item) => isFixable(item))
			? `${okMark(false)} machine: drift (fixable)`
			: `${okMark(false)} machine: error (see above)`;
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
	lines.push("", ...(summaries.length > 0 ? summaries : ["No checks ran."]));
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
		if (item.fix?.kind === "github-api") {
			return `\napi ${item.id} (${item.target})\n${item.fix.steps.map((step) => `${step.method} ${step.path}`).join("\n")}`;
		}
		return `\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", item.actual, desiredContent(item))}`;
	});
	process.stdout.write(`${rendered.join("\n")}\n`);
}

export async function outroAllPassed(elapsedMs?: number): Promise<void> {
	const { outro } = await import("@clack/prompts");
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	outro(`All conform checks passed${timing}.`);
}

import pc from "picocolors";

import { describeFix, fixForJson, fixPreview } from "#/core/fix.js";
import type { CheckResult, CheckScope } from "#/core/result.js";
import { isDrift, isFixable, partitionResults } from "#/core/result.js";
import { renderDiff } from "#/utils/diff.js";

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
// Newlines are preserved for diff bodies; single-line fields use short() to flatten.
function sanitize(value: string): string {
	// oxlint-disable-next-line no-control-regex
	return value.replaceAll(/[\u0000-\u001F\u007F]/gu, "");
}

function scopeDisplay(scope: CheckScope): string {
	if (scope === "github") {
		return "GitHub";
	}
	return `${scope.at(0)?.toUpperCase() ?? ""}${scope.slice(1)}`;
}

function prettify(token: string): string {
	return token
		.split(/[-_]+/u)
		.map((word) => (word === "" ? word : `${word.at(0)?.toUpperCase() ?? ""}${word.slice(1)}`))
		.join(" ");
}

// Human title from the wire id. Machine ids carry a section
// (`machine:<bp>:<section>:<name>` -> `Section: name`); project and github
// ids show the trailing name; domain and internal-error ids prettify the last part.
function titleFor(result: CheckResult): string {
	const parts = result.id.split(":");
	if (result.scope === "machine") {
		if (parts.length >= 4) {
			return `${prettify(parts.at(2) ?? "")}: ${parts.slice(3).join(":")}`;
		}
		if (parts.length === 3) {
			return prettify(parts.at(2) ?? "");
		}
		return prettify(parts.at(-1) ?? result.id);
	}
	if (parts.length >= 3) {
		return parts.slice(2).join(":");
	}
	return result.id;
}

// Absolute paths get an OSC8 file link so Ctrl+Click opens them. The inner
// text is sanitized first so the ESC wrappers survive.
function fileLink(absPath: string): string {
	const clean = sanitize(absPath);
	const uri = `file://${clean}`;
	return `\u001B]8;;${uri}\u001B\\${clean}\u001B]8;;\u001B\\`;
}

// `(target)` suffix, or "" when the target carries no path info beyond the title
// (package ids like `apt:autoconf`, structure names like `Source Dir`, github
// repo targets, scope-only internal errors). Fixable files always show the
// absolute fix path so it stays clickable.
function targetSuffix(result: CheckResult): string {
	const fixPath = result.fix?.kind === "overwrite-file" ? result.fix.filePath : undefined;
	if (fixPath !== undefined) {
		return ` (${fileLink(fixPath)})`;
	}
	const target = sanitize(result.target);
	if (target.startsWith("/")) {
		return ` (${fileLink(target)})`;
	}
	// Relative file paths (`dir/file`, `name.ext`) stay; bare labels do not.
	if (target.includes("/") && !target.includes(" ") && !target.includes("(")) {
		return ` (${target})`;
	}
	if (
		target.includes(".") &&
		!target.includes(" ") &&
		!target.includes(":") &&
		!target.includes("(")
	) {
		return ` (${target})`;
	}
	return "";
}

function isSentinel(text: string): boolean {
	const trimmed = text.trim();
	return (
		trimmed.length >= 2 &&
		trimmed.startsWith("<") &&
		trimmed.endsWith(">") &&
		!trimmed.includes("\n")
	);
}

// Unified diff for file drift, shown instead of the old truncated
// expected/actual lines. Package/command/api drift has no diff: the fix line
// already carries the command.
function diffBody(result: CheckResult): string | undefined {
	if (result.fix?.kind === "overwrite-file" && result.fix.secret === true) {
		return "<diff hidden: content holds secrets>";
	}
	if (result.fix?.kind === "overwrite-file") {
		const actual = isSentinel(result.actual) ? "" : result.actual;
		return renderDiff("actual", "expected", actual, result.fix.newContent);
	}
	if (result.fix === undefined && !isSentinel(result.actual) && !isSentinel(result.expected)) {
		const singleLine = !result.actual.includes("\n") && !result.expected.includes("\n");
		if (singleLine && result.actual.length < 200 && result.expected.length < 200) {
			return undefined;
		}
		return renderDiff("actual", "expected", result.actual, result.expected);
	}
	return undefined;
}

function formatResult(result: CheckResult): string {
	const heading = pc.bold(`[${scopeDisplay(result.scope)}] ${sanitize(titleFor(result))}`);
	const target = targetSuffix(result);
	if (result.skipped === true) {
		return `${pc.gray("○")} ${heading}${target} skipped: ${short(sanitize(result.actual))}`;
	}
	if (result.ok) {
		return `${okMark(true)} ${heading}${target}`;
	}
	const tag = isFixable(result) ? ` ${pc.yellow("[fixable]")}` : ` ${pc.red("[manual]")}`;
	const fixDesc = result.fix === undefined ? undefined : sanitize(describeFix(result));
	const hint = result.hint === undefined ? undefined : sanitize(result.hint);
	const fixText =
		fixDesc !== undefined && hint !== undefined
			? `${fixDesc} — ${hint}`
			: (fixDesc ?? hint ?? "manual");
	const lines = [`${okMark(false)} ${heading}${target}${tag}`, `    fix: ${fixText}`];
	const diff = diffBody(result);
	if (diff !== undefined) {
		if (diff.includes("\n")) {
			lines.push("    diff:");
			for (const line of diff.split("\n")) {
				lines.push(`      ${line}`);
			}
		} else {
			lines.push(`    diff: ${diff}`);
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
	// Machine results are per-item, so summarize the scope state in words
	// instead of per-item counts.
	if (scope === "machine") {
		const failed = items.filter((item) => isDrift(item));
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
	const failedPart =
		failed.length === 0 ? "0 failed" : `${failed.length} failed (${fixable.length} fixable)`;
	return `${okMark(failed.length === 0)} ${scope}: ${passed} passed, ${failedPart}, ${skipped} skipped`;
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

export function printJsonSummary(desiredState: string, results: CheckResult[]): void {
	const failed = results.filter((item) => isDrift(item));
	const skipped = results.filter((item) => item.skipped === true);
	const passed = results.filter((item) => item.ok && item.skipped !== true);
	console.log(
		JSON.stringify(
			{
				desiredStates: [desiredState],
				failed: failed.length,
				ok: failed.length === 0,
				passed: passed.length,
				results: results.map((item) => fixForJson(item)),
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
		const preview = fixPreview(item);
		const body =
			"lines" in preview
				? preview.lines.map((line) => sanitize(line)).join("\n")
				: renderDiff("actual", "expected", item.actual, preview.expected);
		return `\n${preview.verb} ${sanitize(item.id)} (${sanitize(item.target)})\n${body}`;
	});
	if (fixable.length > shown.length) {
		rendered.push(`\n… and ${fixable.length - shown.length} more.`);
	}
	process.stdout.write(`${rendered.join("\n")}\n`);
}

export async function outroAllPassed(elapsedMs?: number): Promise<void> {
	const { outro } = await import("@clack/prompts");
	const timing = elapsedMs === undefined ? "" : ` in ${formatDuration(elapsedMs)}`;
	outro(`All conform checks passed${timing}.`);
}

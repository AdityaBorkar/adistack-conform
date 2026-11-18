import type { Command } from "commander";

import type { DesiredStateOption, ScopeOptions } from "#/core/config.js";
import { machineStateOf } from "#/core/config.js";
import { unattendedRefusal } from "#/core/fix.js";
import { fixSelectedAcrossScopes } from "#/core/machine/fix.js";
import {
	formatDuration,
	outroAllPassed,
	printDryRun,
	printResults,
	renderFixDiffs,
	reportManual,
} from "#/core/report.js";
import { partitionResults } from "#/core/result.js";
import { prepareRun, recheckAfterFix } from "#/core/run.js";
import { isInteractive, selectFixes } from "#/core/select.js";

type FixOptions = DesiredStateOption &
	ScopeOptions & { all?: boolean; diff?: boolean; dryRun?: boolean; strict?: boolean };

async function run(options: FixOptions): Promise<number> {
	const start = performance.now();
	const elapsed = (): string => formatDuration(performance.now() - start);
	const { results, ...ctx } = await prepareRun(options);
	const { failed, fixable, manual } = partitionResults(results);

	if (failed.length === 0) {
		console.log(`All conform checks passed in ${elapsed()}.`);
		return 0;
	}

	reportManual(manual);

	if (fixable.length === 0) {
		console.log(`\n${failed.length} result(s) failing (0 fixable) in ${elapsed()}.`);
		return 1;
	}

	if (options.dryRun) {
		if (options.diff !== false) {
			renderFixDiffs(fixable);
		}
		printDryRun(fixable, performance.now() - start);
		return 1;
	}

	if (options.all === true && !isInteractive()) {
		const refusal = unattendedRefusal(fixable, ctx.desiredState.dir);
		if (refusal !== undefined) {
			console.error(refusal);
			return 2;
		}
	}

	const selection = await selectFixes(fixable, options.all);
	if (selection.kind === "no-tty") {
		console.error(`Not a TTY: run again with --all to fix non-interactively. (${elapsed()})`);
		return 2;
	}
	if (selection.kind === "cancelled") {
		const prompts = await import("@clack/prompts");
		prompts.outro(`No fixes made in ${elapsed()}.`);
		return 1;
	}
	if (options.diff !== false) {
		renderFixDiffs(selection.selected);
	}
	const fixed = await fixSelectedAcrossScopes({
		home: ctx.home,
		registry: ctx.registry,
		selected: selection.selected,
		state: machineStateOf(ctx.desiredState),
	});

	const recheckResults = await recheckAfterFix(ctx, results, selection.selected);
	const remaining = recheckResults.filter((item) => !item.ok && item.skipped !== true);
	const elapsedMs = performance.now() - start;
	console.log(
		`\nFixed ${fixed.length}/${selection.selected.length}. ${remaining.length} result(s) still failing in ${formatDuration(elapsedMs)}.`,
	);
	if (remaining.length > 0) {
		printResults(recheckResults, undefined, { verbose: false });
		return 1;
	}
	await outroAllPassed(elapsedMs);
	return 0;
}

export const fixCommand = {
	configure: (cmd: Command): Command =>
		cmd
			.description("Interactively fix drift (space to select, enter to confirm).")
			.option("--all", "Fix all fixable items without prompting.")
			.option("--dry-run", "Show what would be fixed without writing.")
			.option("--no-diff", "Hide the diff preview.")
			.option("--strict", "Also remove undeclared machine packages (extras).")
			.option("--project-only", "Only fix project checks.")
			.option("--machine-only", "Only fix machine checks.")
			.option("--github-only", "Only fix GitHub repo checks."),
	name: "fix",
	run,
};

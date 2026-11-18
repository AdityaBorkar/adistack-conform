import { isAbsolute, relative, resolve } from "node:path";

import type { Command } from "commander";

import { applyMachineFixes } from "#/commands/fix/run.js";
import { isInteractive, resolveSelection } from "#/commands/fix/select.js";
import { machineStateOf } from "#/utils/config.js";
import { errorMessage } from "#/utils/fs.js";
import {
	formatDuration,
	outroAllPassed,
	printDryRun,
	printResults,
	renderFixDiffs,
	reportManual,
} from "#/utils/output.js";
import type { CheckResult } from "#/utils/result.js";
import { partitionResults } from "#/utils/result.js";
import type { ScopeOptions } from "#/utils/run.js";
import { prepareRun, recheckSelected, runAllChecks } from "#/utils/run.js";

export type FixCmdOptions = ScopeOptions & { all?: boolean; diff?: boolean; dryRun?: boolean };

function isInsideDir(filePath: string, dir: string): boolean {
	const rel = relative(resolve(dir), resolve(filePath));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function runFixCommand(cmd: Command, cmdOptions: FixCmdOptions): Promise<number> {
	const start = performance.now();
	const { cwd, desiredStates, home, only, registries, results } = await prepareRun(cmd, cmdOptions);
	const { failed, fixable, manual } = partitionResults(results);

	if (failed.length === 0) {
		console.log(`All conform checks passed in ${formatDuration(performance.now() - start)}.`);
		return 0;
	}

	reportManual(manual);

	if (fixable.length === 0) {
		console.log(
			`\n${failed.length} result(s) failing (0 fixable) in ${formatDuration(performance.now() - start)}.`,
		);
		return 1;
	}

	if (cmdOptions.dryRun) {
		if (cmdOptions.diff !== false) {
			renderFixDiffs(fixable);
		}
		printDryRun(fixable, performance.now() - start);
		return 1;
	}

	if (cmdOptions.all === true && !isInteractive()) {
		const risky = fixable.filter(
			(item) =>
				item.fix?.kind === "run-command" ||
				item.fix?.kind === "symlink" ||
				item.fix?.kind === "github-api",
		);
		if (risky.length > 0) {
			console.error(
				`Refusing --all in non-TTY: ${risky.length} fix(es) run commands or edit GitHub (${risky.map((item) => item.id).join(", ")}). Run again in a terminal or select file-only fixes.`,
			);
			return 2;
		}
		const outside = fixable.filter(
			(item) => item.fix?.kind === "overwrite-file" && !isInsideDir(item.fix.filePath, cwd),
		);
		if (outside.length > 0) {
			console.error(
				`Refusing --all in non-TTY: ${outside.length} file fix(es) write outside the project dir (${outside.map((item) => item.id).join(", ")}). Run again in a terminal to confirm.`,
			);
			return 2;
		}
	}

	const selection = await resolveSelection(fixable, cmdOptions.all);
	if (selection.kind === "no-tty") {
		console.error(
			`Not a TTY: run again with --all to fix non-interactively. (${formatDuration(performance.now() - start)})`,
		);
		return 2;
	}
	if (selection.kind === "cancelled") {
		const prompts = await import("@clack/prompts");
		prompts.outro(`No fixes made in ${formatDuration(performance.now() - start)}.`);
		return 1;
	}
	if (cmdOptions.diff !== false) {
		renderFixDiffs(selection.selected);
	}
	const states = desiredStates.flatMap((loaded) => {
		const state = machineStateOf(loaded);
		return state === undefined ? [] : [state];
	});
	const fixed = await applyMachineFixes({ home, registries, selected: selection.selected, states });

	let recheckResults: CheckResult[];
	try {
		const selectedIds = new Set(selection.selected.map((item) => item.id));
		const rechecked = await recheckSelected({
			cwd,
			desiredStates,
			home,
			only,
			registries,
			selectedIds,
		});
		const byId = new Map(rechecked.map((item) => [item.id, item]));
		recheckResults = results.map((item) => byId.get(item.id) ?? item);
	} catch (error) {
		console.error(`Selective re-check failed, running a full re-check: ${errorMessage(error)}`);
		const recheck = await runAllChecks({ cwd, desiredStates, home, only, registries });
		recheckResults = recheck.results;
	}
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

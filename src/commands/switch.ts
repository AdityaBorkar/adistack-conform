import type { Command } from "commander";

import { applyMachineFixes } from "#/commands/fix/run.js";
import { machineStateOf } from "#/utils/config.js";
import { defaultHome } from "#/utils/fs.js";
import { formatDuration, printDryRun, printResults, reportManual } from "#/utils/output.js";
import type { CheckResult } from "#/utils/result.js";
import { partitionResults } from "#/utils/result.js";
import { fetchRegistries, loadDesiredStatesFromCommand, runMachineStates } from "#/utils/run.js";

export type SwitchCmdOptions = { dryRun?: boolean };

export async function runSwitchCommand(
	cmd: Command,
	cmdOptions: SwitchCmdOptions,
): Promise<number> {
	const start = performance.now();
	const desiredStates = await loadDesiredStatesFromCommand(cmd);
	const states = desiredStates.flatMap((loaded) => {
		const state = machineStateOf(loaded);
		return state === undefined ? [] : [state];
	});
	if (states.length === 0) {
		console.error("Switch: no machine desired state configured.");
		return 2;
	}
	const registries = await fetchRegistries(desiredStates, "machine");
	const home = defaultHome();

	async function drift(): Promise<{ elapsedMs: number; results: CheckResult[] }> {
		const driftStart = performance.now();
		const results = await runMachineStates(states, registries, "drift");
		return { elapsedMs: performance.now() - driftStart, results };
	}

	let current = await drift();
	printResults(current.results, { machine: current.elapsedMs });
	const { failed, fixable, manual } = partitionResults(current.results);
	if (failed.length === 0) {
		console.log(`Machine in sync in ${formatDuration(performance.now() - start)}.`);
		return 0;
	}
	reportManual(manual);

	if (cmdOptions.dryRun) {
		printDryRun(fixable, performance.now() - start);
		return 1;
	}

	const fixed = await applyMachineFixes({ home, registries, selected: fixable, states });

	current = await drift();
	const remaining = current.results.filter((item) => !item.ok && item.skipped !== true);
	console.log(
		`\nFixed ${fixed.length}/${fixable.length}. ${remaining.length} result(s) still failing in ${formatDuration(performance.now() - start)}.`,
	);
	if (remaining.length > 0) {
		printResults(current.results, { machine: current.elapsedMs });
		return 1;
	}
	console.log("Machine in sync.");
	return 0;
}

import type { Command } from "commander";

import type { DesiredStateOption } from "#/core/config.js";
import { loadDesiredStates, machineStatesOf } from "#/core/config.js";
import { applyMachineFixes } from "#/core/machine/fix.js";
import { formatDuration, printDryRun, printResults, reportManual } from "#/core/report.js";
import type { CheckResult } from "#/core/result.js";
import { partitionResults } from "#/core/result.js";
import { runMachineStates } from "#/core/run.js";
import { fetchRegistries } from "#/core/upstream/registries.js";
import { defaultHome } from "#/utils/fs.js";

type SwitchOptions = DesiredStateOption & { dryRun?: boolean };

async function run(options: SwitchOptions): Promise<number> {
	const start = performance.now();
	const desiredStates = await loadDesiredStates(options.desiredState);
	const states = machineStatesOf(desiredStates);
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

	if (options.dryRun) {
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

export const switchCommand = {
	configure: (cmd: Command): Command =>
		cmd
			.description("Enforce the machine blueprint state (drift mode).")
			.option("--dry-run", "Show drift without writing."),
	name: "switch",
	run,
};

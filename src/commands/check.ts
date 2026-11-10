import type { Command } from "commander";

import { printJsonSummary, printResults } from "#/utils/output.js";
import type { ScopeOptions } from "#/utils/run.js";
import { prepareRun } from "#/utils/run.js";

export type CheckCmdOptions = ScopeOptions & { json?: boolean; verbose?: boolean };

export async function runCheckCommand(cmd: Command, cmdOptions: CheckCmdOptions): Promise<number> {
	const { desiredStates, githubElapsedMs, machineElapsedMs, projectElapsedMs, results } =
		await prepareRun(cmd, cmdOptions);
	if (cmdOptions.json) {
		printJsonSummary(
			desiredStates.map((entry) => entry.path),
			results,
		);
	} else {
		printResults(
			results,
			{
				github: githubElapsedMs,
				machine: machineElapsedMs,
				project: projectElapsedMs,
			},
			{ verbose: cmdOptions.verbose === true },
		);
	}
	return results.some((item) => !item.ok) ? 1 : 0;
}

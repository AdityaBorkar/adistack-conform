import type { Command } from "commander";

import type { DesiredStateOption, ScopeOptions } from "#/core/config.js";
import { printJsonSummary, printResults } from "#/core/report.js";
import { prepareRun } from "#/core/run.js";

type CheckOptions = DesiredStateOption & ScopeOptions & { json?: boolean; verbose?: boolean };

async function run(options: CheckOptions): Promise<number> {
	const { desiredStates, githubElapsedMs, machineElapsedMs, projectElapsedMs, results } =
		await prepareRun(options);
	if (options.json) {
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
			{ verbose: options.verbose === true },
		);
	}
	return results.some((item) => !item.ok && item.skipped !== true) ? 1 : 0;
}

export const checkCommand = {
	configure: (cmd: Command): Command =>
		cmd
			.description(
				"Check the desired state in the current directory against the current project/machine/repo.",
			)
			.option("--json", "Print machine-readable JSON.")
			.option("--verbose", "Show passing results too.")
			.option("--project-only", "Only run project checks.")
			.option("--machine-only", "Only run machine checks.")
			.option("--github-only", "Only run GitHub repo checks."),
	name: "check",
	run,
};

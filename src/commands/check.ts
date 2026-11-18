import type { Command } from "commander";

import type { ConfigPathOption, ScopeOptions } from "#/core/config.js";
import { printJsonSummary, printResults } from "#/core/report.js";
import { isDrift } from "#/core/result.js";
import { prepareRun } from "#/core/run.js";

type CheckOptions = ConfigPathOption &
	ScopeOptions & {
		json?: boolean;
		strict?: boolean;
		verbose?: boolean;
	};

async function run(options: CheckOptions): Promise<number> {
	const { desiredState, elapsedMs, results } = await prepareRun(options);
	if (options.json) {
		printJsonSummary(desiredState.path, results);
	} else {
		printResults(results, elapsedMs, { verbose: options.verbose === true });
	}
	return results.some((item) => isDrift(item)) ? 1 : 0;
}

export const checkCommand = {
	configure: (cmd: Command): Command =>
		cmd
			.description(
				"Check the desired state in the current directory against the current project/machine/repo.",
			)
			.option("--path <path>", "Path to conform.json (default: ./conform.json).")
			.option("--json", "Print machine-readable JSON.")
			.option("--verbose", "Show passing results too.")
			.option("--strict", "Report undeclared machine packages (extras) as drift.")
			.option("--project-only", "Only run project checks.")
			.option("--machine-only", "Only run machine checks.")
			.option("--github-only", "Only run GitHub repo checks."),
	name: "check",
	run,
};

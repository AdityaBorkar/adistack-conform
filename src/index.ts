#!/usr/bin/env bun
import { Command } from "commander";

import { runCheckCommand, type CheckCmdOptions } from "#/commands/check.js";
import { runFixCommand, type FixCmdOptions } from "#/commands/fix/command.js";
import { runValidateCommand } from "#/commands/validate.js";
import { errorMessage } from "#/utils/fs.js";

const VERSION = "0.1.0";

function failWith(error: unknown): never {
	console.error(errorMessage(error));
	process.exit(2);
}

const program = new Command();
program
	.description(
		"Check the current project/machine/repo against the desired state in the current directory.",
	)
	.name("adistack-conform")
	.option("--desired-state <path>", "Path to conform.json (default: walks up from the cwd)")
	.version(VERSION);

program
	.command("check")
	.description(
		"Check the desired state in the current directory against the current project/machine/repo.",
	)
	.option("--json", "Print machine-readable JSON.")
	.option("--verbose", "Show passing results too.")
	.option("--project-only", "Only run project checks.")
	.option("--machine-only", "Only run machine checks.")
	.option("--github-only", "Only run GitHub repo checks.")
	.action(async (cmdOptions: CheckCmdOptions, cmd: Command) => {
		try {
			process.exit(await runCheckCommand(cmd, cmdOptions));
		} catch (error) {
			failWith(error);
		}
	});

program
	.command("fix")
	.description("Interactively fix drift (space to select, enter to apply).")
	.option("--all", "Apply all fixable items without prompting.")
	.option("--dry-run", "Show what would be fixed without writing.")
	.option("--no-diff", "Hide the diff preview.")
	.option("--project-only", "Only fix project checks.")
	.option("--machine-only", "Only fix machine checks.")
	.option("--github-only", "Only fix GitHub repo checks.")
	.action(async (cmdOptions: FixCmdOptions, cmd: Command) => {
		try {
			process.exit(await runFixCommand(cmd, cmdOptions));
		} catch (error) {
			failWith(error);
		}
	});

program
	.command("validate")
	.description("Validate the tech-stack registry.json and blueprint files.")
	.action(async (_cmdOptions: Record<string, never>, cmd: Command) => {
		try {
			process.exit(await runValidateCommand(cmd));
		} catch (error) {
			failWith(error);
		}
	});

void program.parseAsync(process.argv).catch((error: unknown) => {
	failWith(error);
});

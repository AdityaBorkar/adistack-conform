#!/usr/bin/env bun
import * as prompts from "@clack/prompts";
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import { partitionResults } from "#/checks.js";
import type { LoadedConfig } from "#/config.js";
import { discoverConfigs, loadConfig } from "#/config.js";
import { applySelected, resolveSelection } from "#/fix.js";
import { runTechStackChecks } from "#/techstack.js";
import { defaultHome, errorMessage } from "#/utils/fs.js";
import {
	outroAllPassed,
	printDryRun,
	printJsonSummary,
	printResults,
	printWarning,
	renderFixDiffs,
	reportUnfixable,
} from "#/utils/output.js";

const VERSION = "0.1.0";

type ScopeOptions = { machineOnly?: boolean; projectOnly?: boolean };
type CacheOptions = { cache?: boolean };
type CheckCmdOptions = CacheOptions & ScopeOptions & { json?: boolean };
type FixCmdOptions = CacheOptions &
	ScopeOptions & { all?: boolean; diff?: boolean; dryRun?: boolean };

function scopeOf(options: ScopeOptions): CheckScope | undefined {
	if (options.projectOnly && options.machineOnly) {
		throw new Error("Pass only one of --project-only / --machine-only.");
	}
	if (options.projectOnly) {
		return "project";
	}
	if (options.machineOnly) {
		return "machine";
	}
	return undefined;
}

async function loadConfigsFromCommand(cmd: Command): Promise<LoadedConfig[]> {
	const config = cmd.optsWithGlobals<{ config?: string }>().config;
	if (config !== undefined) {
		return [await loadConfig(config)];
	}
	return discoverConfigs();
}

function failWith(error: unknown): never {
	console.error(errorMessage(error));
	process.exit(2);
}

async function runAllChecks(args: {
	configs: LoadedConfig[];
	cwd: string;
	home: string;
	only: CheckScope | undefined;
	noCache: boolean;
}): Promise<{ results: CheckResult[]; warnings: string[] }> {
	const tasks = args.configs
		.filter((loaded) => args.only === undefined || args.only === loaded.kind)
		.map((loaded) =>
			runTechStackChecks(loaded.spec, {
				baseDir: loaded.kind === "project" ? args.cwd : args.home,
				home: args.home,
				noCache: args.noCache,
				scope: loaded.kind,
			}),
		);
	const outputs = await Promise.all(tasks);
	return {
		results: outputs.flatMap((output) => output.results),
		warnings: outputs.flatMap((output) => output.warnings),
	};
}

function emitWarnings(warnings: string[]): void {
	for (const warning of warnings) {
		printWarning(warning);
	}
}

async function prepareRun(cmd: Command, cmdOptions: CacheOptions & ScopeOptions) {
	const only = scopeOf(cmdOptions);
	const configs = await loadConfigsFromCommand(cmd);
	const cwd = process.cwd();
	const home = defaultHome();
	const noCache = cmdOptions.cache === false;
	const { results, warnings } = await runAllChecks({ configs, cwd, home, noCache, only });
	return { configs, cwd, home, noCache, only, results, warnings };
}

async function runCheckCommand(cmd: Command, cmdOptions: CheckCmdOptions): Promise<number> {
	const { configs, results, warnings } = await prepareRun(cmd, cmdOptions);
	emitWarnings(warnings);
	if (cmdOptions.json) {
		printJsonSummary(
			configs.map((entry) => entry.path),
			results,
		);
	} else {
		printResults(results);
	}
	return results.some((item) => !item.ok) ? 1 : 0;
}

async function runFixCommand(cmd: Command, cmdOptions: FixCmdOptions): Promise<number> {
	const { configs, cwd, home, noCache, only, results, warnings } = await prepareRun(
		cmd,
		cmdOptions,
	);
	emitWarnings(warnings);
	const { failed, fixable, unfixable } = partitionResults(results);

	if (failed.length === 0) {
		console.log("All conform checks passed.");
		return 0;
	}

	reportUnfixable(unfixable);

	if (fixable.length === 0) {
		return 1;
	}

	if (cmdOptions.diff !== false) {
		renderFixDiffs(fixable);
	}

	if (cmdOptions.dryRun) {
		printDryRun(fixable);
		return 1;
	}

	const selection = await resolveSelection(fixable, cmdOptions.all);
	if (selection.kind === "no-tty") {
		console.error("Not a TTY: re-run with --all to apply fixes non-interactively.");
		return 2;
	}
	if (selection.kind === "cancelled") {
		prompts.outro("No fixes applied.");
		return 1;
	}
	const applied = await applySelected(selection.selected);

	const rerun = await runAllChecks({ configs, cwd, home, noCache, only });
	emitWarnings(rerun.warnings);
	const remaining = rerun.results.filter((item) => !item.ok);
	console.log(
		`\nFixed ${applied}/${selection.selected.length}. ${remaining.length} check(s) still failing.`,
	);
	if (remaining.length > 0) {
		printResults(rerun.results);
		return 1;
	}
	outroAllPassed();
	return 0;
}

const program = new Command();
program
	.description("Check the current project/machine against the config in the current directory.")
	.name("adistack-conform")
	.option(
		"--config <path>",
		"Path to conform.project.json or conform.machine.json (default: whatever config is in the cwd)",
	)
	.version(VERSION);

program
	.command("check")
	.description("Check the config in the current directory against the current project/machine.")
	.option("--json", "Print machine-readable JSON.")
	.option("--project-only", "Only run project checks.")
	.option("--no-cache", "Re-download tech-stack blueprints/presets, ignoring the cache.")
	.option("--machine-only", "Only run machine checks.")
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
	.option("--all", "Apply all auto-fixable items without prompting.")
	.option("--dry-run", "Show what would be fixed without writing.")
	.option("--no-diff", "Hide the diff preview.")
	.option("--project-only", "Only fix project checks.")
	.option("--no-cache", "Re-download tech-stack blueprints/presets, ignoring the cache.")
	.option("--machine-only", "Only fix machine checks.")
	.action(async (cmdOptions: FixCmdOptions, cmd: Command) => {
		try {
			process.exit(await runFixCommand(cmd, cmdOptions));
		} catch (error) {
			failWith(error);
		}
	});

program.parseAsync(process.argv);

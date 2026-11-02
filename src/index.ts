#!/usr/bin/env bun
import * as prompts from "@clack/prompts";
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { LoadedConfig } from "#/config.js";
import { defaultHome, discoverConfigs, loadConfig } from "#/config.js";
import {
	applySelected,
	partitionResults,
	printDryRun,
	promptForSelection,
	renderFixDiffs,
	reportUnfixable,
} from "#/fix.js";
import { errorMessage } from "#/fs.js";
import { printResults } from "#/output.js";
import { runTechStackChecks } from "#/techstack.js";

const VERSION = "0.1.0";

type ScopeOptions = { machineOnly?: boolean; projectOnly?: boolean };
type CacheOptions = { cache?: boolean };

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

async function runAllChecks(
	configs: LoadedConfig[],
	only: CheckScope | undefined,
	noCache: boolean,
): Promise<CheckResult[]> {
	const cwd = process.cwd();
	const home = defaultHome();
	const tasks = configs
		.filter((loaded) => only === undefined || only === loaded.kind)
		.map((loaded) =>
			runTechStackChecks(loaded.spec, {
				baseDir: loaded.kind === "project" ? cwd : home,
				home,
				noCache,
				scope: loaded.kind,
			}),
		);
	return (await Promise.all(tasks)).flat();
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
	.action(async (cmdOptions: CacheOptions & ScopeOptions & { json?: boolean }, cmd: Command) => {
		try {
			const only = scopeOf(cmdOptions);
			const configs = await loadConfigsFromCommand(cmd);
			const results = await runAllChecks(configs, only, cmdOptions.cache === false);
			if (cmdOptions.json) {
				const failed = results.filter((item) => !item.ok);
				console.log(
					JSON.stringify(
						{
							configs: configs.map((entry) => entry.path),
							failed: failed.length,
							ok: failed.length === 0,
							passed: results.length - failed.length,
							results,
							total: results.length,
						},
						null,
						2,
					),
				);
			} else {
				printResults(results);
			}
			process.exit(results.some((item) => !item.ok) ? 1 : 0);
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
	.action(
		async (
			cmdOptions: CacheOptions & ScopeOptions & { all?: boolean; diff?: boolean; dryRun?: boolean },
			cmd: Command,
		) => {
			try {
				const only = scopeOf(cmdOptions);
				const configs = await loadConfigsFromCommand(cmd);
				const results = await runAllChecks(configs, only, cmdOptions.cache === false);
				const { failed, fixable, unfixable } = partitionResults(results);

				if (failed.length === 0) {
					console.log("All conform checks passed.");
					process.exit(0);
				}

				reportUnfixable(unfixable);

				if (fixable.length === 0) {
					process.exit(1);
				}

				if (cmdOptions.dryRun) {
					printDryRun(fixable);
					process.exit(1);
				}

				if (cmdOptions.diff !== false) {
					await renderFixDiffs(fixable);
				}

				let selected: CheckResult[] = fixable;
				if (!cmdOptions.all) {
					const outcome = await promptForSelection(fixable);
					if (outcome.kind === "no-tty") {
						console.error("Not a TTY: re-run with --all to apply fixes non-interactively.");
						process.exit(2);
					}
					if (outcome.kind === "cancelled") {
						prompts.outro("No fixes applied.");
						process.exit(1);
					}
					selected = outcome.selected;
				}
				const applied = await applySelected(selected);

				const rerun = await runAllChecks(configs, only, cmdOptions.cache === false);
				const remaining = rerun.filter((item) => !item.ok);
				console.log(
					`\nFixed ${applied}/${selected.length}. ${remaining.length} check(s) still failing.`,
				);
				if (remaining.length > 0) {
					printResults(rerun);
					process.exit(1);
				}
				prompts.outro("All conform checks passed.");
				process.exit(0);
			} catch (error) {
				failWith(error);
			}
		},
	);

program.parseAsync(process.argv);

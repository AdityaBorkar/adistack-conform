#!/usr/bin/env bun
import * as prompts from "@clack/prompts";
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { LoadedConfig } from "#/config.js";
import { defaultHome, discoverConfigs, loadConfig } from "#/config.js";
import {
	applySelected,
	printDryRun,
	promptForSelection,
	renderFixDiffs,
	reportUnfixable,
} from "#/fix.js";
import { printResults } from "#/output.js";
import { runTechStackChecks } from "#/techstack.js";

const VERSION = "0.1.0";

function scopeOf(options: {
	machineOnly?: boolean;
	projectOnly?: boolean;
}): CheckScope | undefined {
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

function shouldRun(kind: CheckScope, only: CheckScope | undefined): boolean {
	return only === undefined || only === kind;
}

function baseDirFor(kind: CheckScope, cwd: string, home: string): string {
	return kind === "project" ? cwd : home;
}

async function runAllChecks(
	configs: LoadedConfig[],
	only: CheckScope | undefined,
	noCache: boolean,
): Promise<CheckResult[]> {
	const cwd = process.cwd();
	const home = defaultHome();
	const tasks = configs
		.filter((loaded) => shouldRun(loaded.kind, only))
		.map((loaded) =>
			runTechStackChecks(loaded.spec, {
				baseDir: baseDirFor(loaded.kind, cwd, home),
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
	.action(
		async (
			cmdOptions: {
				cache?: boolean;
				json?: boolean;
				machineOnly?: boolean;
				projectOnly?: boolean;
			},
			cmd: Command,
		) => {
			const config = cmd.optsWithGlobals<{ config?: string }>().config;
			try {
				const only = scopeOf(cmdOptions);
				const configs = config === undefined ? await discoverConfigs() : [await loadConfig(config)];
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
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(2);
			}
		},
	);

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
			cmdOptions: {
				all?: boolean;
				cache?: boolean;
				diff?: boolean;
				dryRun?: boolean;
				machineOnly?: boolean;
				projectOnly?: boolean;
			},
			cmd: Command,
		) => {
			const config = cmd.optsWithGlobals<{ config?: string }>().config;
			const showDiff = cmdOptions.diff !== false;
			try {
				const only = scopeOf(cmdOptions);
				const configs = config === undefined ? await discoverConfigs() : [await loadConfig(config)];
				const results = await runAllChecks(configs, only, cmdOptions.cache === false);
				const failed = results.filter((item) => !item.ok);
				const fixable = failed.filter((item) => item.fixable);
				const unfixable = failed.filter((item) => !item.fixable);

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

				if (showDiff) {
					await renderFixDiffs(fixable);
				}

				const selected = cmdOptions.all ? fixable : await promptForSelection(fixable);
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
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(2);
			}
		},
	);

program.parseAsync(process.argv);

#!/usr/bin/env bun
import * as prompts from "@clack/prompts";
import { Command } from "commander";

import type { CheckScope, CheckResult } from "#/checks.js";
import { applyFix, desiredContent, readActualContent } from "#/checks.js";
import type { LoadedConfig } from "#/config.js";
import { defaultHome, discoverConfigs, loadConfig } from "#/config.js";
import { renderDiff } from "#/diff.js";
import { printResults } from "#/output.js";
import { runTechStackChecks } from "#/techstack.js";

const VERSION = "0.1.0";

function scopeOf(options: {
	projectOnly?: boolean;
	machineOnly?: boolean;
}): CheckScope | undefined {
	if (options.projectOnly === true && options.machineOnly === true) {
		throw new Error("Pass only one of --project-only / --machine-only.");
	}
	if (options.projectOnly === true) {
		return "project";
	}
	if (options.machineOnly === true) {
		return "machine";
	}
	return undefined;
}

function baseOptions(cmd: Command): { config?: string } {
	const globals = cmd.optsWithGlobals<{ config?: string }>();
	return { config: globals.config };
}

async function loadConfigs(config: string | undefined): Promise<LoadedConfig[]> {
	if (config !== undefined) {
		return [await loadConfig(config)];
	}
	return discoverConfigs();
}

async function runAllChecks(
	configs: LoadedConfig[],
	only: CheckScope | undefined,
	noCache: boolean,
): Promise<CheckResult[]> {
	const home = defaultHome();
	const results: CheckResult[] = [];
	for (const loaded of configs) {
		if (loaded.kind === "project") {
			if (only !== "machine") {
				results.push(
					...(await runTechStackChecks(loaded.spec, {
						baseDir: process.cwd(),
						home,
						noCache,
						scope: "project",
					})),
				);
			}
		} else if (only !== "project") {
			results.push(
				...(await runTechStackChecks(loaded.spec, {
					baseDir: home,
					home,
					noCache,
					scope: "machine",
				})),
			);
		}
	}
	return results;
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
				projectOnly?: boolean;
				machineOnly?: boolean;
			},
			cmd: Command,
		) => {
			const base = baseOptions(cmd);
			try {
				const only = scopeOf(cmdOptions);
				const configs = await loadConfigs(base.config);
				const results = await runAllChecks(configs, only, cmdOptions.cache === false);
				if (cmdOptions.json === true) {
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
				projectOnly?: boolean;
				machineOnly?: boolean;
			},
			cmd: Command,
		) => {
			const base = baseOptions(cmd);
			const showDiff = cmdOptions.diff !== false;
			try {
				const only = scopeOf(cmdOptions);
				const configs = await loadConfigs(base.config);
				const results = await runAllChecks(configs, only, cmdOptions.cache === false);
				const failed = results.filter((item) => !item.ok);
				const fixable = failed.filter((item) => item.fixable);
				const unfixable = failed.filter((item) => !item.fixable);

				if (failed.length === 0) {
					console.log("All conform checks passed.");
					process.exit(0);
				}

				for (const item of unfixable) {
					console.error(`✗ ${item.id} cannot be auto-fixed.`);
					console.error(`    target   : ${item.target}`);
					console.error(`    expected : ${item.expected}`);
					console.error(`    actual   : ${item.actual}`);
					if (item.hint) {
						console.error(`    fix manually: ${item.hint}`);
					}
				}

				if (fixable.length === 0) {
					process.exit(1);
				}

				if (showDiff) {
					const rendered = await Promise.all(
						fixable.map(async (item) => {
							const actual = await readActualContent(item);
							return `\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", actual, desiredContent(item))}`;
						}),
					);
					for (const text of rendered) {
						console.log(text);
					}
				}

				let selected: CheckResult[] = fixable;
				if (cmdOptions.all !== true) {
					if (cmdOptions.dryRun === true) {
						console.log(`\nDry run: ${fixable.length} item(s) would be fixed.`);
						for (const item of fixable) {
							console.log(`  - ${item.id} (${item.target})`);
						}
						process.exit(1);
					}
					if (!process.stdin.isTTY) {
						console.error("Not a TTY: re-run with --all to apply fixes non-interactively.");
						process.exit(2);
					}
					prompts.intro("Select fixes to apply (space to toggle, enter to confirm).");
					const choice = await prompts.multiselect({
						message: "Pick items to fix.",
						options: [
							{ label: `Select all (${fixable.length} items)`, value: "__all" },
							...fixable.map((item) => ({
								hint: item.target,
								label: item.id,
								value: item.id,
							})),
						],
						required: false,
					});
					if (prompts.isCancel(choice) || choice.length === 0) {
						prompts.outro("No fixes applied.");
						process.exit(1);
					}
					const ids = new Set(choice as string[]);
					if (ids.has("__all")) {
						selected = fixable;
					} else {
						selected = fixable.filter((item) => ids.has(item.id));
					}
					if (selected.length === 0) {
						prompts.outro("No fixes applied.");
						process.exit(1);
					}
				} else if (cmdOptions.dryRun === true) {
					console.log(`Dry run: ${fixable.length} item(s) would be fixed.`);
					for (const item of fixable) {
						console.log(`  - ${item.id} (${item.target})`);
					}
					process.exit(1);
				}

				let applied = 0;
				for (const item of selected) {
					try {
						await applyFix(item);
						applied += 1;
						console.log(`✓ fixed ${item.id}`);
					} catch (error) {
						console.error(
							`✗ not fixed ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

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

#!/usr/bin/env bun
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import { partitionResults } from "#/checks.js";
import type { LoadedConform } from "#/config.js";
import { discoverConfigs, loadConfig, machineSpecOf, projectSpecOf } from "#/config.js";
import { applySelected, resolveSelection } from "#/fix.js";
import { recheckMachineSelected, runMachineChecks } from "#/techstack-machine.js";
import { recheckProjectSelected, runProjectChecks } from "#/techstack.js";
import { defaultHome, errorMessage } from "#/utils/fs.js";
import {
	formatDuration,
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

async function loadConfigsFromCommand(cmd: Command): Promise<LoadedConform[]> {
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

async function timed<T>(task: Promise<T>): Promise<{ elapsedMs: number; value: T }> {
	const start = performance.now();
	const value = await task;
	return { elapsedMs: performance.now() - start, value };
}

async function runAllChecks(args: {
	configs: LoadedConform[];
	cwd: string;
	home: string;
	only: CheckScope | undefined;
	noCache: boolean;
}): Promise<{
	machineElapsedMs: number | undefined;
	projectElapsedMs: number | undefined;
	results: CheckResult[];
	warnings: string[];
}> {
	const projectTasks: Promise<{ results: CheckResult[]; warnings: string[] }>[] = [];
	const machineTasks: Promise<{ results: CheckResult[]; warnings: string[] }>[] = [];
	for (const loaded of args.configs) {
		if (args.only === undefined || args.only === "project") {
			const spec = projectSpecOf(loaded);
			if (spec !== undefined) {
				projectTasks.push(
					runProjectChecks(spec, {
						baseDir: args.cwd,
						home: args.home,
						noCache: args.noCache,
						scope: "project",
					}),
				);
			}
		}
		if (args.only === undefined || args.only === "machine") {
			const spec = machineSpecOf(loaded);
			if (spec !== undefined) {
				machineTasks.push(
					runMachineChecks(spec, {
						baseDir: args.home,
						home: args.home,
						noCache: args.noCache,
						scope: "machine",
					}),
				);
			}
		}
	}
	const [project, machine] = await Promise.all([
		timed(Promise.all(projectTasks)),
		timed(Promise.all(machineTasks)),
	]);
	const projectOutputs = project.value;
	const machineOutputs = machine.value;
	return {
		machineElapsedMs: machineTasks.length > 0 ? machine.elapsedMs : undefined,
		projectElapsedMs: projectTasks.length > 0 ? project.elapsedMs : undefined,
		results: [
			...projectOutputs.flatMap((output) => output.results),
			...machineOutputs.flatMap((output) => output.results),
		],
		warnings: [
			...projectOutputs.flatMap((output) => output.warnings),
			...machineOutputs.flatMap((output) => output.warnings),
		],
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
	const run = await runAllChecks({ configs, cwd, home, noCache, only });
	return { configs, cwd, home, noCache, only, ...run };
}

async function runCheckCommand(cmd: Command, cmdOptions: CheckCmdOptions): Promise<number> {
	const { configs, machineElapsedMs, projectElapsedMs, results, warnings } = await prepareRun(
		cmd,
		cmdOptions,
	);
	emitWarnings(warnings);
	if (cmdOptions.json) {
		printJsonSummary(
			configs.map((entry) => entry.path),
			results,
		);
	} else {
		printResults(results, { machine: machineElapsedMs, project: projectElapsedMs });
	}
	return results.some((item) => !item.ok) ? 1 : 0;
}

async function runFixCommand(cmd: Command, cmdOptions: FixCmdOptions): Promise<number> {
	const start = performance.now();
	const { configs, cwd, home, noCache, only, results, warnings } = await prepareRun(
		cmd,
		cmdOptions,
	);
	emitWarnings(warnings);
	const { failed, fixable, unfixable } = partitionResults(results);

	if (failed.length === 0) {
		console.log(`All conform checks passed in ${formatDuration(performance.now() - start)}.`);
		return 0;
	}

	reportUnfixable(unfixable);

	if (fixable.length === 0) {
		console.log(
			`\n${failed.length} check(s) failing (0 fixable) in ${formatDuration(performance.now() - start)}.`,
		);
		return 1;
	}

	if (cmdOptions.dryRun) {
		if (cmdOptions.diff !== false) {
			await renderFixDiffs(fixable);
		}
		printDryRun(fixable, performance.now() - start);
		return 1;
	}

	const selection = await resolveSelection(fixable, cmdOptions.all);
	if (selection.kind === "no-tty") {
		console.error(
			`Not a TTY: re-run with --all to apply fixes non-interactively. (${formatDuration(performance.now() - start)})`,
		);
		return 2;
	}
	if (selection.kind === "cancelled") {
		const prompts = await import("@clack/prompts");
		prompts.outro(`No fixes applied in ${formatDuration(performance.now() - start)}.`);
		return 1;
	}
	if (cmdOptions.diff !== false) {
		await renderFixDiffs(selection.selected);
	}
	const applied = await applySelected(selection.selected);

	let rerunResults: CheckResult[];
	let rerunWarnings: string[] = [];
	try {
		const selectedIds = new Set(selection.selected.map((item) => item.id));
		const refreshed = await Promise.all(
			configs.map(async (loaded) => {
				const reruns: CheckResult[][] = [];
				if (only === undefined || only === "project") {
					const spec = projectSpecOf(loaded);
					if (spec !== undefined) {
						const scopedIds = new Set(
							[...selectedIds].filter((id) => id.startsWith(`project:${spec.blueprint}:`)),
						);
						if (scopedIds.size > 0) {
							reruns.push(
								await recheckProjectSelected(
									spec,
									{ baseDir: cwd, home, noCache, scope: "project" },
									scopedIds,
								),
							);
						}
					}
				}
				if (only === undefined || only === "machine") {
					const spec = machineSpecOf(loaded);
					if (spec !== undefined) {
						const scopedIds = new Set(
							[...selectedIds].filter((id) => id === `nix:${spec.blueprint}`),
						);
						if (scopedIds.size > 0) {
							reruns.push(
								await recheckMachineSelected(
									spec,
									{ baseDir: home, home, noCache, scope: "machine" },
									scopedIds,
								),
							);
						}
					}
				}
				return reruns.flat();
			}),
		);
		const byId = new Map(refreshed.flat().map((item) => [item.id, item]));
		rerunResults = results.map((item) => byId.get(item.id) ?? item);
	} catch {
		const rerun = await runAllChecks({ configs, cwd, home, noCache, only });
		rerunWarnings = rerun.warnings;
		rerunResults = rerun.results;
		emitWarnings(rerunWarnings);
	}
	const remaining = rerunResults.filter((item) => !item.ok);
	const elapsedMs = performance.now() - start;
	console.log(
		`\nFixed ${applied}/${selection.selected.length}. ${remaining.length} check(s) still failing in ${formatDuration(elapsedMs)}.`,
	);
	if (remaining.length > 0) {
		printResults(rerunResults);
		return 1;
	}
	await outroAllPassed(elapsedMs);
	return 0;
}

const program = new Command();
program
	.description("Check the current project/machine against the config in the current directory.")
	.name("adistack-conform")
	.option("--config <path>", "Path to conform.json (default: ./conform.json in the cwd)")
	.version(VERSION);

program
	.command("check")
	.description("Check the config in the current directory against the current project/machine.")
	.option("--json", "Print machine-readable JSON.")
	.option("--project-only", "Only run project checks.")
	.option("--no-cache", "Re-download tech-stack blueprints/flakes, ignoring the cache.")
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
	.option("--no-cache", "Re-download tech-stack blueprints/flakes, ignoring the cache.")
	.option("--machine-only", "Only fix machine checks.")
	.action(async (cmdOptions: FixCmdOptions, cmd: Command) => {
		try {
			process.exit(await runFixCommand(cmd, cmdOptions));
		} catch (error) {
			failWith(error);
		}
	});

program.parseAsync(process.argv);

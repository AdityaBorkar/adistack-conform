#!/usr/bin/env bun
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import { partitionResults } from "#/checks.js";
import type { LoadedConform } from "#/config.js";
import {
	discoverConfigs,
	loadConfig,
	githubSpecOf,
	machineSpecOf,
	projectSpecOf,
} from "#/config.js";
import { applySelected, resolveSelection } from "#/fix.js";
import { recheckGithubSelected, runGithubChecks } from "#/stack/github.js";
import { recheckProjectSelected, runProjectChecks } from "#/stack/index.js";
import { recheckMachineSelected, runMachineChecks } from "#/stack/machine.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchRegistry, repoKey } from "#/stack/remote.js";
import { defaultHome, errorMessage } from "#/utils/fs.js";
import {
	formatDuration,
	outroAllPassed,
	printDryRun,
	printJsonSummary,
	printResults,
	renderFixDiffs,
	reportUnfixable,
} from "#/utils/output.js";

const VERSION = "0.1.0";

type ScopeOptions = { githubOnly?: boolean; machineOnly?: boolean; projectOnly?: boolean };
type CheckCmdOptions = ScopeOptions & { json?: boolean };
type FixCmdOptions = ScopeOptions & { all?: boolean; diff?: boolean; dryRun?: boolean };

function scopeOf(options: ScopeOptions): CheckScope | undefined {
	const selected = [options.projectOnly, options.machineOnly, options.githubOnly].filter(
		(item) => item === true,
	).length;
	if (selected > 1) {
		throw new Error("Pass only one of --project-only / --machine-only / --github-only.");
	}
	if (options.projectOnly) {
		return "project";
	}
	if (options.machineOnly) {
		return "machine";
	}
	if (options.githubOnly) {
		return "github";
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

// One registry fetch per unique repo@ref, shared by every spec in the run,
// scoped to a single command: no hidden state, no stale entries.
async function fetchRegistries(
	configs: readonly LoadedConform[],
	only: CheckScope | undefined,
): Promise<Map<string, RegistryDocument>> {
	const wanted = new Map<string, { id: string; ref: string }>();
	for (const loaded of configs) {
		if (only === undefined || only === "project") {
			const spec = projectSpecOf(loaded);
			if (spec !== undefined) {
				wanted.set(repoKey(spec.id, spec.ref), { id: spec.id, ref: spec.ref });
			}
		}
		if (only === undefined || only === "machine") {
			const spec = machineSpecOf(loaded);
			if (spec !== undefined) {
				wanted.set(repoKey(spec.id, spec.ref), { id: spec.id, ref: spec.ref });
			}
		}
		if (only === undefined || only === "github") {
			const spec = githubSpecOf(loaded);
			if (spec !== undefined) {
				wanted.set(repoKey(spec.id, spec.ref), { id: spec.id, ref: spec.ref });
			}
		}
	}
	const entries = await Promise.all(
		[...wanted].map(async ([key, spec]): Promise<[string, RegistryDocument]> => [
			key,
			await fetchRegistry(spec.id, spec.ref),
		]),
	);
	return new Map(entries);
}

async function runAllChecks(args: {
	configs: LoadedConform[];
	cwd: string;
	home: string;
	only: CheckScope | undefined;
	registries: Map<string, RegistryDocument>;
}): Promise<{
	githubElapsedMs: number | undefined;
	machineElapsedMs: number | undefined;
	projectElapsedMs: number | undefined;
	results: CheckResult[];
}> {
	const projectTasks: Promise<CheckResult[]>[] = [];
	const machineTasks: Promise<CheckResult[]>[] = [];
	const githubTasks: Promise<CheckResult[]>[] = [];
	for (const loaded of args.configs) {
		if (args.only === undefined || args.only === "project") {
			const spec = projectSpecOf(loaded);
			if (spec !== undefined) {
				const registry = args.registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument;
				projectTasks.push(
					runProjectChecks(
						spec,
						{ baseDir: args.cwd, home: args.home, scope: "project" },
						registry,
					),
				);
			}
		}
		if (args.only === undefined || args.only === "machine") {
			const spec = machineSpecOf(loaded);
			if (spec !== undefined) {
				const registry = args.registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument;
				machineTasks.push(runMachineChecks(spec, registry));
			}
		}
		if (args.only === undefined || args.only === "github") {
			const spec = githubSpecOf(loaded);
			if (spec !== undefined) {
				const registry = args.registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument;
				githubTasks.push(runGithubChecks(spec, registry));
			}
		}
	}
	const [project, machine, github] = await Promise.all([
		timed(Promise.all(projectTasks)),
		timed(Promise.all(machineTasks)),
		timed(Promise.all(githubTasks)),
	]);
	return {
		githubElapsedMs: githubTasks.length > 0 ? github.elapsedMs : undefined,
		machineElapsedMs: machineTasks.length > 0 ? machine.elapsedMs : undefined,
		projectElapsedMs: projectTasks.length > 0 ? project.elapsedMs : undefined,
		results: [...project.value.flat(), ...machine.value.flat(), ...github.value.flat()],
	};
}

async function prepareRun(cmd: Command, cmdOptions: ScopeOptions) {
	const only = scopeOf(cmdOptions);
	const configs = await loadConfigsFromCommand(cmd);
	const cwd = process.cwd();
	const home = defaultHome();
	const registries = await fetchRegistries(configs, only);
	const run = await runAllChecks({ configs, cwd, home, only, registries });
	return { configs, cwd, home, only, registries, ...run };
}

async function runCheckCommand(cmd: Command, cmdOptions: CheckCmdOptions): Promise<number> {
	const { configs, githubElapsedMs, machineElapsedMs, projectElapsedMs, results } =
		await prepareRun(cmd, cmdOptions);
	if (cmdOptions.json) {
		printJsonSummary(
			configs.map((entry) => entry.path),
			results,
		);
	} else {
		printResults(results, {
			github: githubElapsedMs,
			machine: machineElapsedMs,
			project: projectElapsedMs,
		});
	}
	return results.some((item) => !item.ok) ? 1 : 0;
}

async function runFixCommand(cmd: Command, cmdOptions: FixCmdOptions): Promise<number> {
	const start = performance.now();
	const { configs, cwd, home, only, registries, results } = await prepareRun(cmd, cmdOptions);
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
									{ baseDir: cwd, home, scope: "project" },
									registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument,
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
									registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument,
									scopedIds,
								),
							);
						}
					}
				}
				if (only === undefined || only === "github") {
					const spec = githubSpecOf(loaded);
					if (spec !== undefined) {
						const scopedIds = new Set(
							[...selectedIds].filter((id) => id.startsWith(`github:${spec.blueprint}:`)),
						);
						if (scopedIds.size > 0) {
							reruns.push(
								await recheckGithubSelected(
									spec,
									registries.get(repoKey(spec.id, spec.ref)) as RegistryDocument,
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
		const rerun = await runAllChecks({ configs, cwd, home, only, registries });
		rerunResults = rerun.results;
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
	.description(
		"Check the current project/machine/repo against the config in the current directory.",
	)
	.name("adistack-conform")
	.option("--config <path>", "Path to conform.json (default: ./conform.json in the cwd)")
	.version(VERSION);

program
	.command("check")
	.description(
		"Check the config in the current directory against the current project/machine/repo.",
	)
	.option("--json", "Print machine-readable JSON.")
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
	.option("--all", "Apply all auto-fixable items without prompting.")
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

program.parseAsync(process.argv);

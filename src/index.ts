#!/usr/bin/env bun
import { Command } from "commander";

import type { CheckResult, CheckScope } from "#/checks.js";
import { partitionResults } from "#/checks.js";
import type { LoadedDesiredState } from "#/config.js";
import {
	discoverDesiredStates,
	loadDesiredState,
	githubSpecOf,
	machineSpecOf,
	projectSpecOf,
} from "#/config.js";
import { applySelected, isInteractive, resolveSelection } from "#/fix.js";
import { recheckGithubSelected, runGithubChecks } from "#/stack/github.js";
import { recheckProjectSelected, runProjectChecks } from "#/stack/index.js";
import { recheckMachineSelected, runMachineChecks } from "#/stack/machine.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchRegistry, repoKey } from "#/stack/remote.js";
import { collectValidateTargets, validateTargets } from "#/stack/validate.js";
import { defaultHome, errorMessage } from "#/utils/fs.js";
import {
	formatDuration,
	okMark,
	outroAllPassed,
	printDryRun,
	printJsonSummary,
	printResults,
	renderFixDiffs,
	reportManual,
} from "#/utils/output.js";

const VERSION = "0.1.0";

type ScopeOptions = { githubOnly?: boolean; machineOnly?: boolean; projectOnly?: boolean };
type CheckCmdOptions = ScopeOptions & { json?: boolean; verbose?: boolean };
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

async function loadDesiredStatesFromCommand(cmd: Command): Promise<LoadedDesiredState[]> {
	const desiredState = cmd.optsWithGlobals<{ desiredState?: string }>().desiredState;
	if (desiredState !== undefined) {
		return [await loadDesiredState(desiredState)];
	}
	return discoverDesiredStates();
}

function failWith(error: unknown): never {
	console.error(errorMessage(error));
	process.exit(2);
}

function requireRegistry(
	registries: Map<string, RegistryDocument>,
	id: string,
	ref: string,
): RegistryDocument {
	const registry = registries.get(repoKey(id, ref));
	if (registry === undefined) {
		throw new Error(`Cannot find registry for ${repoKey(id, ref)}: refetch failed, re-run check.`);
	}
	return registry;
}

function toSafeResults(task: Promise<CheckResult[]>, scope: CheckScope): Promise<CheckResult[]> {
	return task.catch((error) => [
		{
			actual: errorMessage(error),
			expected: `${scope} checks complete`,
			hint: `Re-run with only this scope to see the full error: ${errorMessage(error)}`,
			id: `${scope}:internal-error`,
			kind: "internal",
			ok: false,
			scope,
			target: scope,
		} satisfies CheckResult,
	]);
}

async function timed<T>(task: Promise<T>): Promise<{ elapsedMs: number; value: T }> {
	const start = performance.now();
	const value = await task;
	return { elapsedMs: performance.now() - start, value };
}

// One registry fetch per unique repo@ref, shared by every spec in the run,
// scoped to a single command: no hidden state, no stale entries.
async function fetchRegistries(
	desiredStates: readonly LoadedDesiredState[],
	only: CheckScope | undefined,
): Promise<Map<string, RegistryDocument>> {
	const wanted = new Map<string, { id: string; ref: string }>();
	for (const loaded of desiredStates) {
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
	desiredStates: LoadedDesiredState[];
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
	for (const loaded of args.desiredStates) {
		if (args.only === undefined || args.only === "project") {
			const spec = projectSpecOf(loaded);
			if (spec !== undefined) {
				const registry = requireRegistry(args.registries, spec.id, spec.ref);
				projectTasks.push(
					toSafeResults(
						runProjectChecks(
							spec,
							{ baseDir: args.cwd, home: args.home, scope: "project" },
							registry,
						),
						"project",
					),
				);
			}
		}
		if (args.only === undefined || args.only === "machine") {
			const spec = machineSpecOf(loaded);
			if (spec !== undefined) {
				const registry = requireRegistry(args.registries, spec.id, spec.ref);
				machineTasks.push(toSafeResults(runMachineChecks(spec, registry), "machine"));
			}
		}
		if (args.only === undefined || args.only === "github") {
			const spec = githubSpecOf(loaded);
			if (spec !== undefined) {
				const registry = requireRegistry(args.registries, spec.id, spec.ref);
				githubTasks.push(toSafeResults(runGithubChecks(spec, registry), "github"));
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
	const desiredStates = await loadDesiredStatesFromCommand(cmd);
	const cwd = process.cwd();
	const home = defaultHome();
	const registries = await fetchRegistries(desiredStates, only);
	const run = await runAllChecks({ cwd, desiredStates, home, only, registries });
	return { cwd, desiredStates, home, only, registries, ...run };
}

async function runCheckCommand(cmd: Command, cmdOptions: CheckCmdOptions): Promise<number> {
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

async function runFixCommand(cmd: Command, cmdOptions: FixCmdOptions): Promise<number> {
	const start = performance.now();
	const { cwd, desiredStates, home, only, registries, results } = await prepareRun(cmd, cmdOptions);
	const { failed, fixable, manual } = partitionResults(results);

	if (failed.length === 0) {
		console.log(`All conform checks passed in ${formatDuration(performance.now() - start)}.`);
		return 0;
	}

	reportManual(manual);

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

	if (cmdOptions.all === true && !isInteractive()) {
		const risky = fixable.filter(
			(item) => item.fix?.kind === "run-command" || item.fix?.kind === "github-api",
		);
		if (risky.length > 0) {
			console.error(
				`Refusing --all in non-TTY: ${risky.length} fix(es) run commands or edit GitHub (${risky.map((item) => item.id).join(", ")}). Re-run in a terminal or select file-only fixes.`,
			);
			return 2;
		}
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
			desiredStates.map(async (loaded) => {
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
									requireRegistry(registries, spec.id, spec.ref),
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
									requireRegistry(registries, spec.id, spec.ref),
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
									requireRegistry(registries, spec.id, spec.ref),
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
		const rerun = await runAllChecks({ cwd, desiredStates, home, only, registries });
		rerunResults = rerun.results;
	}
	const remaining = rerunResults.filter((item) => !item.ok);
	const elapsedMs = performance.now() - start;
	console.log(
		`\nFixed ${applied}/${selection.selected.length}. ${remaining.length} check(s) still failing in ${formatDuration(elapsedMs)}.`,
	);
	if (remaining.length > 0) {
		printResults(rerunResults, undefined, { verbose: false });
		return 1;
	}
	await outroAllPassed(elapsedMs);
	return 0;
}

async function runValidateCommand(cmd: Command): Promise<number> {
	const desiredStates = await loadDesiredStatesFromCommand(cmd);
	const results = await validateTargets(collectValidateTargets(desiredStates));
	for (const result of results) {
		if (result.ok) {
			console.log(`${okMark(true)} ${result.file}`);
		} else {
			console.log(`${okMark(false)} ${result.file}\n    ${result.error ?? "invalid"}`);
		}
	}
	const invalid = results.filter((item) => !item.ok).length;
	if (invalid === 0) {
		console.log(`\nAll ${results.length} tech-stack file(s) valid.`);
		return 0;
	}
	console.log(`\nValidate: ${results.length - invalid} valid, ${invalid} invalid.`);
	return 1;
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
	.option("--verbose", "Show passing checks too.")
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

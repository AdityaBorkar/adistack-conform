import type { Command } from "commander";

import { runGithubChecks } from "#/stack/github.js";
import { runMachineChecks } from "#/stack/machine.js";
import { runProjectChecks } from "#/stack/project.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchRegistry, repoKey } from "#/stack/remote.js";
import type { LoadedDesiredState } from "#/utils/config.js";
import {
	discoverDesiredStates,
	loadDesiredState,
	githubStateOf,
	machineStateOf,
	projectStateOf,
} from "#/utils/config.js";
import { defaultHome, errorMessage } from "#/utils/fs.js";
import type { CheckResult, CheckScope } from "#/utils/result.js";

export type ScopeOptions = { githubOnly?: boolean; machineOnly?: boolean; projectOnly?: boolean };

export function scopeOf(options: ScopeOptions): CheckScope | undefined {
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

export async function loadDesiredStatesFromCommand(cmd: Command): Promise<LoadedDesiredState[]> {
	const desiredState = cmd.optsWithGlobals<{ desiredState?: string }>().desiredState;
	if (desiredState !== undefined) {
		return [await loadDesiredState(desiredState)];
	}
	return discoverDesiredStates();
}

export function requireRegistry(
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

// One registry fetch per unique repo@ref, shared by every desired state in the run,
// scoped to a single command: no hidden state, no stale entries.
export async function fetchRegistries(
	desiredStates: readonly LoadedDesiredState[],
	only: CheckScope | undefined,
): Promise<Map<string, RegistryDocument>> {
	const wanted = new Map<string, { id: string; ref: string }>();
	for (const loaded of desiredStates) {
		if (only === undefined || only === "project") {
			const state = projectStateOf(loaded);
			if (state !== undefined) {
				wanted.set(repoKey(state.id, state.ref), { id: state.id, ref: state.ref });
			}
		}
		if (only === undefined || only === "machine") {
			const state = machineStateOf(loaded);
			if (state !== undefined) {
				wanted.set(repoKey(state.id, state.ref), { id: state.id, ref: state.ref });
			}
		}
		if (only === undefined || only === "github") {
			const state = githubStateOf(loaded);
			if (state !== undefined) {
				wanted.set(repoKey(state.id, state.ref), { id: state.id, ref: state.ref });
			}
		}
	}
	const entries = await Promise.all(
		[...wanted].map(async ([key, state]): Promise<[string, RegistryDocument]> => [
			key,
			await fetchRegistry(state.id, state.ref),
		]),
	);
	return new Map(entries);
}

export async function runAllChecks(args: {
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
			const state = projectStateOf(loaded);
			if (state !== undefined) {
				const registry = requireRegistry(args.registries, state.id, state.ref);
				projectTasks.push(
					toSafeResults(
						runProjectChecks(
							state,
							{ baseDir: args.cwd, home: args.home, scope: "project" },
							registry,
						),
						"project",
					),
				);
			}
		}
		if (args.only === undefined || args.only === "machine") {
			const state = machineStateOf(loaded);
			if (state !== undefined) {
				const registry = requireRegistry(args.registries, state.id, state.ref);
				machineTasks.push(toSafeResults(runMachineChecks(state, registry), "machine"));
			}
		}
		if (args.only === undefined || args.only === "github") {
			const state = githubStateOf(loaded);
			if (state !== undefined) {
				const registry = requireRegistry(args.registries, state.id, state.ref);
				githubTasks.push(toSafeResults(runGithubChecks(state, registry), "github"));
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

export async function prepareRun(cmd: Command, cmdOptions: ScopeOptions) {
	const only = scopeOf(cmdOptions);
	const desiredStates = await loadDesiredStatesFromCommand(cmd);
	const cwd = process.cwd();
	const home = defaultHome();
	const registries = await fetchRegistries(desiredStates, only);
	const run = await runAllChecks({ cwd, desiredStates, home, only, registries });
	return { cwd, desiredStates, home, only, registries, ...run };
}

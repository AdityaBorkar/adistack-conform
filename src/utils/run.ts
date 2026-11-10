import type { Command } from "commander";

import { recheckGithubSelected, runGithubChecks } from "#/stack/github.js";
import { recheckMachineSelected, runMachineChecks } from "#/stack/machine.js";
import { recheckProjectSelected, runProjectChecks } from "#/stack/project.js";
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

export function activeScopes(only: CheckScope | undefined): CheckScope[] {
	return only === undefined ? ["project", "machine", "github"] : [only];
}

function sourceOf(
	loaded: LoadedDesiredState,
	scope: CheckScope,
): { id: string; ref: string } | undefined {
	if (scope === "project") {
		return projectStateOf(loaded);
	}
	if (scope === "machine") {
		return machineStateOf(loaded);
	}
	return githubStateOf(loaded);
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
		for (const scope of activeScopes(only)) {
			const state = sourceOf(loaded, scope);
			if (state !== undefined) {
				wanted.set(repoKey(state.id, state.ref), { id: state.id, ref: state.ref });
			}
		}
	}
	const entries = await Promise.allSettled(
		[...wanted].map(async ([key, state]): Promise<[string, RegistryDocument]> => [
			key,
			await fetchRegistry(state.id, state.ref),
		]),
	);
	const registries = new Map<string, RegistryDocument>();
	const failures: string[] = [];
	for (const entry of entries) {
		if (entry.status === "fulfilled") {
			registries.set(entry.value[0], entry.value[1]);
		} else {
			failures.push(errorMessage(entry.reason));
		}
	}
	// Independent desired states still run: scopes whose registry failed throw
	// via requireRegistry and surface as scope errors, not silent passes.
	if (registries.size === 0 && failures.length > 0) {
		throw new Error(failures.join("\n"));
	}
	return registries;
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
	const machineRuns: Array<() => Promise<CheckResult[]>> = [];
	const githubTasks: Promise<CheckResult[]>[] = [];
	for (const loaded of args.desiredStates) {
		for (const scope of activeScopes(args.only)) {
			if (scope === "project") {
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
			} else if (scope === "machine") {
				const state = machineStateOf(loaded);
				if (state !== undefined) {
					const registry = requireRegistry(args.registries, state.id, state.ref);
					// Defer the call: building the promise here would start the
					// nix switch immediately and defeat the sequential run below.
					machineRuns.push(() => toSafeResults(runMachineChecks(state, registry), "machine"));
				}
			} else {
				const state = githubStateOf(loaded);
				if (state !== undefined) {
					const registry = requireRegistry(args.registries, state.id, state.ref);
					githubTasks.push(toSafeResults(runGithubChecks(state, registry), "github"));
				}
			}
		}
	}
	const [project, machine, github] = await Promise.all([
		timed(Promise.all(projectTasks)),
		// Machine checks share the nix store lock; run them one at a time.
		timed(
			(async () => {
				const out: CheckResult[][] = [];
				for (const run of machineRuns) {
					out.push(await run());
				}
				return out;
			})(),
		),
		timed(Promise.all(githubTasks)),
	]);
	return {
		githubElapsedMs: githubTasks.length > 0 ? github.elapsedMs : undefined,
		machineElapsedMs: machineRuns.length > 0 ? machine.elapsedMs : undefined,
		projectElapsedMs: projectTasks.length > 0 ? project.elapsedMs : undefined,
		results: [...project.value.flat(), ...machine.value.flat(), ...github.value.flat()],
	};
}

export async function recheckSelected(args: {
	cwd: string;
	desiredStates: LoadedDesiredState[];
	home: string;
	only: CheckScope | undefined;
	registries: Map<string, RegistryDocument>;
	selectedIds: ReadonlySet<string>;
}): Promise<CheckResult[]> {
	const refreshed = await Promise.all(
		args.desiredStates.map(async (loaded) => {
			const reruns: CheckResult[][] = [];
			for (const scope of activeScopes(args.only)) {
				if (scope === "project") {
					const state = projectStateOf(loaded);
					if (state === undefined) {
						continue;
					}
					const scopedIds = new Set(
						[...args.selectedIds].filter((id) => id.startsWith(`project:${state.blueprint}:`)),
					);
					if (scopedIds.size > 0) {
						reruns.push(
							await recheckProjectSelected(
								state,
								{ baseDir: args.cwd, home: args.home, scope: "project" },
								requireRegistry(args.registries, state.id, state.ref),
								scopedIds,
							),
						);
					}
				} else if (scope === "machine") {
					const state = machineStateOf(loaded);
					if (state === undefined) {
						continue;
					}
					const scopedIds = new Set(
						[...args.selectedIds].filter((id) => id === `nix:${state.blueprint}`),
					);
					if (scopedIds.size > 0) {
						reruns.push(
							await recheckMachineSelected(
								state,
								requireRegistry(args.registries, state.id, state.ref),
								scopedIds,
							),
						);
					}
				} else {
					const state = githubStateOf(loaded);
					if (state === undefined) {
						continue;
					}
					const scopedIds = new Set(
						[...args.selectedIds].filter((id) => id.startsWith(`github:${state.blueprint}:`)),
					);
					if (scopedIds.size > 0) {
						reruns.push(
							await recheckGithubSelected(
								state,
								requireRegistry(args.registries, state.id, state.ref),
								scopedIds,
							),
						);
					}
				}
			}
			return reruns.flat();
		}),
	);
	return refreshed.flat();
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

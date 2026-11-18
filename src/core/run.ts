import type {
	DesiredStateOption,
	LoadedDesiredState,
	MachineRunState,
	ScopeOptions,
} from "#/core/config.js";
import {
	activeScopes,
	githubStateOf,
	loadDesiredStates,
	machineStateOf,
	projectStateOf,
	scopeOf,
} from "#/core/config.js";
import { recheckGithubSelected, runGithubChecks } from "#/core/github/index.js";
import { recheckMachineSelected, runMachine } from "#/core/machine/index.js";
import { recheckProjectSelected, runProjectChecks } from "#/core/project/index.js";
import type { CheckResult, CheckScope } from "#/core/result.js";
import type { Registries } from "#/core/upstream/registries.js";
import { fetchRegistries, requireRegistry } from "#/core/upstream/registries.js";
import { errorMessage } from "#/utils/error.js";
import { defaultHome } from "#/utils/fs.js";

// Everything one check run needs, resolved once per command.
export interface RunContext {
	cwd: string;
	desiredStates: LoadedDesiredState[];
	home: string;
	only: CheckScope | undefined;
	registries: Registries;
	strict: boolean;
}

export function toSafeResults(
	task: Promise<CheckResult[]>,
	scope: CheckScope,
): Promise<CheckResult[]> {
	return task.catch((error) => [
		{
			actual: errorMessage(error),
			expected: `${scope} checks complete`,
			hint: `Re-check with only this scope to see the full error: ${errorMessage(error)}`,
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

// Machine runs read live system state; run them one at a time.
export async function runMachineStates(
	states: readonly MachineRunState[],
	registries: Registries,
	strict: boolean,
): Promise<CheckResult[]> {
	const out: CheckResult[][] = [];
	for (const state of states) {
		out.push(
			await toSafeResults(
				runMachine(state, requireRegistry(registries, state.id, state.ref), strict),
				"machine",
			),
		);
	}
	return out.flat();
}

export async function runAllChecks(args: RunContext): Promise<{
	githubElapsedMs: number | undefined;
	machineElapsedMs: number | undefined;
	projectElapsedMs: number | undefined;
	results: CheckResult[];
}> {
	const projectTasks: Promise<CheckResult[]>[] = [];
	const machineStates: MachineRunState[] = [];
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
					machineStates.push(state);
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
		// Machine runs share live system state, so they run sequentially
		// while the other scopes run concurrently.
		timed(runMachineStates(machineStates, args.registries, args.strict)),
		timed(Promise.all(githubTasks)),
	]);
	return {
		githubElapsedMs: githubTasks.length > 0 ? github.elapsedMs : undefined,
		machineElapsedMs: machineStates.length > 0 ? machine.elapsedMs : undefined,
		projectElapsedMs: projectTasks.length > 0 ? project.elapsedMs : undefined,
		results: [...project.value.flat(), ...machine.value, ...github.value.flat()],
	};
}

export async function recheckSelected(
	args: RunContext & { selectedIds: ReadonlySet<string> },
): Promise<CheckResult[]> {
	const rechecked = await Promise.all(
		args.desiredStates.map(async (loaded) => {
			const rechecks: CheckResult[][] = [];
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
						rechecks.push(
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
						[...args.selectedIds].filter((id) => id.startsWith(`machine:${state.blueprint}:`)),
					);
					if (scopedIds.size > 0) {
						rechecks.push(
							await recheckMachineSelected(
								state,
								requireRegistry(args.registries, state.id, state.ref),
								scopedIds,
								args.strict,
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
						rechecks.push(
							await recheckGithubSelected(
								state,
								requireRegistry(args.registries, state.id, state.ref),
								scopedIds,
							),
						);
					}
				}
			}
			return rechecks.flat();
		}),
	);
	return rechecked.flat();
}

// A selected ID missing from the re-check no longer exists (e.g. a removed
// extra), so it is resolved; re-check results new to the run (e.g. a scope
// error) are appended.
export function mergeRecheck(
	previous: readonly CheckResult[],
	rechecked: readonly CheckResult[],
	selectedIds: ReadonlySet<string>,
): CheckResult[] {
	const byId = new Map(rechecked.map((item) => [item.id, item]));
	const previousIds = new Set(previous.map((item) => item.id));
	return [
		...previous
			.filter((item) => byId.has(item.id) || !selectedIds.has(item.id))
			.map((item) => byId.get(item.id) ?? item),
		...rechecked.filter((item) => !previousIds.has(item.id)),
	];
}

// Re-check only the selected IDs; fall back to a full check if the narrow pass fails.
export async function recheckAfterFix(
	ctx: RunContext,
	previous: CheckResult[],
	selected: readonly CheckResult[],
): Promise<CheckResult[]> {
	try {
		const selectedIds = new Set(selected.map((item) => item.id));
		const rechecked = await recheckSelected({ ...ctx, selectedIds });
		return mergeRecheck(previous, rechecked, selectedIds);
	} catch (error) {
		console.error(`Selective re-check failed, running a full re-check: ${errorMessage(error)}`);
		return (await runAllChecks(ctx)).results;
	}
}

export async function prepareRun(
	options: DesiredStateOption & ScopeOptions & { strict?: boolean },
) {
	const only = scopeOf(options);
	const desiredStates = await loadDesiredStates(options.desiredState);
	const cwd = process.cwd();
	const home = defaultHome();
	const registries = await fetchRegistries(desiredStates, only);
	const strict = options.strict === true;
	const run = await runAllChecks({ cwd, desiredStates, home, only, registries, strict });
	return { cwd, desiredStates, home, only, registries, strict, ...run };
}

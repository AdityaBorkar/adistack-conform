import type { DesiredStateOption, LoadedDesiredState, ScopeOptions } from "#/core/config.js";
import {
	activeScopes,
	githubStateOf,
	loadDesiredState,
	machineStateOf,
	projectStateOf,
	scopeOf,
} from "#/core/config.js";
import { runGithubChecks } from "#/core/github/index.js";
import { recheckMachineSelected, runMachine } from "#/core/machine/index.js";
import { runProjectChecks } from "#/core/project/index.js";
import type { CheckResult, CheckScope } from "#/core/result.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { fetchRegistry } from "#/core/upstream/remote.js";
import { errorMessage } from "#/utils/error.js";
import { defaultHome } from "#/utils/fs.js";

// Everything one check run needs, resolved once per command.
export interface RunContext {
	desiredState: LoadedDesiredState;
	home: string;
	registry: RegistryDocument;
	// Configured scopes, narrowed by a --*-only flag.
	scopes: CheckScope[];
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

// One scope's checks; `selectedIds` narrows a re-check to those IDs.
function scopeTask(
	ctx: RunContext,
	scope: CheckScope,
	selectedIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const { desiredState, registry } = ctx;
	const project = projectStateOf(desiredState);
	if (scope === "project" && project !== undefined) {
		// Project targets resolve against the dir that owns conform.json, not the cwd.
		const options = { baseDir: desiredState.dir, home: ctx.home };
		return runProjectChecks(project, options, registry, selectedIds);
	}
	const machine = machineStateOf(desiredState);
	if (scope === "machine" && machine !== undefined) {
		return selectedIds === undefined
			? runMachine(machine, registry, ctx.strict)
			: recheckMachineSelected(machine, registry, selectedIds, ctx.strict);
	}
	const github = githubStateOf(desiredState);
	if (scope === "github" && github !== undefined) {
		// GitHub checks are one batch of API reads: re-check all of them.
		return runGithubChecks(github, registry);
	}
	return Promise.resolve([]);
}

// Scopes run concurrently; each is timed on its own.
export async function runAllChecks(ctx: RunContext): Promise<{
	elapsedMs: Partial<Record<CheckScope, number>>;
	results: CheckResult[];
}> {
	const runs = await Promise.all(
		ctx.scopes.map(async (scope) => {
			const start = performance.now();
			const results = await toSafeResults(scopeTask(ctx, scope), scope);
			return { elapsedMs: performance.now() - start, results, scope };
		}),
	);
	return {
		elapsedMs: Object.fromEntries(runs.map((run) => [run.scope, run.elapsedMs])),
		results: runs.flatMap((run) => run.results),
	};
}

async function recheckSelected(
	ctx: RunContext,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const rechecked = await Promise.all(
		ctx.scopes.map((scope) => {
			const ids = new Set([...selectedIds].filter((id) => id.startsWith(`${scope}:`)));
			return ids.size === 0 ? Promise.resolve([]) : scopeTask(ctx, scope, ids);
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
		return mergeRecheck(previous, await recheckSelected(ctx, selectedIds), selectedIds);
	} catch (error) {
		console.error(`Selective re-check failed, running a full re-check: ${errorMessage(error)}`);
		return (await runAllChecks(ctx)).results;
	}
}

export async function prepareRun(
	options: DesiredStateOption & ScopeOptions & { strict?: boolean },
): Promise<RunContext & Awaited<ReturnType<typeof runAllChecks>>> {
	const only = scopeOf(options);
	const desiredState = await loadDesiredState(options.desiredState);
	const scopes = activeScopes(desiredState, only);
	const { id, ref } = desiredState.source;
	const ctx: RunContext = {
		desiredState,
		home: defaultHome(),
		registry: await fetchRegistry(id, ref),
		scopes,
		strict: options.strict === true,
	};
	return { ...ctx, ...(await runAllChecks(ctx)) };
}

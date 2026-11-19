import type {
	ConfigPathOption,
	LoadedDesiredState,
	ScopeCheck,
	ScopeOptions,
} from "#/core/config.js";
import { activeScopes, loadDesiredState, scopeOf, stateOf } from "#/core/config.js";
import { runGithubChecks } from "#/core/github/index.js";
import { runMachine } from "#/core/machine/index.js";
import { runProjectChecks } from "#/core/project/index.js";
import type { CheckResult, CheckScope } from "#/core/result.js";
import { assertUniqueIds, isDrift } from "#/core/result.js";
import { pinnedReader } from "#/core/upstream/remote.js";
import type { TechStack } from "#/core/upstream/tech-stack.js";
import { openTechStack } from "#/core/upstream/tech-stack.js";
import { errorMessage } from "#/utils/error.js";
import { defaultHome } from "#/utils/fs.js";

// Everything one check run needs, resolved once per command.
interface RunContext {
	desiredState: LoadedDesiredState;
	home: string;
	// Configured scopes, narrowed by a --*-only flag.
	scopes: CheckScope[];
	skipSecrets: boolean;
	strict: boolean;
	techStack: TechStack;
}

function toSafeResults(task: Promise<CheckResult[]>, scope: CheckScope): Promise<CheckResult[]> {
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

const SCOPES: Record<CheckScope, ScopeCheck> = {
	github: runGithubChecks,
	machine: runMachine,
	project: runProjectChecks,
};

function scopeTask(
	ctx: RunContext,
	scope: CheckScope,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const state = stateOf(ctx.desiredState, scope);
	if (state === undefined) {
		return Promise.resolve([]);
	}
	const { home, skipSecrets, strict, techStack } = ctx;
	// Re-check merging and narrowing key on ids, so a scope must never repeat one.
	return SCOPES[scope](
		{ baseDir: ctx.desiredState.dir, home, skipSecrets, state, strict, techStack },
		onlyIds,
	).then(assertUniqueIds);
}

// Scopes run concurrently; each is timed on its own.
async function runAllChecks(ctx: RunContext): Promise<{
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
	selected: readonly CheckResult[],
): Promise<CheckResult[]> {
	const rechecked = await Promise.all(
		ctx.scopes.map((scope) => {
			const ids = new Set(selected.filter((item) => item.scope === scope).map((item) => item.id));
			return ids.size === 0 ? Promise.resolve([]) : scopeTask(ctx, scope, ids);
		}),
	);
	return rechecked.flat();
}

// Re-checked IDs replace their previous results, except a skip never replaces
// drift: the scope could not look (e.g. a GitHub 403), so the failure stands.
// Results new to the run (e.g. a GitHub auth skip or a machine domain error)
// are appended. A selected ID missing from the re-check counts as resolved
// (e.g. a removed extra) only when its scope's re-check hit no new failure:
// otherwise the scope could not look at it, and the previous failure stands.
export function mergeRecheck(
	previous: readonly CheckResult[],
	rechecked: readonly CheckResult[],
	selectedIds: ReadonlySet<string>,
): CheckResult[] {
	const byId = new Map(rechecked.map((item) => [item.id, item]));
	const previousIds = new Set(previous.map((item) => item.id));
	const added = rechecked.filter((item) => !previousIds.has(item.id));
	const unsureScopes = new Set(added.filter((item) => !item.ok).map((item) => item.scope));
	return [
		...previous
			.filter(
				(item) => byId.has(item.id) || !selectedIds.has(item.id) || unsureScopes.has(item.scope),
			)
			.map((item) => {
				const next = byId.get(item.id);
				return next === undefined || (next.skipped === true && isDrift(item)) ? item : next;
			}),
		...added,
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
		return mergeRecheck(previous, await recheckSelected(ctx, selected), selectedIds);
	} catch (error) {
		console.error(`Selective re-check failed, running a full re-check: ${errorMessage(error)}`);
		return (await runAllChecks(ctx)).results;
	}
}

export async function prepareRun(
	options: ConfigPathOption & ScopeOptions & { skipSecrets?: boolean; strict?: boolean },
): Promise<RunContext & Awaited<ReturnType<typeof runAllChecks>>> {
	const only = scopeOf(options);
	const desiredState = await loadDesiredState(options.path);
	const scopes = activeScopes(desiredState, only);
	const { id, ref } = desiredState.source;
	const ctx: RunContext = {
		desiredState,
		home: defaultHome(),
		scopes,
		skipSecrets: options.skipSecrets === true,
		strict: options.strict === true,
		techStack: await openTechStack(pinnedReader(id, ref)),
	};
	return { ...ctx, ...(await runAllChecks(ctx)) };
}

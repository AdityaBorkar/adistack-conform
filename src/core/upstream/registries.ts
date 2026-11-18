import type { LoadedDesiredState } from "#/core/config.js";
import { activeScopes, githubStateOf, machineStateOf, projectStateOf } from "#/core/config.js";
import type { CheckScope } from "#/core/result.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { fetchRegistry, repoKey } from "#/core/upstream/remote.js";
import { errorMessage } from "#/utils/error.js";

export type Registries = Map<string, RegistryDocument>;

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

export function requireRegistry(registries: Registries, id: string, ref: string): RegistryDocument {
	const registry = registries.get(repoKey(id, ref));
	if (registry === undefined) {
		throw new Error(`Cannot find registry for ${repoKey(id, ref)}: refetch failed, re-check.`);
	}
	return registry;
}

// One registry fetch per unique repo@ref, shared by every desired state in the run,
// scoped to a single command: no hidden state, no stale entries.
export async function fetchRegistries(
	desiredStates: readonly LoadedDesiredState[],
	only: CheckScope | undefined,
): Promise<Registries> {
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
	const registries: Registries = new Map();
	const errors: string[] = [];
	for (const entry of entries) {
		if (entry.status === "fulfilled") {
			registries.set(entry.value[0], entry.value[1]);
		} else {
			errors.push(errorMessage(entry.reason));
		}
	}
	// Independent desired states still run: scopes with a missing registry throw
	// via requireRegistry and surface as scope errors, not silent passes.
	if (registries.size === 0 && errors.length > 0) {
		throw new Error(errors.join("\n"));
	}
	return registries;
}

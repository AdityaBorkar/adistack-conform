import type { LoadedDesiredState, RunState } from "#/core/config.js";
import { stateOf } from "#/core/config.js";
import { machineSecretsRel } from "#/core/machine/live.js";
import type { CheckScope } from "#/core/result.js";
import type { BlueprintKind, RegistryDocument } from "#/core/upstream/registry.js";
import type { BlueprintData } from "#/core/upstream/remote.js";
import {
	UPSTREAM_FETCH_CONCURRENCY,
	fetchBlueprint,
	fetchRegistry,
	fetchTextOrThrow,
	rawUrl,
} from "#/core/upstream/remote.js";
import { isSecretsTemplate } from "#/schemas/machine-manifest.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

interface ValidateResult {
	error?: string;
	file: string;
	ok: boolean;
}

export type FetchDeps = {
	fetchBlueprint: typeof fetchBlueprint;
	fetchRegistry: typeof fetchRegistry;
	fetchText: typeof fetchTextOrThrow;
};

const defaultDeps: FetchDeps = { fetchBlueprint, fetchRegistry, fetchText: fetchTextOrThrow };

const KIND_OF: Record<CheckScope, BlueprintKind> = {
	github: "github_configs",
	machine: "machines",
	project: "projects",
};

// Machine blueprints are only usable when every file source (and, for
// secrets templates, the secrets.yaml next to the manifest) is fetchable.
async function machineSourcesError(
	state: RunState,
	manifest: BlueprintData<"machines">,
	rel: string,
	deps: FetchDeps,
): Promise<string | undefined> {
	const sources = manifest.files.map((entry) => entry.source);
	const errors = await mapWithConcurrency(sources, UPSTREAM_FETCH_CONCURRENCY, async (source) => {
		try {
			await deps.fetchText(rawUrl(state.id, state.ref, source), `machine file ${source}`);
			return null;
		} catch (error) {
			return `${source}: ${errorMessage(error)}`;
		}
	});
	const missing = errors.filter((item) => item !== null);
	if (missing.length > 0) {
		return `Unfetchable machine sources: ${missing.join("; ")}`;
	}
	if (manifest.files.some(isSecretsTemplate)) {
		const secretsRel = machineSecretsRel(rel);
		try {
			await deps.fetchText(rawUrl(state.id, state.ref, secretsRel), `secrets file ${secretsRel}`);
		} catch (error) {
			return `Unfetchable machine secrets ${secretsRel}: ${errorMessage(error)}`;
		}
	}
	return undefined;
}

async function validateBlueprint(
	state: RunState,
	scope: CheckScope,
	registry: RegistryDocument,
	deps: FetchDeps,
): Promise<ValidateResult> {
	const at = `(${state.id}@${state.ref})`;
	let fetched: { data: unknown; rel: string };
	try {
		fetched = await deps.fetchBlueprint(state, registry, KIND_OF[scope]);
	} catch (error) {
		const file = `${scope} "${state.blueprint}" in registry.json ${at}`;
		return { error: errorMessage(error), file, ok: false };
	}
	const file = `${fetched.rel} ${at}`;
	const error =
		scope === "machine"
			? await machineSourcesError(
					state,
					fetched.data as BlueprintData<"machines">,
					fetched.rel,
					deps,
				)
			: undefined;
	return error === undefined ? { file, ok: true } : { error, file, ok: false };
}

// The registry first, then one result per configured scope's blueprint.
export async function validateDesiredState(
	loaded: LoadedDesiredState,
	deps: FetchDeps = defaultDeps,
): Promise<ValidateResult[]> {
	const { id, ref } = loaded.source;
	const registryFile = `registry.json (${id}@${ref})`;
	let registry: RegistryDocument;
	try {
		registry = await deps.fetchRegistry(id, ref);
	} catch (error) {
		return [{ error: errorMessage(error), file: registryFile, ok: false }];
	}
	const checks = await Promise.all(
		(["machine", "project", "github"] as const).map((scope) => {
			const state = stateOf(loaded, scope);
			return state === undefined ? undefined : validateBlueprint(state, scope, registry, deps);
		}),
	);
	return [{ file: registryFile, ok: true }, ...checks.filter((item) => item !== undefined)];
}

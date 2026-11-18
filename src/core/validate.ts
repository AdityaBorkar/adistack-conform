import type { LoadedDesiredState } from "#/core/config.js";
import { machineSecretsRel } from "#/core/machine/live.js";
import { blueprintRel, findMachineEntry } from "#/core/upstream/registry.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import {
	fetchGithubSettings,
	fetchMachineManifest,
	fetchProjectManifest,
	fetchRegistry,
	fetchTextOrThrow,
	rawUrl,
} from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

export interface ValidateResult {
	error?: string;
	file: string;
	ok: boolean;
}

export interface ValidateTargets {
	github?: string;
	id: string;
	machine?: string;
	project?: string;
	ref: string;
}

type FetchDeps = {
	fetchGithub: typeof fetchGithubSettings;
	fetchMachine: typeof fetchMachineManifest;
	fetchManifest: typeof fetchProjectManifest;
	fetchRegistry: typeof fetchRegistry;
	fetchText: typeof fetchTextOrThrow;
};

const defaultDeps: FetchDeps = {
	fetchGithub: fetchGithubSettings,
	fetchMachine: fetchMachineManifest,
	fetchManifest: fetchProjectManifest,
	fetchRegistry,
	fetchText: fetchTextOrThrow,
};

export function collectValidateTargets(loaded: LoadedDesiredState): ValidateTargets {
	return {
		github: loaded.github?.blueprint,
		id: loaded.source.id,
		machine: loaded.machine?.blueprint,
		project: loaded.project?.blueprint,
		ref: loaded.source.ref,
	};
}

function machineEntryError(blueprint: string, registry: RegistryDocument): string | undefined {
	const entry = findMachineEntry(blueprint, registry);
	if (entry === undefined) {
		return `Machine blueprint "${blueprint}" not found in the tech-stack repo.`;
	}
	try {
		blueprintRel(entry.path);
	} catch (error) {
		return errorMessage(error);
	}
	return undefined;
}

async function validateMachine(
	target: ValidateTargets,
	blueprint: string,
	registry: RegistryDocument,
	deps: FetchDeps,
): Promise<ValidateResult> {
	const file = `machine "${blueprint}" in registry.json (${target.id}@${target.ref})`;
	const entryError = machineEntryError(blueprint, registry);
	if (entryError !== undefined) {
		return { error: entryError, file, ok: false };
	}
	let manifest: Awaited<ReturnType<FetchDeps["fetchMachine"]>>["manifest"];
	let manifestRel: string;
	try {
		const fetched = await deps.fetchMachine(target.id, target.ref, blueprint, registry);
		manifest = fetched.manifest;
		manifestRel = fetched.manifestRel;
	} catch (error) {
		return { error: errorMessage(error), file, ok: false };
	}
	// Names and managers are enforced by the manifest schema; here only the
	// source bytes must exist (same fetch order as project scope).
	const sources = manifest.files.map((entry) => entry.source);
	const errors = await mapWithConcurrency(sources, 8, async (source) => {
		try {
			await deps.fetchText(rawUrl(target.id, target.ref, source), `machine file ${source}`);
			return null;
		} catch (error) {
			return `${source}: ${errorMessage(error)}`;
		}
	});
	const missing = errors.filter((item) => item !== null);
	if (missing.length > 0) {
		return { error: `Unfetchable machine sources: ${missing.join("; ")}`, file, ok: false };
	}
	// Templates render from the sops-encrypted secrets next to the manifest;
	// a manifest whose secrets file is unfetchable can never render.
	if (manifest.files.some((entry) => (entry.secrets?.length ?? 0) > 0)) {
		const secretsRel = machineSecretsRel(manifestRel);
		try {
			await deps.fetchText(rawUrl(target.id, target.ref, secretsRel), `secrets file ${secretsRel}`);
		} catch (error) {
			return {
				error: `Unfetchable machine secrets ${secretsRel}: ${errorMessage(error)}`,
				file,
				ok: false,
			};
		}
	}
	return { file: `${manifestRel} (${target.id}@${target.ref})`, ok: true };
}

async function validateProject(
	target: ValidateTargets,
	blueprint: string,
	registry: RegistryDocument,
	deps: FetchDeps,
): Promise<ValidateResult> {
	try {
		const manifest = await deps.fetchManifest(target.id, target.ref, blueprint, registry);
		return { file: `${manifest.blueprintRel} (${target.id}@${target.ref})`, ok: true };
	} catch (error) {
		const file = `blueprint "${blueprint}" in registry.json (${target.id}@${target.ref})`;
		return { error: errorMessage(error), file, ok: false };
	}
}

async function validateGithub(
	target: ValidateTargets,
	blueprint: string,
	registry: RegistryDocument,
	deps: FetchDeps,
): Promise<ValidateResult> {
	try {
		const settings = await deps.fetchGithub(target.id, target.ref, blueprint, registry);
		return { file: `${settings.githubRel} (${target.id}@${target.ref})`, ok: true };
	} catch (error) {
		const file = `github "${blueprint}" in registry.json (${target.id}@${target.ref})`;
		return { error: errorMessage(error), file, ok: false };
	}
}

export async function validateTargets(
	target: ValidateTargets,
	deps: FetchDeps = defaultDeps,
): Promise<ValidateResult[]> {
	const registryFile = `registry.json (${target.id}@${target.ref})`;
	let registry: RegistryDocument;
	try {
		registry = await deps.fetchRegistry(target.id, target.ref);
	} catch (error) {
		return [{ error: errorMessage(error), file: registryFile, ok: false }];
	}
	const { github, machine, project } = target;
	const checks = await Promise.all([
		machine === undefined ? undefined : validateMachine(target, machine, registry, deps),
		project === undefined ? undefined : validateProject(target, project, registry, deps),
		github === undefined ? undefined : validateGithub(target, github, registry, deps),
	]);
	return [{ file: registryFile, ok: true }, ...checks.filter((item) => item !== undefined)];
}

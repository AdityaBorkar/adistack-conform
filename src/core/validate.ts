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
	githubs: string[];
	id: string;
	machines: string[];
	projects: string[];
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

export function collectValidateTargets(
	desiredStates: readonly LoadedDesiredState[],
): Map<string, ValidateTargets> {
	const targets = new Map<string, ValidateTargets>();
	const add = (
		id: string,
		ref: string,
		kind: "github" | "machine" | "project",
		blueprint: string,
	): void => {
		const key = `${id}@${ref}`;
		let entry = targets.get(key);
		if (entry === undefined) {
			entry = { githubs: [], id, machines: [], projects: [], ref };
			targets.set(key, entry);
		}
		const list =
			kind === "machine" ? entry.machines : kind === "github" ? entry.githubs : entry.projects;
		if (!list.includes(blueprint)) {
			list.push(blueprint);
		}
	};
	for (const loaded of desiredStates) {
		const { id, ref } = loaded.source;
		if (loaded.project !== undefined) {
			add(id, ref, "project", loaded.project.blueprint);
		}
		if (loaded.github !== undefined) {
			add(id, ref, "github", loaded.github.blueprint);
		}
		if (loaded.machine !== undefined) {
			add(id, ref, "machine", loaded.machine.blueprint);
		}
	}
	return targets;
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

async function validateOne(target: ValidateTargets, deps: FetchDeps): Promise<ValidateResult[]> {
	const registryFile = `registry.json (${target.id}@${target.ref})`;
	let registry: RegistryDocument;
	try {
		registry = await deps.fetchRegistry(target.id, target.ref);
	} catch (error) {
		return [{ error: errorMessage(error), file: registryFile, ok: false }];
	}
	const results: ValidateResult[] = [{ file: registryFile, ok: true }];
	const machineResults = await mapWithConcurrency(target.machines.toSorted(), 8, (blueprint) =>
		validateMachine(target, blueprint, registry, deps),
	);
	const manifestResults = await mapWithConcurrency(
		target.projects.toSorted(),
		8,
		async (blueprint): Promise<ValidateResult> => {
			const file = `blueprint "${blueprint}" in ${registryFile}`;
			try {
				const manifest = await deps.fetchManifest(target.id, target.ref, blueprint, registry);
				const manifestFile = `${manifest.blueprintRel} (${target.id}@${target.ref})`;
				return { file: manifestFile, ok: true };
			} catch (error) {
				return { error: errorMessage(error), file, ok: false };
			}
		},
	);
	const githubResults = await mapWithConcurrency(
		target.githubs.toSorted(),
		8,
		async (blueprint): Promise<ValidateResult> => {
			const file = `github "${blueprint}" in ${registryFile}`;
			try {
				const settings = await deps.fetchGithub(target.id, target.ref, blueprint, registry);
				const settingsFile = `${settings.githubRel} (${target.id}@${target.ref})`;
				return { file: settingsFile, ok: true };
			} catch (error) {
				return { error: errorMessage(error), file, ok: false };
			}
		},
	);
	return [...results, ...machineResults, ...manifestResults, ...githubResults];
}

export async function validateTargets(
	targets: Map<string, ValidateTargets>,
	deps: FetchDeps = defaultDeps,
): Promise<ValidateResult[]> {
	const perKey = await Promise.all(
		[...targets.keys()].toSorted().map((key) => {
			const target = targets.get(key);
			if (target === undefined) {
				return Promise.resolve([]);
			}
			return validateOne(target, deps);
		}),
	);
	return perKey.flat();
}

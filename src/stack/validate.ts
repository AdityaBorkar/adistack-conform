import type { LoadedConform } from "#/config.js";
import { findMachineEntry } from "#/stack/registry.js";
import type { ManifestCompare, RegistryDocument } from "#/stack/registry.js";
import { fetchProjectManifest, fetchRegistry } from "#/stack/remote.js";
import { errorMessage } from "#/utils/fs.js";

export interface ValidateResult {
	error?: string;
	file: string;
	ok: boolean;
}

export interface ValidateTargets {
	id: string;
	machines: string[];
	projects: string[];
	ref: string;
}

type FetchDeps = {
	fetchManifest: typeof fetchProjectManifest;
	fetchRegistry: typeof fetchRegistry;
};

const defaultDeps: FetchDeps = { fetchManifest: fetchProjectManifest, fetchRegistry };

export function collectValidateTargets(
	configs: readonly LoadedConform[],
): Map<string, ValidateTargets> {
	const targets = new Map<string, ValidateTargets>();
	const add = (id: string, ref: string, kind: "machine" | "project", blueprint: string): void => {
		const key = `${id}@${ref}`;
		let entry = targets.get(key);
		if (entry === undefined) {
			entry = { id, machines: [], projects: [], ref };
			targets.set(key, entry);
		}
		const list = kind === "machine" ? entry.machines : entry.projects;
		if (!list.includes(blueprint)) {
			list.push(blueprint);
		}
	};
	for (const loaded of configs) {
		const { id, ref } = loaded.source;
		if (loaded.project !== undefined) {
			add(id, ref, "project", loaded.project.blueprint);
		}
		if (loaded.github !== undefined) {
			add(id, ref, "project", loaded.github.blueprint);
		}
		if (loaded.machine !== undefined) {
			add(id, ref, "machine", loaded.machine.blueprint);
		}
	}
	return targets;
}

function machineEntryError(blueprint: string, registry: RegistryDocument): string | undefined {
	try {
		return findMachineEntry(blueprint, registry) === undefined
			? `Machine blueprint "${blueprint}" not found in the tech-stack repo.`
			: undefined;
	} catch (error) {
		return errorMessage(error);
	}
}

function compareError(compare: ManifestCompare | undefined, fileName: string): string | undefined {
	if (compare === undefined) {
		return undefined;
	}
	const groups: [string, readonly string[]][] = [
		["ignore", compare.ignore],
		["strip", compare.strip],
		["versioned", compare.versioned],
	];
	const seen = new Map<string, string>();
	for (const [group, keys] of groups) {
		for (const key of keys) {
			const prev = seen.get(key);
			if (prev !== undefined) {
				return `Invalid compare in "${fileName}": "${key}" is in both "${prev}" and "${group}" (each key belongs to one group).`;
			}
			seen.set(key, group);
		}
	}
	return undefined;
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
	const machineResults = target.machines.toSorted().map((blueprint): ValidateResult => {
		const error = machineEntryError(blueprint, registry);
		return error === undefined
			? { file: `machine "${blueprint}" in ${registryFile}`, ok: true }
			: { error, file: `machine "${blueprint}" in ${registryFile}`, ok: false };
	});
	const manifestResults = await Promise.all(
		target.projects.toSorted().map(async (blueprint): Promise<ValidateResult> => {
			const file = `blueprint "${blueprint}" in ${registryFile}`;
			try {
				const manifest = await deps.fetchManifest(target.id, target.ref, blueprint, registry);
				const manifestFile = `${manifest.manifestRel} (${target.id}@${target.ref})`;
				for (const fileEntry of manifest.files) {
					const error = compareError(fileEntry.compare, fileEntry.name);
					if (error !== undefined) {
						return { error, file: manifestFile, ok: false };
					}
				}
				return { file: manifestFile, ok: true };
			} catch (error) {
				return { error: errorMessage(error), file, ok: false };
			}
		}),
	);
	return [...results, ...machineResults, ...manifestResults];
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

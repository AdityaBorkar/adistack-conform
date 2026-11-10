import type { Command } from "commander";

import { blueprintDirRel, findMachineEntry } from "#/stack/registry.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchGithubSettings, fetchProjectManifest, fetchRegistry } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import type { LoadedDesiredState } from "#/utils/config.js";
import { errorMessage } from "#/utils/fs.js";
import { okMark } from "#/utils/output.js";
import { loadDesiredStatesFromCommand } from "#/utils/run.js";

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
	fetchManifest: typeof fetchProjectManifest;
	fetchRegistry: typeof fetchRegistry;
};

const defaultDeps: FetchDeps = {
	fetchGithub: fetchGithubSettings,
	fetchManifest: fetchProjectManifest,
	fetchRegistry,
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
		const dirRel = blueprintDirRel(entry.path);
		if (dirRel === "") {
			return `Machine blueprint "${blueprint}" has an empty path in the registry.`;
		}
	} catch (error) {
		return errorMessage(error);
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

export async function runValidateCommand(cmd: Command): Promise<number> {
	const desiredStates = await loadDesiredStatesFromCommand(cmd);
	const results = await validateTargets(collectValidateTargets(desiredStates));
	if (results.length === 0) {
		console.error("Validate: no tech-stack targets configured.");
		return 2;
	}
	for (const result of results) {
		if (result.ok) {
			console.log(`${okMark(true)} ${result.file}`);
		} else {
			console.error(`${okMark(false)} ${result.file}\n    ${result.error ?? "invalid"}`);
		}
	}
	const invalid = results.filter((item) => !item.ok).length;
	if (invalid === 0) {
		console.log(`\nAll ${results.length} tech-stack file(s) valid.`);
		return 0;
	}
	console.log(`\nValidate: ${results.length - invalid} valid, ${invalid} invalid.`);
	return 1;
}

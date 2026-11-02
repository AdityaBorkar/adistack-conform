import { join } from "node:path";

import type * as z from "zod";

import type { CheckScope } from "#/checks.js";
import { parseOrThrow } from "#/schemas/common.js";
import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { readJsonFile } from "#/utils/fs.js";

export type PresetPackage =
	| z.infer<typeof MachinePresetManifestSchema>["packages"][number]
	| z.infer<typeof ProjectPresetManifestSchema>["packages"][number];
export type RegistryDocument = z.infer<typeof RegistrySchema>;

export const MAX_LIST_SHOWN = 10;

const registryDocCache = new Map<string, Promise<RegistryDocument>>();

function presetSchemaFor(scope: CheckScope) {
	return scope === "project" ? ProjectPresetManifestSchema : MachinePresetManifestSchema;
}

function blueprintSchemaFor(scope: CheckScope) {
	return scope === "project" ? ProjectBlueprintSchema : MachineBlueprintSchema;
}

export function loadRegistryDocument(repoRoot: string): Promise<RegistryDocument> {
	const pending = registryDocCache.get(repoRoot);
	if (pending !== undefined) {
		return pending;
	}
	const task = (async () => {
		const path = join(repoRoot, "registry.json");
		const parsed = await readJsonFile(path, "tech-stack registry");
		return parseOrThrow(RegistrySchema, path, parsed, "tech-stack registry");
	})();
	registryDocCache.set(repoRoot, task);
	task.catch(() => {
		if (registryDocCache.get(repoRoot) === task) {
			registryDocCache.delete(repoRoot);
		}
	});
	return task;
}

export async function loadRegistry(
	repoRoot: string,
	scope: CheckScope,
	registry: RegistryDocument,
): Promise<Map<string, PresetPackage>> {
	const schema = presetSchemaFor(scope);
	const manifests = await Promise.all(
		registry[scope].presets.map(async (dir) => {
			const manifestPath = join(repoRoot, dir, "manifest.json");
			return parseOrThrow(
				schema,
				manifestPath,
				await readJsonFile(manifestPath, "tech-stack preset manifest"),
				"tech-stack preset manifest",
			);
		}),
	);
	const byName = new Map<string, PresetPackage>();
	for (const manifest of manifests) {
		for (const pkg of manifest.packages) {
			// First manifest wins; registry order is the source of truth.
			if (!byName.has(pkg.name)) {
				byName.set(pkg.name, pkg);
			}
		}
	}
	return byName;
}

export async function listBlueprints(
	repoRoot: string,
	scope: CheckScope,
	registry: RegistryDocument,
): Promise<string[]> {
	const { glob } = await import("tinyglobby");
	const matches = await Promise.all(
		registry[scope].blueprints.map((dir) => glob("*/manifest.json", { cwd: join(repoRoot, dir) })),
	);
	const names = new Set<string>();
	for (const entries of matches) {
		for (const entry of entries) {
			names.add(entry.slice(0, -"/manifest.json".length));
		}
	}
	return [...names].toSorted();
}

export async function loadBlueprint(
	repoRoot: string,
	scope: CheckScope,
	name: string,
	registry: RegistryDocument,
): Promise<{ exclude: string[]; presets: string[] }> {
	const schema = blueprintSchemaFor(scope);
	const candidates = registry[scope].blueprints.map((dir) =>
		join(repoRoot, dir, name, "manifest.json"),
	);
	const attempts = await Promise.allSettled(
		candidates.map(async (path) => ({
			data: parseOrThrow(schema, path, await readJsonFile(path, "Blueprint"), "blueprint"),
			path,
		})),
	);
	for (const attempt of attempts) {
		if (attempt.status === "fulfilled") {
			return attempt.value.data;
		}
	}
	const available = await listBlueprints(repoRoot, scope, registry);
	const hint =
		available.length > MAX_LIST_SHOWN
			? ` Available blueprints: ${available.slice(0, MAX_LIST_SHOWN).join(", ")} (+${available.length - MAX_LIST_SHOWN} more).`
			: available.length > 0
				? ` Available blueprints: ${available.join(", ")}.`
				: "";
	throw new Error(`Blueprint "${name}" not found in the tech-stack repo.${hint}`);
}

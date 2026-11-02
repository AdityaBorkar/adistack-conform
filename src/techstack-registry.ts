import { join } from "node:path";

import { glob } from "tinyglobby";
import type * as z from "zod";

import type { CheckScope } from "#/checks.js";
import { readJsonFile } from "#/fs.js";
import { parseOrThrow } from "#/schemas/common.js";
import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { RegistrySchema } from "#/schemas/registry.js";

export type PresetPackage =
	| z.infer<typeof MachinePresetManifestSchema>["packages"][number]
	| z.infer<typeof ProjectPresetManifestSchema>["packages"][number];
export type RegistryDocument = z.infer<typeof RegistrySchema>;

function presetSchemaFor(scope: CheckScope) {
	return scope === "project" ? ProjectPresetManifestSchema : MachinePresetManifestSchema;
}

function blueprintSchemaFor(scope: CheckScope) {
	return scope === "project" ? ProjectBlueprintSchema : MachineBlueprintSchema;
}

export async function loadRegistryDocument(repoRoot: string): Promise<RegistryDocument> {
	const path = join(repoRoot, "registry.json");
	const parsed = await readJsonFile(path, "tech-stack registry");
	return parseOrThrow(RegistrySchema, path, parsed, "tech-stack registry");
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
			return {
				manifest: parseOrThrow(
					schema,
					manifestPath,
					await readJsonFile(manifestPath, "tech-stack preset manifest"),
					"tech-stack preset manifest",
				),
			};
		}),
	);
	const byName = new Map<string, PresetPackage>();
	for (const { manifest } of manifests) {
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
	const candidates = await Promise.all(
		registry[scope].blueprints.map(async (dir) => ({
			exists: await Bun.file(join(repoRoot, dir, name, "manifest.json")).exists(),
			path: join(repoRoot, dir, name, "manifest.json"),
		})),
	);
	const hit = candidates.find((candidate) => candidate.exists);
	if (hit === undefined) {
		const available = await listBlueprints(repoRoot, scope, registry);
		const hint =
			available.length > 10
				? ` Available blueprints: ${available.slice(0, 10).join(", ")} (+${available.length - 10} more).`
				: available.length > 0
					? ` Available blueprints: ${available.join(", ")}.`
					: "";
		throw new Error(`Blueprint "${name}" not found in the tech-stack repo.${hint}`);
	}
	return parseOrThrow(schema, hit.path, await readJsonFile(hit.path, "Blueprint"), "blueprint");
}

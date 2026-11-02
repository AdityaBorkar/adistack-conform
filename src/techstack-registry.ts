import { join } from "node:path";

import { glob } from "tinyglobby";
import * as z from "zod";

import type { CheckScope } from "#/checks.js";
import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { RegistrySchema } from "#/schemas/registry.js";

export type PresetPackage = z.infer<typeof ProjectPresetManifestSchema>["packages"][number];
export type RegistryDocument = z.infer<typeof RegistrySchema>;

function schemasFor(scope: CheckScope) {
	return scope === "project"
		? { blueprint: ProjectBlueprintSchema, preset: ProjectPresetManifestSchema }
		: { blueprint: MachineBlueprintSchema, preset: MachinePresetManifestSchema };
}

export async function loadRegistryDocument(repoRoot: string): Promise<RegistryDocument> {
	const path = join(repoRoot, "registry.json");
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`tech-stack registry not found: ${path}`);
	}
	let parsed: unknown;
	try {
		parsed = await file.json();
	} catch (error) {
		throw new Error(`Invalid tech-stack registry in ${path}`, { cause: error });
	}
	const result = RegistrySchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid tech-stack registry in ${path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

export async function loadRegistry(
	repoRoot: string,
	scope: CheckScope,
	registry: RegistryDocument,
): Promise<Map<string, PresetPackage>> {
	const { preset } = schemasFor(scope);
	const manifests = await Promise.all(
		registry[scope].presets.map(async (dir) => {
			const manifestPath = join(repoRoot, dir, "manifest.json");
			const manifestFile = Bun.file(manifestPath);
			if (!(await manifestFile.exists())) {
				throw new Error(`tech-stack preset manifest not found: ${manifestPath}`);
			}
			try {
				return { manifestPath, parsed: (await manifestFile.json()) as unknown };
			} catch (error) {
				throw new Error(`Invalid tech-stack preset manifest in ${manifestPath}`, { cause: error });
			}
		}),
	);
	const byName = new Map<string, PresetPackage>();
	for (const { manifestPath, parsed } of manifests) {
		const manifest = preset.safeParse(parsed);
		if (!manifest.success) {
			throw new Error(
				`Invalid tech-stack preset manifest in ${manifestPath}:\n${z.prettifyError(manifest.error)}`,
			);
		}
		for (const pkg of manifest.data.packages) {
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
	const { blueprint } = schemasFor(scope);
	const candidates = await Promise.all(
		registry[scope].blueprints.map(async (dir) => ({
			exists: await Bun.file(join(repoRoot, dir, name, "manifest.json")).exists(),
			path: join(repoRoot, dir, name, "manifest.json"),
		})),
	);
	const hit = candidates.find((candidate) => candidate.exists);
	if (hit === undefined) {
		const available = await listBlueprints(repoRoot, scope, registry);
		const hint = available.length > 0 ? ` Available blueprints: ${available.join(", ")}.` : "";
		throw new Error(`Blueprint "${name}" not found in the tech-stack repo.${hint}`);
	}
	let parsed: unknown;
	try {
		parsed = await Bun.file(hit.path).json();
	} catch (error) {
		throw new Error(`Invalid blueprint in ${hit.path}`, { cause: error });
	}
	const result = blueprint.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid blueprint in ${hit.path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

import type * as z from "zod";

import type { ManifestSchema } from "#/schemas/project-manifest.js";
import type { RegistrySchema } from "#/schemas/registry.js";

export type ManifestFile = z.infer<typeof ManifestSchema>["files"][number];
export type ManifestCompare = NonNullable<ManifestFile["compare"]>;
export type ManifestFileStructure = NonNullable<
	z.infer<typeof ManifestSchema>["file_structure"]
>[number];
export type RegistryDocument = z.infer<typeof RegistrySchema>;
export type RegistryEntry = {
	name: string;
	path: string;
};

function normalizeEntryPath(value: string): string {
	return value.replace(/\/+$/u, "").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function findInPathMap(
	name: string,
	map: Readonly<Record<string, string>>,
): RegistryEntry | undefined {
	const want = name.trim();
	if (want === "") {
		return undefined;
	}
	const direct = map[want];
	if (direct !== undefined) {
		return { name: want, path: direct };
	}
	// Fall back to repo-relative path equality so a stored
	// "./projects/cli-app.json" still resolves from "projects/cli-app.json".
	// Basename-only matching is deliberately unsupported: it silently resolves
	// typos to the wrong blueprint.
	const wantPath = normalizeEntryPath(want);
	for (const [key, path] of Object.entries(map)) {
		if (normalizeEntryPath(path) === wantPath) {
			return { name: key, path };
		}
	}
	return undefined;
}

export const MAX_LIST_SHOWN = 10;

export function availableHint(names: string[], label: string): string {
	if (names.length > MAX_LIST_SHOWN) {
		return ` Available ${label}: ${names.slice(0, MAX_LIST_SHOWN).join(", ")} (+${names.length - MAX_LIST_SHOWN} more).`;
	}
	if (names.length > 0) {
		return ` Available ${label}: ${names.join(", ")}.`;
	}
	return "";
}

export function listMachineBlueprintNames(registry: RegistryDocument): string[] {
	return Object.keys(registry.machines).toSorted();
}

export function listProjectBlueprintNames(registry: RegistryDocument): string[] {
	return Object.keys(registry.projects).toSorted();
}

export function listGithubBlueprintNames(registry: RegistryDocument): string[] {
	return Object.keys(registry.github_configs).toSorted();
}

export function findProjectEntry(
	name: string,
	registry: RegistryDocument,
): RegistryEntry | undefined {
	return findInPathMap(name, registry.projects);
}

export function findGithubEntry(
	name: string,
	registry: RegistryDocument,
): RegistryEntry | undefined {
	return findInPathMap(name, registry.github_configs);
}

export function findMachineEntry(
	name: string,
	registry: RegistryDocument,
): RegistryEntry | undefined {
	return findInPathMap(name, registry.machines);
}

function assertSafeRel(normalized: string, original: string, label: string): string {
	const segments = normalized.split("/");
	if (segments.some((part) => part === "" || part === "." || part === "..")) {
		throw new Error(
			`${label} "${original}" must stay inside the repo (no empty, ".", or ".." segments).`,
		);
	}
	if (normalized.includes("\\")) {
		throw new Error(`${label} "${original}" must use "/" separators.`);
	}
	return normalized;
}

// Repo-relative location of a blueprint file itself (project manifest,
// machine manifest, or GitHub settings).
export function blueprintRel(entryPath: string): string {
	const normalized = normalizeEntryPath(entryPath);
	if (!normalized.endsWith(".json")) {
		throw new Error(
			`Registry entry "${entryPath}" must be a blueprint file (e.g. ./machines/main.json); directory entries are no longer supported.`,
		);
	}
	return assertSafeRel(normalized, entryPath, "Registry entry");
}

import type * as z from "zod";

import type { ManifestSchema } from "#/schemas/manifest.js";
import type { RegistrySchema } from "#/schemas/registry.js";

export type ManifestFile = z.infer<typeof ManifestSchema>["files"][number];
export type ManifestCompare = NonNullable<ManifestFile["compare"]>;
export type ManifestFileStructure = NonNullable<
	z.infer<typeof ManifestSchema>["file_structure"]
>[number];
export type ManifestGithub = z.infer<typeof ManifestSchema>["github"];
export type ManifestJs = NonNullable<z.infer<typeof ManifestSchema>["js"]>;
export type RegistryDocument = z.infer<typeof RegistrySchema>;
export type RegistryEntry = RegistryDocument["projects"][number];

export const MAX_LIST_SHOWN = 10;

function normalizeEntryPath(value: string): string {
	return value.replace(/\/+$/u, "").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function dirKey(value: string): string {
	const segments = normalizeEntryPath(value)
		.split("/")
		.filter((part) => part !== "");
	const base = segments.at(-1) ?? "";
	return base.endsWith(".json") ? base.slice(0, -".json".length) : base;
}

function findEntry(name: string, entries: readonly RegistryEntry[]): RegistryEntry | undefined {
	const want = name.trim();
	if (want === "") {
		return undefined;
	}
	const exact = entries.find((entry) => entry.name === want);
	if (exact !== undefined) {
		return exact;
	}
	const wantPath = normalizeEntryPath(want);
	const byPath = entries.find((entry) => normalizeEntryPath(entry.path) === wantPath);
	if (byPath !== undefined) {
		return byPath;
	}
	const byDir = entries.find((entry) => dirKey(entry.path) === want);
	if (byDir !== undefined) {
		return byDir;
	}
	const wantDir = dirKey(want);
	if (wantDir !== "") {
		const byWantDir = entries.find((entry) => dirKey(entry.path) === wantDir);
		if (byWantDir !== undefined) {
			return byWantDir;
		}
	}
	return undefined;
}

function hint(names: string[], label: string): string {
	if (names.length > MAX_LIST_SHOWN) {
		return ` Available ${label}: ${names.slice(0, MAX_LIST_SHOWN).join(", ")} (+${names.length - MAX_LIST_SHOWN} more).`;
	}
	if (names.length > 0) {
		return ` Available ${label}: ${names.join(", ")}.`;
	}
	return "";
}

export function listMachineBlueprintNames(registry: RegistryDocument): string[] {
	return registry.machines.map((entry) => entry.name).toSorted();
}

export function listProjectBlueprintNames(registry: RegistryDocument): string[] {
	return registry.projects.map((entry) => entry.name).toSorted();
}

export function findProjectEntry(
	name: string,
	registry: RegistryDocument,
): RegistryEntry | undefined {
	return findEntry(name, registry.projects);
}

export function findMachineEntry(
	name: string,
	registry: RegistryDocument,
): RegistryEntry | undefined {
	return findEntry(name, registry.machines);
}

export function machineNotFoundError(name: string, registry: RegistryDocument): Error {
	return new Error(
		`Machine blueprint "${name}" not found in the tech-stack repo.${hint(listMachineBlueprintNames(registry), "machine blueprints")}`,
	);
}

// Repo-relative location of a project source file for raw fetches.
export function resolveSourceRel(source: string): string {
	if (source.startsWith("./") || source.startsWith("../")) {
		throw new Error(
			`Source "${source}" must be repo-relative (e.g. projects/files/<group>/<file>); "./" and "../" prefixes are no longer supported.`,
		);
	}
	return source.replace(/^\.\//u, "").replace(/^\/+/u, "");
}

export function manifestDirRel(entryPath: string): string {
	return normalizeEntryPath(entryPath);
}

// Repo-relative location of the project blueprint file itself.
export function manifestRel(entryPath: string): string {
	const normalized = normalizeEntryPath(entryPath);
	if (!normalized.endsWith(".json")) {
		throw new Error(
			`Registry entry "${entryPath}" must be a project blueprint file (e.g. ./projects/cli-app.json); directory entries are no longer supported.`,
		);
	}
	return normalized;
}

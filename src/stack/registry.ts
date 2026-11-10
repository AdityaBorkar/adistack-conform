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
	const wantPath = normalizeEntryPath(want);
	for (const [key, path] of Object.entries(map)) {
		if (normalizeEntryPath(path) === wantPath) {
			return { name: key, path };
		}
	}
	for (const [key, path] of Object.entries(map)) {
		if (dirKey(path) === want) {
			return { name: key, path };
		}
	}
	const wantDir = dirKey(want);
	if (wantDir !== "") {
		for (const [key, path] of Object.entries(map)) {
			if (dirKey(path) === wantDir) {
				return { name: key, path };
			}
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
	const want = name.trim();
	if (want === "") {
		return undefined;
	}
	const direct = registry.machines[want];
	if (direct !== undefined) {
		return { name: want, path: direct.path };
	}
	for (const [key, entry] of Object.entries(registry.machines)) {
		if (entry.name === want) {
			return { name: key, path: entry.path };
		}
	}
	const paths = Object.fromEntries(
		Object.entries(registry.machines).map(([key, entry]) => [key, entry.path]),
	);
	return findInPathMap(name, paths);
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
	const stripped = source.replace(/^\.\//u, "").replace(/^\/+/u, "");
	const segments = stripped.split("/");
	if (segments.some((part) => part === "" || part === "." || part === "..")) {
		throw new Error(
			`Source "${source}" must be repo-relative without empty, ".", or ".." segments.`,
		);
	}
	if (stripped.includes("\\")) {
		throw new Error(`Source "${source}" must use "/" separators.`);
	}
	return stripped;
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

export function blueprintDirRel(entryPath: string): string {
	return assertSafeRel(normalizeEntryPath(entryPath), entryPath, "Machine blueprint path");
}

// Repo-relative location of a blueprint file itself (project manifest or GitHub settings).
export function blueprintRel(entryPath: string): string {
	const normalized = normalizeEntryPath(entryPath);
	if (!normalized.endsWith(".json")) {
		throw new Error(
			`Registry entry "${entryPath}" must be a project blueprint file (e.g. ./projects/cli-app.json); directory entries are no longer supported.`,
		);
	}
	return assertSafeRel(normalized, entryPath, "Registry entry");
}

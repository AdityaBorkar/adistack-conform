import type * as v from "valibot";

import type { ManifestSchema } from "#/schemas/manifest.js";
import type { RegistrySchema } from "#/schemas/registry.js";

export type ManifestFile = v.InferOutput<typeof ManifestSchema>["files"][number];
export type ManifestCompare = NonNullable<ManifestFile["compare"]>;
export type ManifestFileStructure = NonNullable<
	v.InferOutput<typeof ManifestSchema>["file_structure"]
>[number];
export type ManifestGithub = v.InferOutput<typeof ManifestSchema>["github"];
export type ManifestJs = NonNullable<v.InferOutput<typeof ManifestSchema>["js"]>;
export type RegistryDocument = v.InferOutput<typeof RegistrySchema>;
export type RegistryEntry = RegistryDocument["projects"][number];

export const MAX_LIST_SHOWN = 10;

function normalizeEntryPath(value: string): string {
	return value.replace(/\/+$/u, "").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function dirKey(value: string): string {
	const segments = normalizeEntryPath(value)
		.split("/")
		.filter((part) => part !== "");
	return segments.at(-1) ?? "";
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

// Repo-relative form of a manifest source, for raw fetches.
export function resolveSourceRel(source: string, dirRel: string): string {
	if (source.startsWith("./") || source.startsWith("../")) {
		const parts: string[] = [];
		for (const segment of [...dirRel.split("/"), ...source.split("/")]) {
			if (segment === "" || segment === ".") {
				continue;
			}
			if (segment === "..") {
				parts.pop();
				continue;
			}
			parts.push(segment);
		}
		return parts.join("/");
	}
	return source.replace(/^\.\//u, "").replace(/^\/+/u, "");
}

export function manifestDirRel(entryPath: string): string {
	return normalizeEntryPath(entryPath);
}

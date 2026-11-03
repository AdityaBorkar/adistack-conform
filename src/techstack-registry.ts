import { join } from "node:path";

import type * as v from "valibot";

import { parseOrThrow } from "#/schemas/common.js";
import { ManifestSchema } from "#/schemas/manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { pathExists, readJsonFile } from "#/utils/fs.js";

export type ManifestFile = v.InferOutput<typeof ManifestSchema>["files"][number];
export type RegistryDocument = v.InferOutput<typeof RegistrySchema>;
export type RegistryEntry = RegistryDocument["projects"][number];

export const MAX_LIST_SHOWN = 10;

const registryDocCache = new Map<string, Promise<RegistryDocument>>();

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

export async function loadProjectManifest(
	repoRoot: string,
	name: string,
	registry: RegistryDocument,
): Promise<{ dir: string; files: ManifestFile[] }> {
	const entry = findProjectEntry(name, registry);
	if (entry === undefined) {
		throw new Error(
			`Blueprint "${name}" not found in the tech-stack repo.${hint(listProjectBlueprintNames(registry), "blueprints")}`,
		);
	}
	const dir = join(repoRoot, entry.path);
	const path = join(dir, "manifest.json");
	if (!(await pathExists(path))) {
		throw new Error(
			`Blueprint "${entry.name}" has no manifest.json in ${dir}.${hint(listProjectBlueprintNames(registry), "blueprints")}`,
		);
	}
	const data = parseOrThrow(
		ManifestSchema,
		path,
		await readJsonFile(path, "Blueprint"),
		"blueprint",
	);
	return { dir, files: data.files };
}

function swapMachinePlural(path: string): string | undefined {
	if (/(^|\/)machines\//u.test(path)) {
		return path.replace(/(^|\/)machines\//u, "$1machine/");
	}
	if (/(^|\/)machine\//u.test(path)) {
		return path.replace(/(^|\/)machine\//u, "$1machines/");
	}
	return undefined;
}

export async function loadMachineBlueprint(
	repoRoot: string,
	name: string,
	registry: RegistryDocument,
): Promise<{ dir: string }> {
	const entry = findMachineEntry(name, registry);
	if (entry === undefined) {
		throw new Error(
			`Machine blueprint "${name}" not found in the tech-stack repo.${hint(listMachineBlueprintNames(registry), "machine blueprints")}`,
		);
	}
	const candidates = [join(repoRoot, entry.path)];
	const swapped = swapMachinePlural(entry.path);
	if (swapped !== undefined) {
		candidates.push(join(repoRoot, swapped));
	}
	const checks = await Promise.all(candidates.map((dir) => pathExists(join(dir, "flake.nix"))));
	const hit = candidates.find((_dir, index) => checks[index] === true);
	if (hit !== undefined) {
		return { dir: hit };
	}
	throw new Error(
		`Machine blueprint "${entry.name}" is not a nix flake (missing flake.nix in ${candidates[0]}).`,
	);
}

// Manifest `source` values starting with ./ or ../ resolve against the
// manifest directory; anything else is repo-relative.
export function resolveSourcePath(source: string, manifestDir: string, repoRoot: string): string {
	if (source.startsWith("./") || source.startsWith("../")) {
		return join(manifestDir, source);
	}
	return join(repoRoot, source);
}

// Repo-relative form of a manifest source, for sparse raw fetches.
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

import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { parseOrThrow } from "#/schemas/common.js";
import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { checkPresetFileWithGolden, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { PresetPackage, RegistryDocument } from "#/techstack-registry.js";
import { MAX_LIST_SHOWN } from "#/techstack-registry.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage, resolveTargetPath } from "#/utils/fs.js";

export const SPARSE_FETCH_CONCURRENCY = 16;
const FETCH_TIMEOUT_MS = 30_000;

const registryCache = new Map<string, Promise<RegistryDocument>>();

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "User-Agent": "adistack-conform" };
	const token = process.env["GITHUB_TOKEN"];
	if (token !== undefined && token !== "") {
		headers["Authorization"] = `Bearer ${token}`;
	}
	return headers;
}

function encodeRelPath(relPath: string): string {
	const trimmed = relPath.startsWith("./") ? relPath.slice(2) : relPath;
	return trimmed
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function rawUrl(id: string, ref: string, relPath: string): string {
	return `https://raw.githubusercontent.com/${id}/${ref}/${encodeRelPath(relPath)}`;
}

async function fetchTextOrThrow(url: string, label: string): Promise<string> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: authHeaders(),
			redirect: "follow",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Cannot fetch ${label}: ${errorMessage(error)}`, { cause: error });
	}
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`${label} not found (${url}): HTTP 404.`);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`${label} refused (${url}): HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN).`,
			);
		}
		throw new Error(`${label} fetch failed (${url}): HTTP ${response.status}.`);
	}
	return response.text();
}

async function fetchRegistry(id: string, ref: string): Promise<RegistryDocument> {
	const key = `${id}@${ref}/registry.json`;
	const pending = registryCache.get(key);
	if (pending !== undefined) {
		return pending;
	}
	const task = (async () => {
		const text = await fetchTextOrThrow(rawUrl(id, ref, "registry.json"), "tech-stack registry");
		let parsed: unknown;
		try {
			parsed = JSON.parse(text) as unknown;
		} catch (error) {
			throw new Error(`tech-stack registry has invalid JSON: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		return parseOrThrow(RegistrySchema, "registry.json (sparse)", parsed, "tech-stack registry");
	})();
	registryCache.set(key, task);
	try {
		return await task;
	} catch (error) {
		if (registryCache.get(key) === task) {
			registryCache.delete(key);
		}
		throw error;
	}
}

async function fetchManifests(
	id: string,
	ref: string,
	scope: CheckScope,
	registry: RegistryDocument,
): Promise<Map<string, PresetPackage>> {
	const schema = scope === "project" ? ProjectPresetManifestSchema : MachinePresetManifestSchema;
	const manifests = await mapWithConcurrency(
		registry[scope].presets,
		SPARSE_FETCH_CONCURRENCY,
		async (dir) => {
			const rel = dir.endsWith("/manifest.json")
				? dir
				: `${dir.replace(/\/+$/u, "")}/manifest.json`;
			const text = await fetchTextOrThrow(rawUrl(id, ref, rel), "tech-stack preset manifest");
			let parsed: unknown;
			try {
				parsed = JSON.parse(text) as unknown;
			} catch (error) {
				throw new Error(`tech-stack preset manifest has invalid JSON in ${rel}`, {
					cause: error,
				});
			}
			return parseOrThrow(schema, `${rel} (sparse)`, parsed, "tech-stack preset manifest");
		},
	);
	const byName = new Map<string, PresetPackage>();
	for (const manifest of manifests) {
		for (const pkg of manifest.packages) {
			if (!byName.has(pkg.name)) {
				byName.set(pkg.name, pkg);
			}
		}
	}
	return byName;
}

async function fetchBlueprint(
	id: string,
	ref: string,
	scope: CheckScope,
	name: string,
	registry: RegistryDocument,
): Promise<{ exclude: string[]; presets: string[] }> {
	const schema = scope === "project" ? ProjectBlueprintSchema : MachineBlueprintSchema;
	const candidates = registry[scope].blueprints.map((dir) => {
		const clean = dir.replace(/\/+$/u, "");
		const prefix = clean === "." ? "" : `${clean}/`;
		return `${prefix}${name}/manifest.json`;
	});
	const results = await Promise.allSettled(
		candidates.map(async (rel) => {
			const text = await fetchTextOrThrow(rawUrl(id, ref, rel), `blueprint ${name}`);
			let parsed: unknown;
			try {
				parsed = JSON.parse(text) as unknown;
			} catch (error) {
				throw new Error(`Blueprint ${name} has invalid JSON in ${rel}`, { cause: error });
			}
			return parseOrThrow(schema, `${rel} (sparse)`, parsed, "blueprint");
		}),
	);
	const hit = results.find((result) => result.status === "fulfilled");
	if (hit !== undefined && hit.status === "fulfilled") {
		return { exclude: hit.value.exclude, presets: hit.value.presets };
	}
	throw new Error(`Blueprint "${name}" not found in the tech-stack repo.`);
}

function resolveWantedNames(
	spec: TechStackSpec,
	blueprint: { exclude: string[]; presets: string[] } | undefined,
	registry: Map<string, PresetPackage>,
): string[] {
	const blueprintPresets = blueprint?.presets ?? [];
	const blueprintExcludes = blueprint?.exclude ?? [];
	const wanted = new Set([...blueprintPresets, ...spec.presets]);
	for (const excluded of [...blueprintExcludes, ...spec.exclude]) {
		wanted.delete(excluded);
	}
	const names = [...wanted].toSorted();
	const unknown = names.filter((name) => !registry.has(name));
	if (unknown.length > 0) {
		const shown = unknown.slice(0, MAX_LIST_SHOWN).join(", ");
		const suffix =
			unknown.length > MAX_LIST_SHOWN ? ` (+${unknown.length - MAX_LIST_SHOWN} more)` : "";
		const keys = [...registry.keys()].toSorted();
		const available =
			keys.length > MAX_LIST_SHOWN
				? `${keys.slice(0, MAX_LIST_SHOWN).join(", ")} (+${keys.length - MAX_LIST_SHOWN} more)`
				: keys.join(", ");
		throw new Error(`Unknown tech-stack preset(s): ${shown}${suffix}. Available: ${available}.`);
	}
	return names;
}

export interface SparseCheckOptions {
	baseDir: string;
	home: string;
	noCache?: boolean;
	scope: CheckScope;
}

export async function recheckSparseSelected(
	spec: TechStackSpec,
	options: SparseCheckOptions,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return [];
	}
	if (spec.ref.includes("/")) {
		throw new Error(`Sparse fetch unavailable for ref "${spec.ref}" (contains "/").`);
	}
	const registry = await fetchRegistry(spec.id, spec.ref);
	const manifests = await fetchManifests(spec.id, spec.ref, options.scope, registry);
	const blueprint =
		spec.blueprint === undefined
			? undefined
			: await fetchBlueprint(spec.id, spec.ref, options.scope, spec.blueprint, registry);
	const names = resolveWantedNames(spec, blueprint, manifests);
	const needed: Array<{
		needsGolden: boolean;
		packageName: string;
		presetFileName: string;
		presetRelPath: string;
		presetTarget: string;
		targetPath: string;
	}> = [];
	for (const name of names) {
		const pkg = manifests.get(name);
		if (pkg === undefined) {
			continue;
		}
		for (const file of pkg.files) {
			const id = `preset:${name}:${file.name}`;
			if (!selectedIds.has(id)) {
				continue;
			}
			const classified = classifyTarget(file.target, options.scope);
			if (classified.type === "skip") {
				continue;
			}
			needed.push({
				needsGolden: !file.path.endsWith(".example"),
				packageName: name,
				presetFileName: file.name,
				presetRelPath: file.path,
				presetTarget: file.target,
				targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
			});
		}
	}
	const goldens = new Map<string, string>();
	const toFetch = [
		...new Set(needed.filter((item) => item.needsGolden).map((item) => item.presetRelPath)),
	];
	await mapWithConcurrency(toFetch, SPARSE_FETCH_CONCURRENCY, async (rel) => {
		try {
			const text = await fetchTextOrThrow(rawUrl(spec.id, spec.ref, rel), `preset file ${rel}`);
			goldens.set(rel, text);
		} catch {
			// Leave absent: caller reports "<preset file missing>" like the disk path.
		}
	});
	return mapWithConcurrency(needed, SPARSE_FETCH_CONCURRENCY, async (item) => {
		if (!item.needsGolden) {
			return checkPresetFileWithGolden({
				golden: "",
				packageName: item.packageName,
				presetFileName: item.presetFileName,
				presetRelPath: item.presetRelPath,
				presetTarget: item.presetTarget,
				scope: options.scope,
				targetPath: item.targetPath,
			});
		}
		const golden = goldens.get(item.presetRelPath);
		if (golden === undefined) {
			const { failManual } = await import("#/checks.js");
			return failManual(
				{
					id: `preset:${item.packageName}:${item.presetFileName}`,
					kind: "preset",
					scope: options.scope,
					source: `tech-stack:${item.packageName}`,
					target: item.presetTarget,
				},
				"<preset file missing>",
				item.presetRelPath,
				`Preset file missing in tech-stack repo: ${item.presetRelPath}`,
			);
		}
		return checkPresetFileWithGolden({
			golden,
			packageName: item.packageName,
			presetFileName: item.presetFileName,
			presetRelPath: item.presetRelPath,
			presetTarget: item.presetTarget,
			scope: options.scope,
			targetPath: item.targetPath,
		});
	});
}

export async function runSparseChecks(
	spec: TechStackSpec,
	options: SparseCheckOptions,
): Promise<{ results: CheckResult[]; warnings: string[] }> {
	if (spec.ref.includes("/")) {
		throw new Error(`Sparse fetch unavailable for ref "${spec.ref}" (contains "/").`);
	}
	const registry = await fetchRegistry(spec.id, spec.ref);
	const manifests = await fetchManifests(spec.id, spec.ref, options.scope, registry);
	const blueprint =
		spec.blueprint === undefined
			? undefined
			: await fetchBlueprint(spec.id, spec.ref, options.scope, spec.blueprint, registry);
	const names = resolveWantedNames(spec, blueprint, manifests);
	const skips: CheckResult[] = [];
	const needed: Array<{
		needsGolden: boolean;
		packageName: string;
		presetFileName: string;
		presetRelPath: string;
		presetTarget: string;
		targetPath: string;
	}> = [];
	for (const name of names) {
		const pkg = manifests.get(name);
		if (pkg === undefined) {
			throw new Error(`Preset "${name}" disappeared from the tech-stack registry.`);
		}
		for (const file of pkg.files) {
			const classified = classifyTarget(file.target, options.scope);
			if (classified.type === "skip") {
				skips.push(
					skippedForTarget(
						name,
						file.name,
						file.path,
						file.target,
						classified.reason,
						options.scope,
					),
				);
				continue;
			}
			needed.push({
				needsGolden: !file.path.endsWith(".example"),
				packageName: name,
				presetFileName: file.name,
				presetRelPath: file.path,
				presetTarget: file.target,
				targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
			});
		}
	}
	const goldens = new Map<string, string>();
	const toFetch = [
		...new Set(needed.filter((item) => item.needsGolden).map((item) => item.presetRelPath)),
	];
	await mapWithConcurrency(toFetch, SPARSE_FETCH_CONCURRENCY, async (rel) => {
		try {
			const text = await fetchTextOrThrow(rawUrl(spec.id, spec.ref, rel), `preset file ${rel}`);
			goldens.set(rel, text);
		} catch {
			// Leave absent: caller reports "<preset file missing>" like the disk path.
		}
	});
	const enforced = await mapWithConcurrency(
		needed,
		SPARSE_FETCH_CONCURRENCY,
		async (item): Promise<CheckResult> => {
			if (!item.needsGolden) {
				return checkPresetFileWithGolden({
					golden: "",
					packageName: item.packageName,
					presetFileName: item.presetFileName,
					presetRelPath: item.presetRelPath,
					presetTarget: item.presetTarget,
					scope: options.scope,
					targetPath: item.targetPath,
				});
			}
			const golden = goldens.get(item.presetRelPath);
			if (golden === undefined) {
				const { failManual } = await import("#/checks.js");
				return failManual(
					{
						id: `preset:${item.packageName}:${item.presetFileName}`,
						kind: "preset",
						scope: options.scope,
						source: `tech-stack:${item.packageName}`,
						target: item.presetTarget,
					},
					"<preset file missing>",
					item.presetRelPath,
					`Preset file missing in tech-stack repo: ${item.presetRelPath}`,
				);
			}
			return checkPresetFileWithGolden({
				golden,
				packageName: item.packageName,
				presetFileName: item.presetFileName,
				presetRelPath: item.presetRelPath,
				presetTarget: item.presetTarget,
				scope: options.scope,
				targetPath: item.targetPath,
			});
		},
	);
	return { results: [...skips, ...enforced], warnings: [] };
}

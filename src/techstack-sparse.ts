import type { CheckResult, CheckScope } from "#/checks.js";
import type { ProjectRunSpec } from "#/config.js";
import { parseOrThrow } from "#/schemas/common.js";
import { ManifestSchema } from "#/schemas/manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { checkPresetFileWithGolden, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { ManifestFile, RegistryDocument } from "#/techstack-registry.js";
import { findProjectEntry, manifestDirRel, resolveSourceRel } from "#/techstack-registry.js";
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
				`${label} refused (${url}): HTTP 401/403 (private repo or rate limit — set GITHUB_TOKEN).`,
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

async function fetchManifest(
	id: string,
	ref: string,
	name: string,
	registry: RegistryDocument,
): Promise<{ dirRel: string; files: ManifestFile[] }> {
	const entry = findProjectEntry(name, registry);
	if (entry === undefined) {
		throw new Error(`Blueprint "${name}" not found in the tech-stack repo.`);
	}
	const dirRel = manifestDirRel(entry.path);
	const rel = `${dirRel}/manifest.json`;
	const text = await fetchTextOrThrow(rawUrl(id, ref, rel), `blueprint ${name}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`Blueprint ${name} has invalid JSON in ${rel}`, { cause: error });
	}
	const data = parseOrThrow(ManifestSchema, `${rel} (sparse)`, parsed, "blueprint");
	return { dirRel, files: data.files };
}

export interface SparseCheckOptions {
	baseDir: string;
	home: string;
	noCache?: boolean;
	scope: CheckScope;
}

interface NeededFile {
	blueprint: string;
	fileName: string;
	fileTarget: string;
	needsGolden: boolean;
	sourceLabel: string;
	sourceRel: string;
	targetPath: string;
}

function collectNeeded(
	blueprint: string,
	files: ManifestFile[],
	dirRel: string,
	options: SparseCheckOptions,
	onlyIds?: ReadonlySet<string>,
): { needed: NeededFile[]; skips: CheckResult[] } {
	const needed: NeededFile[] = [];
	const skips: CheckResult[] = [];
	for (const file of files) {
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${file.name}`)) {
			continue;
		}
		const classified = classifyTarget(file.target, options.scope);
		if (classified.type === "skip") {
			skips.push(
				skippedForTarget(
					blueprint,
					file.name,
					file.source,
					file.target,
					classified.reason,
					options.scope,
				),
			);
			continue;
		}
		needed.push({
			blueprint,
			fileName: file.name,
			fileTarget: file.target,
			needsGolden: !file.source.endsWith(".example"),
			sourceLabel: file.source,
			sourceRel: resolveSourceRel(file.source, dirRel),
			targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
		});
	}
	return { needed, skips };
}

async function fetchGoldens(
	spec: ProjectRunSpec,
	needed: readonly NeededFile[],
): Promise<Map<string, string>> {
	const goldens = new Map<string, string>();
	const toFetch = [
		...new Set(needed.filter((item) => item.needsGolden).map((item) => item.sourceRel)),
	];
	await mapWithConcurrency(toFetch, SPARSE_FETCH_CONCURRENCY, async (rel) => {
		try {
			const text = await fetchTextOrThrow(rawUrl(spec.id, spec.ref, rel), `preset file ${rel}`);
			goldens.set(rel, text);
		} catch {
			// Leave absent: caller reports "<preset file missing>" like the disk path.
		}
	});
	return goldens;
}

function checkNeeded(
	needed: readonly NeededFile[],
	goldens: Map<string, string>,
	scope: CheckScope,
): Promise<CheckResult[]> {
	return mapWithConcurrency(
		needed,
		SPARSE_FETCH_CONCURRENCY,
		async (item): Promise<CheckResult> => {
			if (!item.needsGolden) {
				return checkPresetFileWithGolden({
					blueprint: item.blueprint,
					fileName: item.fileName,
					fileTarget: item.fileTarget,
					golden: "",
					scope,
					sourceLabel: item.sourceLabel,
					targetPath: item.targetPath,
				});
			}
			const golden = goldens.get(item.sourceRel);
			if (golden === undefined) {
				const { failManual } = await import("#/checks.js");
				return failManual(
					{
						id: `project:${item.blueprint}:${item.fileName}`,
						kind: "preset",
						scope,
						source: `tech-stack:${item.blueprint}`,
						target: item.fileTarget,
					},
					"<preset file missing>",
					item.sourceRel,
					`Preset file missing in tech-stack repo: ${item.sourceRel}`,
				);
			}
			return checkPresetFileWithGolden({
				blueprint: item.blueprint,
				fileName: item.fileName,
				fileTarget: item.fileTarget,
				golden,
				scope,
				sourceLabel: item.sourceLabel,
				targetPath: item.targetPath,
			});
		},
	);
}

export async function recheckSparseSelected(
	spec: ProjectRunSpec,
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
	const { dirRel, files } = await fetchManifest(spec.id, spec.ref, spec.blueprint, registry);
	const { needed } = collectNeeded(spec.blueprint, files, dirRel, options, selectedIds);
	const goldens = await fetchGoldens(spec, needed);
	return checkNeeded(needed, goldens, options.scope);
}

export async function runSparseChecks(
	spec: ProjectRunSpec,
	options: SparseCheckOptions,
): Promise<{ results: CheckResult[]; warnings: string[] }> {
	if (spec.ref.includes("/")) {
		throw new Error(`Sparse fetch unavailable for ref "${spec.ref}" (contains "/").`);
	}
	const registry = await fetchRegistry(spec.id, spec.ref);
	const { dirRel, files } = await fetchManifest(spec.id, spec.ref, spec.blueprint, registry);
	const { needed, skips } = collectNeeded(spec.blueprint, files, dirRel, options);
	const goldens = await fetchGoldens(spec, needed);
	const enforced = await checkNeeded(needed, goldens, options.scope);
	return { results: [...skips, ...enforced], warnings: [] };
}

import { ManifestSchema } from "#/schemas/manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import type {
	ManifestDirectory,
	ManifestFile,
	ManifestJs,
	ManifestRequired,
	RegistryDocument,
} from "#/stack/registry.js";
import { findProjectEntry, listProjectBlueprintNames, manifestDirRel } from "#/stack/registry.js";
import { errorMessage } from "#/utils/fs.js";
import { parseOrThrow } from "#/utils/schema.js";

const FETCH_TIMEOUT_MS = 30_000;

export function repoKey(id: string, ref: string): string {
	return `${id}@${ref}`;
}

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

export function rawUrl(id: string, ref: string, relPath: string): string {
	return `https://raw.githubusercontent.com/${id}/${ref}/${encodeRelPath(relPath)}`;
}

export async function fetchTextOrThrow(url: string, label: string): Promise<string> {
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

async function fetchJson(url: string, label: string): Promise<unknown> {
	const text = await fetchTextOrThrow(url, label);
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`${label} has invalid JSON in ${url}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
}

export async function fetchRegistry(id: string, ref: string): Promise<RegistryDocument> {
	const parsed = await fetchJson(rawUrl(id, ref, "registry.json"), "tech-stack registry");
	return parseOrThrow(RegistrySchema, "registry.json (remote)", parsed, "tech-stack registry");
}

export async function fetchProjectManifest(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<{
	directories: ManifestDirectory[];
	dirRel: string;
	files: ManifestFile[];
	js: ManifestJs | undefined;
	required: ManifestRequired;
}> {
	const entry = findProjectEntry(blueprint, registry);
	if (entry === undefined) {
		const names = listProjectBlueprintNames(registry);
		const hint = names.length > 0 ? ` Available blueprints: ${names.join(", ")}.` : "";
		throw new Error(`Blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const dirRel = manifestDirRel(entry.path);
	const rel = `${dirRel}/manifest.json`;
	const parsed = await fetchJson(rawUrl(id, ref, rel), `blueprint ${blueprint}`);
	const data = parseOrThrow(ManifestSchema, `${rel} (remote)`, parsed, "blueprint");
	return {
		dirRel,
		directories: data.directories ?? [],
		files: data.files,
		js: data.js,
		required: data.required ?? [],
	};
}

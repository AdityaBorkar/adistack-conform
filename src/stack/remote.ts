import type * as z from "zod";

import { GithubSchema } from "#/schemas/github-manifest";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { parseJsonc } from "#/stack/check.js";
import type { ManifestFile, ManifestFileStructure, RegistryDocument } from "#/stack/registry.js";
import {
	findGithubEntry,
	findProjectEntry,
	listGithubBlueprintNames,
	listProjectBlueprintNames,
	manifestRel,
} from "#/stack/registry.js";
import { errorMessage } from "#/utils/fs.js";
import { FETCH_TIMEOUT_MS, authHeaders, encodePathSegments } from "#/utils/net.js";
import { parseOrThrow } from "#/utils/schema.js";

export function repoKey(id: string, ref: string): string {
	return `${id}@${ref}`;
}

export function rawUrl(id: string, ref: string, relPath: string): string {
	return `https://raw.githubusercontent.com/${id}/${ref}/${encodePathSegments(relPath)}`;
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

async function fetchJsonc(url: string, label: string): Promise<unknown> {
	const text = await fetchTextOrThrow(url, label);
	try {
		return parseJsonc(text);
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
	files: ManifestFile[];
	manifestRel: string;
	structure: ManifestFileStructure[];
}> {
	const entry = findProjectEntry(blueprint, registry);
	if (entry === undefined) {
		const names = listProjectBlueprintNames(registry);
		const hint = names.length > 0 ? ` Available blueprints: ${names.join(", ")}.` : "";
		throw new Error(`Blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const rel = manifestRel(entry.path);
	const parsed = await fetchJson(rawUrl(id, ref, rel), `blueprint ${blueprint}`);
	const data = parseOrThrow(ManifestSchema, `${rel} (remote)`, parsed, "blueprint");
	return {
		files: data.files,
		manifestRel: rel,
		structure: data.file_structure,
	};
}

export async function fetchGithubConfig(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<{
	githubRel: string;
	golden: z.infer<typeof GithubSchema>;
}> {
	const entry = findGithubEntry(blueprint, registry);
	if (entry === undefined) {
		const names = listGithubBlueprintNames(registry);
		const hint = names.length > 0 ? ` Available blueprints: ${names.join(", ")}.` : "";
		throw new Error(`GitHub blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const rel = manifestRel(entry.path);
	const parsed = await fetchJsonc(rawUrl(id, ref, rel), `github settings ${blueprint}`);
	const golden = parseOrThrow(GithubSchema, `${rel} (remote)`, parsed, "github settings");
	return { githubRel: rel, golden };
}

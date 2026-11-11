import type * as z from "zod";

import { GithubSchema } from "#/schemas/github-settings.js";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import type { ManifestFile, ManifestFileStructure, RegistryDocument } from "#/stack/registry.js";
import {
	findGithubEntry,
	findProjectEntry,
	listGithubBlueprintNames,
	listProjectBlueprintNames,
	blueprintRel,
} from "#/stack/registry.js";
import { errorMessage } from "#/utils/fs.js";
import { parseJsonc } from "#/utils/jsonc.js";
import {
	FETCH_TIMEOUT_MS,
	assertRef,
	assertRepoId,
	authHeaders,
	encodePathSegments,
	userAgentHeaders,
	withRetry,
} from "#/utils/net.js";
import { parseOrThrow } from "#/utils/schema.js";

export function repoKey(id: string, ref: string): string {
	return `${id}@${ref}`;
}

export function rawUrl(id: string, ref: string, relPath: string): string {
	assertRepoId(id, "tech-stack source");
	assertRef(ref, "tech-stack source");
	return `https://raw.githubusercontent.com/${id}/${ref}/${encodePathSegments(relPath)}`;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function fetchTextOrThrow(url: string, label: string): Promise<string> {
	const origin = new URL(url).origin;
	return withRetry(
		async () => {
			let current = url;
			for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
				const sameOrigin = new URL(current).origin === origin;
				let response: Response;
				try {
					response = await fetch(current, {
						headers: sameOrigin ? authHeaders() : userAgentHeaders(),
						redirect: "manual",
						signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
					});
				} catch (error) {
					throw new Error(`Cannot fetch ${label}: ${errorMessage(error)}`, { cause: error });
				}
				if (REDIRECT_STATUSES.has(response.status) && response.headers.get("location") !== null) {
					if (hop === MAX_REDIRECTS) {
						throw new Error(`${label} fetch failed (${url}): too many redirects.`);
					}
					current = new URL(response.headers.get("location") as string, current).toString();
					continue;
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
			throw new Error(`${label} fetch failed (${url}): too many redirects.`);
		},
		(error) =>
			error instanceof Error &&
			(/Cannot fetch /u.test(error.message) ||
				/HTTP 429/u.test(error.message) ||
				/HTTP 5\d\d/u.test(error.message)),
	);
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
	blueprintRel: string;
	files: ManifestFile[];
	structure: ManifestFileStructure[];
}> {
	const entry = findProjectEntry(blueprint, registry);
	if (entry === undefined) {
		const names = listProjectBlueprintNames(registry);
		const hint = names.length > 0 ? ` Available blueprints: ${names.join(", ")}.` : "";
		throw new Error(`Blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const rel = blueprintRel(entry.path);
	const parsed = await fetchJson(rawUrl(id, ref, rel), `blueprint ${blueprint}`);
	const data = parseOrThrow(ManifestSchema, `${rel} (remote)`, parsed, "blueprint");
	return {
		blueprintRel: rel,
		files: data.files,
		structure: data.file_structure,
	};
}

export async function fetchGithubSettings(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<{
	githubRel: string;
	upstream: z.infer<typeof GithubSchema>;
}> {
	const entry = findGithubEntry(blueprint, registry);
	if (entry === undefined) {
		const names = listGithubBlueprintNames(registry);
		const hint = names.length > 0 ? ` Available blueprints: ${names.join(", ")}.` : "";
		throw new Error(`GitHub blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const rel = blueprintRel(entry.path);
	const parsed = await fetchJsonc(rawUrl(id, ref, rel), `github settings ${blueprint}`);
	const upstream = parseOrThrow(GithubSchema, `${rel} (remote)`, parsed, "github settings");
	return { githubRel: rel, upstream };
}

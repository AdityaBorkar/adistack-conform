import type * as z from "zod";

import type {
	ManifestFile,
	ManifestFileStructure,
	RegistryDocument,
} from "#/core/upstream/registry.js";
import {
	availableHint,
	findGithubEntry,
	findMachineEntry,
	findProjectEntry,
	listGithubBlueprintNames,
	listMachineBlueprintNames,
	listProjectBlueprintNames,
	blueprintRel,
} from "#/core/upstream/registry.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import { MachineManifestSchema } from "#/schemas/machine-manifest.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { errorMessage } from "#/utils/error.js";
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

// Upstream file fetches per scope run; see ADR 0002.
export const UPSTREAM_FETCH_CONCURRENCY = 16;

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

async function fetchOkResponse(url: string, label: string): Promise<Response> {
	const origin = new URL(url).origin;
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
		return response;
	}
	throw new Error(`${label} fetch failed (${url}): too many redirects.`);
}

function isFetchRetryable(error: unknown): boolean {
	return (
		error instanceof Error &&
		(/Cannot fetch /u.test(error.message) ||
			/HTTP 429/u.test(error.message) ||
			/HTTP 5\d\d/u.test(error.message))
	);
}

export function fetchTextOrThrow(url: string, label: string): Promise<string> {
	return withRetry(async () => (await fetchOkResponse(url, label)).text(), isFetchRetryable);
}

// Byte-exact fetch for link upstreams: response.text() would corrupt binary
// dotfiles, so materialize and compare on raw bytes instead.
export function fetchBytesOrThrow(url: string, label: string): Promise<Uint8Array> {
	return withRetry(
		async () => new Uint8Array(await (await fetchOkResponse(url, label)).arrayBuffer()),
		isFetchRetryable,
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
		const hint = availableHint(listProjectBlueprintNames(registry), "blueprints");
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
		const hint = availableHint(listGithubBlueprintNames(registry), "blueprints");
		throw new Error(`GitHub blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const rel = blueprintRel(entry.path);
	const parsed = await fetchJsonc(rawUrl(id, ref, rel), `github settings ${blueprint}`);
	const upstream = parseOrThrow(GithubSchema, `${rel} (remote)`, parsed, "github settings");
	return { githubRel: rel, upstream };
}

export async function fetchMachineManifest(
	id: string,
	ref: string,
	blueprint: string,
	registry: RegistryDocument,
): Promise<{
	manifest: MachineManifest;
	manifestRel: string;
}> {
	const entry = findMachineEntry(blueprint, registry);
	if (entry === undefined) {
		const hint = availableHint(listMachineBlueprintNames(registry), "machine blueprints");
		throw new Error(`Machine blueprint "${blueprint}" not found in the tech-stack repo.${hint}`);
	}
	const manifestRel = blueprintRel(entry.path);
	const parsed = await fetchJson(rawUrl(id, ref, manifestRel), `machine manifest ${blueprint}`);
	const manifest = parseOrThrow(
		MachineManifestSchema,
		`${manifestRel} (remote)`,
		parsed,
		"machine manifest",
	);
	return { manifest, manifestRel };
}

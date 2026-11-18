import type { RunState } from "#/core/config.js";
import type { BlueprintData } from "#/core/upstream/blueprint.js";
import { blueprintLabels, parseBlueprint } from "#/core/upstream/blueprint.js";
import type { BlueprintKind, RegistryDocument } from "#/core/upstream/registry.js";
import {
	availableHint,
	blueprintNames,
	blueprintRel,
	findEntry,
} from "#/core/upstream/registry.js";
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

// Upstream file fetches per scope run; see ADR 0004 and 0013.
export const UPSTREAM_FETCH_CONCURRENCY = 16;

export function rawUrl(id: string, ref: string, relPath: string): string {
	assertRepoId(id, "pin");
	assertRef(ref, "pin");
	return `https://raw.githubusercontent.com/${id}/${ref}/${encodePathSegments(relPath)}`;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// `status` is the HTTP status, or undefined for a network/timeout failure.
export class FetchError extends Error {
	status: number | undefined;

	constructor(message: string, status: number | undefined, options?: ErrorOptions) {
		super(message, options);
		this.status = status;
	}
}

// Follows redirects by hand so GITHUB_TOKEN is only ever sent to the origin it was meant for.
export async function fetchOkResponse(url: string, label: string): Promise<Response> {
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
			throw new FetchError(`Cannot fetch ${label}: ${errorMessage(error)}`, undefined, {
				cause: error,
			});
		}
		const location = response.headers.get("location");
		if (REDIRECT_STATUSES.has(response.status) && location !== null) {
			current = new URL(location, current).toString();
			continue;
		}
		if (response.status === 404) {
			throw new FetchError(`${label} not found (${url}): HTTP 404.`, 404);
		}
		if (response.status === 401 || response.status === 403) {
			throw new FetchError(
				`${label} refused (${url}): HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN).`,
				response.status,
			);
		}
		if (!response.ok) {
			throw new FetchError(
				`${label} fetch failed (${url}): HTTP ${response.status}.`,
				response.status,
			);
		}
		return response;
	}
	// Plain Error: a redirect loop is not worth retrying.
	throw new Error(`${label} fetch failed (${url}): too many redirects.`);
}

export function isNotFoundError(error: unknown): boolean {
	return error instanceof FetchError && error.status === 404;
}

function isFetchRetryable(error: unknown): boolean {
	return (
		error instanceof FetchError &&
		(error.status === undefined || error.status === 429 || error.status >= 500)
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

// JSONC is a superset of JSON, so every upstream document parses the same way.
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
	const parsed = await fetchJsonc(rawUrl(id, ref, "registry.json"), "tech-stack registry");
	return parseOrThrow(RegistrySchema, "registry.json (remote)", parsed, "tech-stack registry");
}

// Registry lookup, fetch and schema parse for one scope's blueprint file.
export async function fetchBlueprint<K extends BlueprintKind>(
	state: Pick<RunState, "blueprint" | "id" | "ref">,
	registry: RegistryDocument,
	kind: K,
): Promise<{ data: BlueprintData<K>; rel: string }> {
	const { label, plural } = blueprintLabels(kind);
	const entry = findEntry(registry, kind, state.blueprint);
	if (entry === undefined) {
		const hint = availableHint(blueprintNames(registry, kind), plural);
		throw new Error(`${label} "${state.blueprint}" not found in the tech-stack registry.${hint}`);
	}
	const rel = blueprintRel(entry.path);
	const parsed = await fetchJsonc(rawUrl(state.id, state.ref, rel), `${label} ${state.blueprint}`);
	return { data: parseBlueprint(kind, parsed, `${rel} (remote)`), rel };
}

import type { TechStackReader } from "#/core/upstream/tech-stack.js";
import { UpstreamMissingError } from "#/core/upstream/tech-stack.js";
import { errorMessage } from "#/utils/error.js";
import {
	FETCH_TIMEOUT_MS,
	assertRef,
	assertRepoId,
	authHeaders,
	encodePathSegments,
	userAgentHeaders,
	withRetry,
} from "#/utils/net.js";

// Upstream file fetches per scope run; see ADR 0004 and 0013.
export const UPSTREAM_FETCH_CONCURRENCY = 16;

function rawUrl(id: string, ref: string, relPath: string): string {
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

function isFetchRetryable(error: unknown): boolean {
	return (
		error instanceof FetchError &&
		(error.status === undefined || error.status === 429 || error.status >= 500)
	);
}

function fetchTextOrThrow(url: string, label: string): Promise<string> {
	return withRetry(async () => (await fetchOkResponse(url, label)).text(), isFetchRetryable);
}

// Byte-exact fetch for binary-safe reads (validate existence checks).
function fetchBytesOrThrow(url: string, label: string): Promise<Uint8Array> {
	return withRetry(
		async () => new Uint8Array(await (await fetchOkResponse(url, label)).arrayBuffer()),
		isFetchRetryable,
	);
}

async function readPinned<T>(fetchRel: () => Promise<T>, rel: string): Promise<T> {
	try {
		return await fetchRel();
	} catch (error) {
		if (error instanceof FetchError && error.status === 404) {
			throw new UpstreamMissingError(error.message, "file", rel, { cause: error });
		}
		throw error;
	}
}

// The pinned tech-stack repo over HTTPS (`check`/`fix`); a 404 is a missing file.
export function pinnedReader(id: string, ref: string): TechStackReader {
	return {
		bytes: (rel, label) => readPinned(() => fetchBytesOrThrow(rawUrl(id, ref, rel), label), rel),
		text: (rel, label) => readPinned(() => fetchTextOrThrow(rawUrl(id, ref, rel), label), rel),
		where: (rel) => `${rel} (remote)`,
	};
}

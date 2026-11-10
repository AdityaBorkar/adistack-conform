import { errorMessage } from "#/utils/fs.js";
import { FETCH_TIMEOUT_MS, apiHeaders, assertRepoId, githubToken, withRetry } from "#/utils/net.js";
import type { GithubApiFix } from "#/utils/result.js";

const GITHUB_API = "https://api.github.com";

export class ApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export function isAuthError(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function isRetryable(error: unknown): boolean {
	if (error instanceof ApiError) {
		return error.status === 429 || error.status >= 500;
	}
	// Network/timeout errors from fetch: retry.
	return error instanceof Error;
}

function githubApiError(method: string, path: string, status: number, excerpt: string): ApiError {
	if (status === 401 || status === 403) {
		return new ApiError(
			status,
			`GitHub API refused ${method} ${path}: HTTP ${status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
		);
	}
	return new ApiError(status, `GitHub API ${method} ${path} failed: HTTP ${status}. ${excerpt}`);
}

async function githubFetch(path: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(`${GITHUB_API}${path}`, {
			...init,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`Cannot reach GitHub API ${init.method ?? "GET"} ${path}: ${errorMessage(error)}`,
			{ cause: error },
		);
	}
}

async function readJsonBody(response: Response, method: string, path: string): Promise<unknown> {
	if (response.status === 204) {
		return;
	}
	const text = await response.text();
	if (text === "") {
		return;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`GitHub API ${method} ${path} returned invalid JSON (HTTP ${response.status}): ${errorMessage(error)}`,
			{ cause: error },
		);
	}
}

export function apiJson(
	path: string,
	options: { allowStatuses?: readonly number[]; body?: unknown; method?: string } = {},
): Promise<unknown> {
	return withRetry(async () => {
		const method = options.method ?? "GET";
		const headers = apiHeaders();
		if (options.body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		const response = await githubFetch(path, {
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			headers,
			method,
		});
		if (options.allowStatuses?.includes(response.status) === true) {
			return;
		}
		if (!response.ok) {
			throw githubApiError(
				method,
				path,
				response.status,
				(await response.text().catch(() => "")).slice(0, 300),
			);
		}
		return readJsonBody(response, method, path);
	}, isRetryable);
}

async function fetchPage(
	current: string,
	collection: string | undefined,
): Promise<{ items: unknown[]; link: string }> {
	const response = await githubFetch(current, { headers: apiHeaders(), method: "GET" });
	if (!response.ok) {
		throw githubApiError(
			"GET",
			current,
			response.status,
			(await response.text().catch(() => "")).slice(0, 300),
		);
	}
	const parsed = (await readJsonBody(response, "GET", current)) ?? [];
	const items = collection === undefined ? parsed : (parsed as Record<string, unknown>)[collection];
	if (!Array.isArray(items)) {
		throw new TypeError(
			collection === undefined
				? `GitHub API GET ${current} returned no list.`
				: `GitHub API GET ${current} returned no "${collection}" collection.`,
		);
	}
	return { items, link: response.headers.get("link") ?? "" };
}

export async function apiJsonPaged(path: string, collection?: string): Promise<unknown[]> {
	const all: unknown[] = [];
	let next: string | undefined = path.includes("?") ? path : `${path}?per_page=100`;
	while (next !== undefined) {
		const current: string = next;
		const page = await withRetry(() => fetchPage(current, collection), isRetryable);
		all.push(...page.items);
		const nextUrl = /<([^>]+)>;\s*rel="next"/u.exec(page.link)?.[1];
		next =
			nextUrl !== undefined && nextUrl.startsWith(`${GITHUB_API}/`)
				? nextUrl.slice(GITHUB_API.length)
				: undefined;
		if (all.length > 1000) {
			throw new Error(
				`GitHub API GET ${path} returned more than 1000 items; refusing to truncate silently.`,
			);
		}
	}
	return all;
}

export async function apiEnabled(path: string): Promise<boolean> {
	const response = await githubFetch(path, { headers: apiHeaders(), method: "GET" });
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		throw githubApiError(
			"GET",
			path,
			response.status,
			(await response.text().catch(() => "")).slice(0, 300),
		);
	}
	return true;
}

export function repoPath(repo: string, rest: string): string {
	assertRepoId(repo, "GitHub check");
	return `/repos/${repo}${rest}`;
}

export async function applyGithubApiFix(fix: GithubApiFix): Promise<void> {
	if (githubToken() === undefined) {
		throw new Error(`Cannot apply ${fix.label}: set GITHUB_TOKEN with repo/admin scope.`);
	}
	for (const step of fix.steps) {
		await apiJson(step.path, { body: step.body, method: step.method });
	}
}

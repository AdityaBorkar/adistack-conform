import { errorMessage } from "#/utils/fs.js";
import { FETCH_TIMEOUT_MS, apiHeaders, githubToken } from "#/utils/net.js";
import type { GithubApiFix } from "#/utils/result.js";

const GITHUB_API = "https://api.github.com";

export class ApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export async function apiJson(
	path: string,
	options: { allowStatuses?: readonly number[]; body?: unknown; method?: string } = {},
): Promise<unknown> {
	const method = options.method ?? "GET";
	const headers = apiHeaders();
	if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	let response: Response;
	try {
		response = await fetch(`${GITHUB_API}${path}`, {
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			headers,
			method,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Cannot reach GitHub API ${method} ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	if (options.allowStatuses?.includes(response.status) === true) {
		return undefined;
	}
	if (!response.ok) {
		const excerpt = (await response.text().catch(() => "")).slice(0, 300);
		if (response.status === 401 || response.status === 403) {
			throw new ApiError(
				response.status,
				`GitHub API refused ${method} ${path}: HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
			);
		}
		throw new ApiError(
			response.status,
			`GitHub API ${method} ${path} failed: HTTP ${response.status}. ${excerpt}`,
		);
	}
	if (response.status === 204) {
		return undefined;
	}
	const text = await response.text();
	if (text === "") {
		return undefined;
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

export async function apiJsonPaged(path: string): Promise<unknown[]> {
	const all: unknown[] = [];
	let next: string | undefined = path.includes("?") ? path : `${path}?per_page=100`;
	while (next !== undefined) {
		const headers = apiHeaders();
		let response: Response;
		try {
			response = await fetch(`${GITHUB_API}${next}`, {
				headers,
				method: "GET",
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch (error) {
			throw new Error(`Cannot reach GitHub API GET ${next}: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		if (!response.ok) {
			const excerpt = (await response.text().catch(() => "")).slice(0, 300);
			if (response.status === 401 || response.status === 403) {
				throw new ApiError(
					response.status,
					`GitHub API refused GET ${next}: HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
				);
			}
			throw new ApiError(
				response.status,
				`GitHub API GET ${next} failed: HTTP ${response.status}. ${excerpt}`,
			);
		}
		const text = await response.text();
		let parsed: unknown = [];
		try {
			parsed = text === "" ? [] : (JSON.parse(text) as unknown);
		} catch (error) {
			throw new Error(`GitHub API GET ${next} returned invalid JSON: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		const items = Array.isArray(parsed)
			? parsed
			: ((parsed as { environments?: unknown[]; secrets?: unknown[]; variables?: unknown[] })
					.environments ??
				(parsed as { secrets?: unknown[] }).secrets ??
				(parsed as { variables?: unknown[] }).variables ??
				[]);
		all.push(...(items as unknown[]));
		const link = response.headers.get("link") ?? "";
		const match = /<([^>]+)>;\s*rel="next"/u.exec(link);
		next = match?.[1]?.startsWith(GITHUB_API) ? match[1].slice(GITHUB_API.length) : match?.[1];
		if (all.length > 1000) {
			break;
		}
	}
	return all;
}

export async function apiEnabled(path: string): Promise<boolean> {
	const headers = apiHeaders();
	let response: Response;
	try {
		response = await fetch(`${GITHUB_API}${path}`, {
			headers,
			method: "GET",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Cannot reach GitHub API GET ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		const excerpt = (await response.text().catch(() => "")).slice(0, 300);
		if (response.status === 401 || response.status === 403) {
			throw new ApiError(
				response.status,
				`GitHub API refused GET ${path}: HTTP ${response.status} (private repo or rate limit — set GITHUB_TOKEN). ${excerpt}`,
			);
		}
		throw new ApiError(
			response.status,
			`GitHub API GET ${path} failed: HTTP ${response.status}. ${excerpt}`,
		);
	}
	return true;
}

export function repoPath(repo: string, rest: string): string {
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

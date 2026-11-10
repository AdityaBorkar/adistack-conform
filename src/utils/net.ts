export const FETCH_TIMEOUT_MS = 30_000;

export const RETRY_MAX_ATTEMPTS = 3;

export function retryDelayMs(attempt: number): number {
	return 500 * 2 ** attempt;
}

export async function withRetry<T>(
	task: () => Promise<T>,
	isRetryable: (error: unknown) => boolean = () => true,
): Promise<T> {
	let error: unknown;
	for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt += 1) {
		try {
			return await task();
		} catch (taskError) {
			error = taskError;
			if (!isRetryable(taskError) || attempt === RETRY_MAX_ATTEMPTS - 1) {
				throw taskError;
			}
			await Bun.sleep(retryDelayMs(attempt));
		}
	}
	throw error;
}

export function githubToken(): string | undefined {
	const token = process.env["GITHUB_TOKEN"]?.trim();
	return token !== undefined && token !== "" ? token : undefined;
}

export function userAgentHeaders(): Record<string, string> {
	return { "User-Agent": "adistack-conform" };
}

export function authHeaders(): Record<string, string> {
	const headers = userAgentHeaders();
	const token = githubToken();
	if (token !== undefined) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	return headers;
}

export function apiHeaders(): Record<string, string> {
	return {
		...authHeaders(),
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

export function encodePathSegments(relPath: string): string {
	const trimmed = relPath.startsWith("./") ? relPath.slice(2) : relPath;
	return trimmed
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function assertRepoId(id: string, label: string): void {
	if (!REPO_PATTERN.test(id)) {
		throw new Error(`Invalid repo "${id}" for ${label}: expected owner/repo.`);
	}
}

export function assertRef(ref: string, label: string): void {
	if (ref === "" || ref.includes("?") || ref.includes("#") || ref.includes("\\")) {
		throw new Error(`Invalid ref "${ref}" for ${label}.`);
	}
}

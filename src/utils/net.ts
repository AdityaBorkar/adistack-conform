import pRetry from "p-retry";

export const FETCH_TIMEOUT_MS = 30_000;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_MIN_TIMEOUT_MS = 500;

export function withRetry<T>(
	task: () => Promise<T>,
	isRetryable: (error: unknown) => boolean = () => true,
): Promise<T> {
	return pRetry(task, {
		factor: 2,
		minTimeout: RETRY_MIN_TIMEOUT_MS,
		retries: RETRY_MAX_ATTEMPTS - 1,
		shouldRetry: ({ error }) => isRetryable(error),
	});
}

let ghToken: string | undefined | null = null;

// `gh auth token`, run at most once per process; undefined when gh is missing or logged out.
function ghAuthToken(): string | undefined {
	if (ghToken === null) {
		try {
			const proc = Bun.spawnSync(["gh", "auth", "token"], {
				stderr: "ignore",
				stdin: "ignore",
				timeout: 5000,
			});
			const out = proc.success ? proc.stdout.toString().trim() : "";
			ghToken = out === "" ? undefined : out;
		} catch {
			ghToken = undefined;
		}
	}
	return ghToken;
}

// GITHUB_TOKEN wins; otherwise fall back to the gh CLI login.
export function githubToken(): string | undefined {
	const token = process.env["GITHUB_TOKEN"]?.trim();
	return token !== undefined && token !== "" ? token : ghAuthToken();
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

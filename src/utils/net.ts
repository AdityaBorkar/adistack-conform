export const FETCH_TIMEOUT_MS = 30_000;

export function githubToken(): string | undefined {
	const token = process.env["GITHUB_TOKEN"];
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

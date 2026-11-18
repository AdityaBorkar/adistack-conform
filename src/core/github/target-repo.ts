import { assertRepoId } from "#/utils/net.js";

function parseRepoSlug(text: string): string | undefined {
	const cleaned = text
		.trim()
		.replace(/\.git$/u, "")
		.replace(/\/+$/u, "");
	const withPath = /github\.com(?::\d+)?[/:]([^/\s?#]+\/[^/\s?#]+?)(?:[/?#].*)?$/iu.exec(cleaned);
	if (withPath?.[1] !== undefined) {
		return withPath[1];
	}
	const bare = /^([^/\s?#]+\/[^/\s?#]+)$/u.exec(cleaned);
	return bare?.[1];
}

// Which repo the github scope inspects: conform.json `github.repo`, then
// $GITHUB_REPOSITORY (CI), then the local `origin` remote.
export function resolveTargetRepo(configured: string | undefined): string {
	let repo: string;
	if (configured !== undefined && configured !== "") {
		repo = configured;
	} else {
		const fromEnv = process.env["GITHUB_REPOSITORY"];
		if (fromEnv !== undefined && fromEnv !== "") {
			repo = fromEnv;
		} else {
			let slug: string | undefined;
			try {
				const proc = Bun.spawnSync(["git", "remote", "get-url", "origin"]);
				if (proc.exitCode === 0) {
					slug = parseRepoSlug(new TextDecoder().decode(proc.stdout as Uint8Array));
				}
			} catch {
				// Fall through to the error below.
			}
			if (slug === undefined) {
				throw new Error(
					"Cannot determine the GitHub repo to check: set github.repo in conform.json or $GITHUB_REPOSITORY.",
				);
			}
			repo = slug;
		}
	}
	assertRepoId(repo, "GitHub check");
	return repo;
}

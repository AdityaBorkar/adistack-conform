import { join } from "node:path";

import envPaths from "env-paths";

import { ensureDir, errorMessage, moveOverwrite, pathExists, removePath } from "#/utils/fs.js";

export interface CachedRepo {
	dir: string;
	stale: boolean;
	warning?: string;
}

const FETCH_TIMEOUT_MS = 30_000;

const inflight = new Map<string, Promise<CachedRepo>>();

function safeRef(ref: string): string {
	const safe = ref.replaceAll(/[^A-Za-z0-9._-]+/gu, "_");
	if (safe === "" || safe === "." || safe === "..") {
		throw new Error(`Unsafe tech-stack ref: “${ref}”.`);
	}
	return safe;
}

// Bump when the consumed tech-stack layout changes, so caches holding the
// previous layout are re-downloaded instead of failing to parse.
const CACHE_VERSION = "v2";

function cachePaths(spec: { id: string; ref: string }): { dir: string; metaPath: string } {
	const parts = spec.id.split("/");
	const owner = parts[0];
	const repo = parts[1];
	if (
		owner === undefined ||
		owner === "" ||
		repo === undefined ||
		repo === "" ||
		parts.length !== 2
	) {
		throw new Error(`Invalid tech-stack id: “${spec.id}” (expected "owner/repo").`);
	}
	const dir = join(
		envPaths("adistack-conform", { suffix: "" }).cache,
		"github",
		owner,
		repo,
		safeRef(spec.ref) + CACHE_VERSION,
	);
	return { dir, metaPath: join(dir, ".conform-meta.json") };
}

async function downloadTarball(id: string, ref: string, tmpPath: string): Promise<void> {
	const headers: Record<string, string> = { "User-Agent": "adistack-conform" };
	const token = process.env["GITHUB_TOKEN"];
	if (token !== undefined && token !== "") {
		headers["Authorization"] = `Bearer ${token}`;
	}
	let response: Response;
	try {
		response = await fetch(`https://codeload.github.com/${id}/tar.gz/${ref}`, {
			headers,
			redirect: "follow",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Cannot download tech-stack ${id}@${ref}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(
				`tech-stack ${id}@${ref} not found on GitHub (check techStack.id/ref, or set GITHUB_TOKEN for a private repo).`,
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`GitHub refused tech-stack ${id}@${ref} (HTTP ${response.status}; private repo or rate limit — set GITHUB_TOKEN).`,
			);
		}
		throw new Error(`GitHub download failed for tech-stack ${id}@${ref}: HTTP ${response.status}.`);
	}
	await Bun.write(tmpPath, response);
}

async function extractTarball(archive: string, dest: string): Promise<void> {
	const { x: tarExtract } = await import("tar");
	await tarExtract({ cwd: dest, file: archive, strip: 1 });
}

function scratchPaths(dir: string): { stage: string; tmpArchive: string } {
	const nonce = `${process.pid}.${Math.random().toString(36).slice(2)}`;
	return { stage: `${dir}.stage.${nonce}`, tmpArchive: `${dir}.tarball.${nonce}` };
}

async function fetchAndInstall(
	spec: { id: string; ref: string },
	dir: string,
	metaPath: string,
): Promise<CachedRepo> {
	const { stage, tmpArchive } = scratchPaths(dir);
	try {
		await downloadTarball(spec.id, spec.ref, tmpArchive);
		await removePath(stage);
		await ensureDir(stage);
		await extractTarball(tmpArchive, stage);
		await ensureDir(join(dir, ".."));
		await moveOverwrite(stage, dir);
		await Bun.write(
			metaPath,
			`${JSON.stringify({ fetchedAt: new Date().toISOString(), id: spec.id, ref: spec.ref }, null, 2)}\n`,
		);
		return { dir, stale: false };
	} catch (error) {
		if (await pathExists(metaPath)) {
			return { dir, stale: true, warning: errorMessage(error) };
		}
		throw error;
	} finally {
		await Promise.allSettled([removePath(tmpArchive), removePath(stage)]);
	}
}

export async function ensureGithubRepo(
	spec: { id: string; ref: string },
	noCache: boolean,
): Promise<CachedRepo> {
	const { dir, metaPath } = cachePaths(spec);
	if (!noCache && (await pathExists(metaPath))) {
		try {
			const meta = (await Bun.file(metaPath).json()) as { id?: unknown; ref?: unknown };
			if (meta.id === spec.id && meta.ref === spec.ref) {
				return { dir, stale: false };
			}
		} catch {
			// Corrupt marker — fall through to re-download.
		}
	}
	const key = `${spec.id}@${spec.ref}`;
	const pending = inflight.get(key);
	if (pending !== undefined) {
		return pending;
	}
	const task = fetchAndInstall(spec, dir, metaPath).finally(() => {
		if (inflight.get(key) === task) {
			inflight.delete(key);
		}
	});
	inflight.set(key, task);
	return task;
}

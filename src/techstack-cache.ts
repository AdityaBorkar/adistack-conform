import { join } from "node:path";

import envPaths from "env-paths";
import { ensureDir, move, pathExists, remove } from "fs-extra";
import { x as tarExtract } from "tar";

import type { TechStackSpec } from "#/config.js";

export interface CachedRepo {
	dir: string;
	stale: boolean;
	warning?: string;
}

const FETCH_TIMEOUT_MS = 30_000;

function safeRef(ref: string): string {
	const safe = ref.replaceAll(/[^A-Za-z0-9._-]+/gu, "_");
	if (safe === "" || safe === "." || safe === "..") {
		throw new Error(`Unsafe tech-stack ref: “${ref}”.`);
	}
	return safe;
}

function cacheDirFor(owner: string, repo: string, ref: string): string {
	return join(
		envPaths("adistack-conform", { suffix: "" }).cache,
		"github",
		owner,
		repo,
		safeRef(ref),
	);
}

function splitId(id: string): { owner: string; repo: string } {
	const parts = id.split("/");
	const owner = parts[0];
	const repo = parts[1];
	if (
		owner === undefined ||
		owner === "" ||
		repo === undefined ||
		repo === "" ||
		parts.length !== 2
	) {
		throw new Error(`Invalid tech-stack id: “${id}” (expected "owner/repo").`);
	}
	return { owner, repo };
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
		throw new Error(
			`Cannot download tech-stack ${id}@${ref}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
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
	await tarExtract({ cwd: dest, file: archive, strip: 1 });
}

export async function ensureGithubRepo(spec: TechStackSpec, noCache: boolean): Promise<CachedRepo> {
	const { owner, repo } = splitId(spec.id);
	const dir = cacheDirFor(owner, repo, spec.ref);
	const metaPath = join(dir, ".conform-meta.json");
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
	const tmpArchive = `${dir}.tarball`;
	const stage = `${dir}.stage`;
	try {
		await downloadTarball(spec.id, spec.ref, tmpArchive);
		await remove(stage);
		await ensureDir(stage);
		await extractTarball(tmpArchive, stage);
		await ensureDir(join(dir, ".."));
		await move(stage, dir, { overwrite: true });
		await Bun.write(
			metaPath,
			`${JSON.stringify({ fetchedAt: new Date().toISOString(), id: spec.id, ref: spec.ref }, null, 2)}\n`,
		);
		return { dir, stale: false };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (await pathExists(metaPath)) {
			return { dir, stale: true, warning: detail };
		}
		throw error;
	} finally {
		await Promise.all([remove(tmpArchive), remove(stage)]);
	}
}

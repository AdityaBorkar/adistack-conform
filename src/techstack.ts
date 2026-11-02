import { join } from "node:path";

import envPaths from "env-paths";
import { difference, union } from "es-toolkit";
import { ensureDir, move, pathExists, remove } from "fs-extra";
import { x as tarExtract } from "tar";
import { glob } from "tinyglobby";
import * as z from "zod";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { resolveTargetPath } from "#/config.js";
import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { RegistrySchema } from "#/schemas/registry.js";

interface PresetPackage {
	files: { name: string; path: string; target: string }[];
	name: string;
	reference: string;
}

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	noCache: boolean;
	scope: CheckScope;
}

export interface CachedRepo {
	dir: string;
	stale: boolean;
}

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
	return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
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
	await Bun.write(tmpPath, await response.arrayBuffer());
}

async function extractTarball(archive: string, dest: string): Promise<void> {
	await tarExtract({ cwd: dest, file: archive, strip: 1 });
}

async function ensureGithubRepo(spec: TechStackSpec, noCache: boolean): Promise<CachedRepo> {
	const { owner, repo } = splitId(spec.id);
	const dir = cacheDirFor(owner, repo, spec.ref);
	const metaPath = join(dir, ".conform-meta.json");
	if (!noCache && (await pathExists(metaPath))) {
		try {
			const meta = (await Bun.file(metaPath).json()) as { id?: unknown; ref?: unknown };
			if (meta["id"] === spec.id && meta["ref"] === spec.ref) {
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
		await remove(dir);
		await ensureDir(join(dir, ".."));
		await move(stage, dir);
		await Bun.write(
			metaPath,
			`${JSON.stringify({ fetchedAt: new Date().toISOString(), id: spec.id, ref: spec.ref }, null, 2)}\n`,
		);
		return { dir, stale: false };
	} catch (error) {
		if (await pathExists(metaPath)) {
			console.warn(
				`Warning: using cached tech-stack ${spec.id}@${spec.ref} (${error instanceof Error ? error.message : String(error)})`,
			);
			return { dir, stale: true };
		}
		throw error;
	} finally {
		await remove(tmpArchive);
		await remove(stage);
	}
}

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function loadRegistryDocument(repoRoot: string): Promise<z.infer<typeof RegistrySchema>> {
	const path = join(repoRoot, "registry.json");
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`tech-stack registry not found: ${path}`);
	}
	let parsed: unknown;
	try {
		parsed = await file.json();
	} catch (error) {
		throw new Error(`Invalid tech-stack registry in ${path}`, { cause: error });
	}
	const result = RegistrySchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid tech-stack registry in ${path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

async function loadRegistry(
	repoRoot: string,
	scope: CheckScope,
): Promise<Map<string, PresetPackage>> {
	const registry = await loadRegistryDocument(repoRoot);
	const schema = scope === "project" ? ProjectPresetManifestSchema : MachinePresetManifestSchema;
	const manifests = await Promise.all(
		registry[scope].presets.map(async (dir) => {
			const manifestPath = join(repoRoot, dir, "manifest.json");
			const manifestFile = Bun.file(manifestPath);
			if (!(await manifestFile.exists())) {
				throw new Error(`tech-stack preset manifest not found: ${manifestPath}`);
			}
			try {
				return { manifestPath, parsed: (await manifestFile.json()) as unknown };
			} catch (error) {
				throw new Error(`Invalid tech-stack preset manifest in ${manifestPath}`, { cause: error });
			}
		}),
	);
	const byName = new Map<string, PresetPackage>();
	for (const { manifestPath, parsed } of manifests) {
		const manifest = schema.safeParse(parsed);
		if (!manifest.success) {
			throw new Error(
				`Invalid tech-stack preset manifest in ${manifestPath}:\n${z.prettifyError(manifest.error)}`,
			);
		}
		for (const pkg of manifest.data.packages) {
			if (!byName.has(pkg.name)) {
				byName.set(pkg.name, pkg);
			}
		}
	}
	return byName;
}

async function listBlueprints(repoRoot: string, scope: CheckScope): Promise<string[]> {
	const registry = await loadRegistryDocument(repoRoot);
	const matches = await Promise.all(
		registry[scope].blueprints.map((dir) => glob("*/manifest.json", { cwd: join(repoRoot, dir) })),
	);
	const names = new Set<string>();
	for (const entries of matches) {
		for (const entry of entries) {
			names.add(entry.slice(0, -"/manifest.json".length));
		}
	}
	return [...names].toSorted();
}

async function loadBlueprint(
	repoRoot: string,
	scope: CheckScope,
	name: string,
): Promise<{ exclude: string[]; presets: string[] }> {
	const registry = await loadRegistryDocument(repoRoot);
	const schema = scope === "project" ? ProjectBlueprintSchema : MachineBlueprintSchema;
	const candidates = await Promise.all(
		registry[scope].blueprints.map(async (dir) => ({
			exists: await Bun.file(join(repoRoot, dir, name, "manifest.json")).exists(),
			path: join(repoRoot, dir, name, "manifest.json"),
		})),
	);
	const hit = candidates.find((candidate) => candidate.exists);
	if (hit === undefined) {
		const available = await listBlueprints(repoRoot, scope);
		const hint = available.length > 0 ? ` Available blueprints: ${available.join(", ")}.` : "";
		throw new Error(`Blueprint "${name}" not found in the tech-stack repo.${hint}`);
	}
	let parsed: unknown;
	try {
		parsed = await Bun.file(hit.path).json();
	} catch (error) {
		throw new Error(`Invalid blueprint in ${hit.path}`, { cause: error });
	}
	const result = schema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid blueprint in ${hit.path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

type ClassifiedTarget = { reason: string; type: "skip" } | { path: string; type: "path" };

function classifyTarget(target: string, scope: CheckScope): ClassifiedTarget {
	if (target.startsWith("docs:")) {
		return { reason: "docs-only, nothing to enforce", type: "skip" };
	}
	const [token = ""] = target.split(/\s/u);
	if (token === "~" || token.startsWith("~/") || token.startsWith("/")) {
		return { path: token, type: "path" };
	}
	if (target.includes("%")) {
		return { reason: "Windows-only target", type: "skip" };
	}
	if (scope === "project" && (token.startsWith("./") || token.startsWith("../"))) {
		return { path: token, type: "path" };
	}
	return { reason: `no concrete target ("${target}")`, type: "skip" };
}

async function checkPresetFile(
	packageName: string,
	presetRelPath: string,
	presetFileName: string,
	presetTarget: string,
	repoRoot: string,
	targetPath: string,
	scope: CheckScope,
): Promise<CheckResult> {
	const base = {
		id: `preset:${packageName}:${presetFileName}`,
		kind: "preset",
		scope,
		source: `tech-stack:${packageName}`,
		target: presetTarget,
	} as const;
	const presetPath = join(repoRoot, presetRelPath);
	const presetFile = Bun.file(presetPath);
	if (!(await presetFile.exists())) {
		return {
			...base,
			actual: "<preset file missing>",
			expected: presetRelPath,
			fixable: false,
			hint: `Preset file missing in tech-stack repo: ${presetPath}`,
			ok: false,
		};
	}
	if (presetRelPath.endsWith(".example") || presetFileName.endsWith(".example")) {
		const targetFile = Bun.file(targetPath);
		if (await targetFile.exists()) {
			return {
				...base,
				actual: "exists",
				expected: "exists (values stay secret)",
				fixable: false,
				ok: true,
			};
		}
		return {
			...base,
			actual: "<missing>",
			expected: "exists (values stay secret)",
			fixable: false,
			hint: `Copy ${presetRelPath} to ${targetPath} and fill in secret values (never commit).`,
			ok: false,
		};
	}
	let golden: string;
	try {
		golden = await presetFile.text();
	} catch (error) {
		return {
			...base,
			actual: "<unreadable preset>",
			expected: presetRelPath,
			fixable: false,
			hint: error instanceof Error ? error.message : String(error),
			ok: false,
		};
	}
	const targetFile = Bun.file(targetPath);
	if (golden.trim() === "" && !(await targetFile.exists())) {
		return {
			...base,
			actual: "defaults (empty preset)",
			expected: "absent (empty preset = defaults)",
			fixable: false,
			ok: true,
		};
	}
	let actual: string;
	try {
		if (await targetFile.exists()) {
			actual = await targetFile.text();
		} else {
			actual = "<missing>";
		}
	} catch (error) {
		return {
			...base,
			actual: "<unreadable>",
			expected: short(golden),
			fixable: false,
			hint: `Cannot read ${targetPath} (may need sudo): ${error instanceof Error ? error.message : String(error)}`,
			ok: false,
		};
	}
	if (actual === golden) {
		return { ...base, actual: "matches preset", expected: short(golden), fixable: false, ok: true };
	}
	return {
		...base,
		actual: short(actual),
		expected: short(golden),
		fix: { filePath: targetPath, kind: "overwrite-file", newContent: golden },
		fixable: true,
		ok: false,
	};
}

export async function runTechStackChecks(
	spec: TechStackSpec,
	options: TechStackRunOptions,
): Promise<CheckResult[]> {
	const repoRoot = (await ensureGithubRepo(spec, options.noCache)).dir;
	const registry = await loadRegistry(repoRoot, options.scope);
	let blueprintPresets: string[] = [];
	let blueprintExcludes: string[] = [];
	if (spec.blueprint !== undefined) {
		const blueprint = await loadBlueprint(repoRoot, options.scope, spec.blueprint);
		blueprintExcludes = blueprint.exclude;
		blueprintPresets = blueprint.presets;
	}
	const wanted = union(blueprintPresets, spec.presets);
	const names = difference(wanted, [...blueprintExcludes, ...spec.exclude]).toSorted();
	const unknown = names.filter((name) => !registry.has(name));
	if (unknown.length > 0) {
		throw new Error(
			`Unknown tech-stack preset(s): ${unknown.join(", ")}. Available: ${[...registry.keys()].toSorted().join(", ")}.`,
		);
	}
	const jobs: Promise<CheckResult>[] = [];
	for (const name of names) {
		const pkg = registry.get(name) as PresetPackage;
		for (const file of pkg.files) {
			const classified = classifyTarget(file.target, options.scope);
			if (classified.type === "skip") {
				jobs.push(
					Promise.resolve({
						actual: classified.reason,
						expected: file.path,
						fixable: false,
						id: `preset:${name}:${file.name}`,
						kind: "preset",
						ok: true,
						scope: options.scope,
						skipped: true,
						source: `tech-stack:${name}`,
						target: file.target,
					}),
				);
				continue;
			}
			const targetPath = resolveTargetPath(classified.path, options.baseDir, options.home);
			jobs.push(
				checkPresetFile(
					name,
					file.path,
					file.name,
					file.target,
					repoRoot,
					targetPath,
					options.scope,
				),
			);
		}
	}
	return Promise.all(jobs);
}

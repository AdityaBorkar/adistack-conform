import { readdir } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import type { CheckResult } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { resolveTargetPath } from "#/config.js";

const RegistryFileSchema = z.object({
	name: z.string(),
	path: z.string().min(1),
	target: z.string().min(1),
});

const RegistryPackageSchema = z.object({
	files: z.array(RegistryFileSchema),
	name: z.string().min(1),
	reference: z.string().min(1),
});

const RegistrySchema = z.object({
	packages: z.array(RegistryPackageSchema),
});

const BlueprintSchema = z.object({
	description: z.string().optional(),
	exclude: z.array(z.string().min(1)).default([]),
	name: z.string().min(1).optional(),
	presets: z.array(z.string().min(1)),
});

export interface TechStackRunOptions {
	configDir: string;
	cwd: string;
	home: string;
}

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function loadRegistry(
	repoRoot: string,
): Promise<Map<string, z.infer<typeof RegistryPackageSchema>>> {
	const path = join(repoRoot, "machines", "presets", "registry.json");
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
	const byName = new Map<string, z.infer<typeof RegistryPackageSchema>>();
	for (const pkg of result.data.packages) {
		byName.set(pkg.name, pkg);
	}
	return byName;
}

async function listBlueprints(repoRoot: string): Promise<string[]> {
	const dir = join(repoRoot, "machines", "blueprints");
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		entries = [];
	}
	return entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => entry.slice(0, -".json".length))
		.toSorted();
}

async function loadBlueprint(
	repoRoot: string,
	name: string,
): Promise<z.infer<typeof BlueprintSchema>> {
	const candidates = [
		join(repoRoot, "machines", "blueprints", `${name}.json`),
		join(repoRoot, "machines", "blueprints", name, "blueprint.json"),
	];
	const found = await Promise.all(
		candidates.map(async (path) => ({ exists: await Bun.file(path).exists(), path })),
	);
	const hit = found.find((item) => item.exists);
	if (hit !== undefined) {
		let parsed: unknown;
		try {
			parsed = await Bun.file(hit.path).json();
		} catch (error) {
			throw new Error(`Invalid blueprint in ${hit.path}`, { cause: error });
		}
		const result = BlueprintSchema.safeParse(parsed);
		if (!result.success) {
			throw new Error(`Invalid blueprint in ${hit.path}:\n${z.prettifyError(result.error)}`);
		}
		return result.data;
	}
	const available = await listBlueprints(repoRoot);
	const hint = available.length > 0 ? ` Available blueprints: ${available.join(", ")}.` : "";
	throw new Error(`Blueprint "${name}" not found in ${repoRoot}/machines/blueprints.${hint}`);
}

type ClassifiedTarget = { reason: string; type: "skip" } | { path: string; type: "path" };

function classifyTarget(target: string): ClassifiedTarget {
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
	return { reason: `no concrete target ("${target}")`, type: "skip" };
}

async function checkPresetFile(
	packageName: string,
	presetRelPath: string,
	presetFileName: string,
	presetTarget: string,
	repoRoot: string,
	targetPath: string,
	overwrite: boolean,
): Promise<CheckResult> {
	const base = {
		id: `preset:${packageName}:${presetFileName}`,
		kind: "preset",
		scope: "system",
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
	if (!overwrite) {
		return {
			...base,
			actual: short(actual),
			expected: short(golden),
			fixable: false,
			hint: `Sync from tech-stack preset: cp ${presetPath} ${targetPath}`,
			ok: false,
		};
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
	const repoRoot = resolveTargetPath(spec.repo, options.configDir, options.home);
	if (!(await Bun.file(join(repoRoot, "machines", "presets", "registry.json")).exists())) {
		throw new Error(
			`tech-stack repo not found at ${repoRoot} (pass --repo or set "repo" to the tech-stack checkout).`,
		);
	}
	const registry = await loadRegistry(repoRoot);
	let blueprintPresets: string[] = [];
	let blueprintExcludes: string[] = [];
	if (spec.blueprint !== undefined) {
		const blueprint = await loadBlueprint(repoRoot, spec.blueprint);
		blueprintExcludes = blueprint.exclude;
		blueprintPresets = blueprint.presets;
	}
	const wanted = [...blueprintPresets, ...spec.presets];
	const excluded = new Set([...blueprintExcludes, ...spec.exclude]);
	const names = [...new Set(wanted)].filter((name) => !excluded.has(name)).toSorted();
	const unknown = names.filter((name) => !registry.has(name));
	if (unknown.length > 0) {
		throw new Error(
			`Unknown tech-stack preset(s): ${unknown.join(", ")}. Available: ${[...registry.keys()].toSorted().join(", ")}.`,
		);
	}
	const jobs: Promise<CheckResult>[] = [];
	for (const name of names) {
		const pkg = registry.get(name) as z.infer<typeof RegistryPackageSchema>;
		for (const file of pkg.files) {
			const classified = classifyTarget(file.target);
			if (classified.type === "skip") {
				jobs.push(
					Promise.resolve({
						actual: classified.reason,
						expected: file.path,
						fixable: false,
						id: `preset:${name}:${file.name}`,
						kind: "preset",
						ok: true,
						scope: "system",
						skipped: true,
						source: `tech-stack:${name}`,
						target: file.target,
					}),
				);
				continue;
			}
			const targetPath = resolveTargetPath(classified.path, options.home, options.home);
			jobs.push(
				checkPresetFile(
					name,
					file.path,
					file.name,
					file.target,
					repoRoot,
					targetPath,
					spec.fix === "overwrite",
				),
			);
		}
	}
	return Promise.all(jobs);
}

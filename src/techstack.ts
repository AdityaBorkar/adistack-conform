import { difference, union } from "es-toolkit";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { resolveTargetPath } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import { checkPresetFile, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { PresetPackage } from "#/techstack-registry.js";
import { loadBlueprint, loadRegistry, loadRegistryDocument } from "#/techstack-registry.js";

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	noCache: boolean;
	scope: CheckScope;
}

export async function runTechStackChecks(
	spec: TechStackSpec,
	options: TechStackRunOptions,
): Promise<CheckResult[]> {
	const cached = await ensureGithubRepo(spec, options.noCache);
	if (cached.stale && cached.warning !== undefined) {
		console.warn(`Warning: using cached tech-stack ${spec.id}@${spec.ref} (${cached.warning})`);
	}
	const repoRoot = cached.dir;
	const registryDoc = await loadRegistryDocument(repoRoot);
	const registry = await loadRegistry(repoRoot, options.scope, registryDoc);
	let blueprintPresets: string[] = [];
	let blueprintExcludes: string[] = [];
	if (spec.blueprint !== undefined) {
		const blueprint = await loadBlueprint(repoRoot, options.scope, spec.blueprint, registryDoc);
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
					Promise.resolve(
						skippedForTarget(
							name,
							file.name,
							file.path,
							file.target,
							classified.reason,
							options.scope,
						),
					),
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

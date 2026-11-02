import { difference, union } from "es-toolkit";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import { checkPresetFile, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { PresetPackage, RegistryDocument } from "#/techstack-registry.js";
import {
	MAX_LIST_SHOWN,
	loadBlueprint,
	loadRegistry,
	loadRegistryDocument,
} from "#/techstack-registry.js";
import { resolveTargetPath } from "#/utils/fs.js";

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	noCache: boolean;
	scope: CheckScope;
}

export interface TechCheckOutput {
	results: CheckResult[];
	warnings: string[];
}

async function resolveWantedNames(
	spec: TechStackSpec,
	scope: CheckScope,
	repoRoot: string,
	registryDoc: RegistryDocument,
	registry: Map<string, PresetPackage>,
): Promise<string[]> {
	let blueprintPresets: string[] = [];
	let blueprintExcludes: string[] = [];
	if (spec.blueprint !== undefined) {
		const blueprint = await loadBlueprint(repoRoot, scope, spec.blueprint, registryDoc);
		blueprintExcludes = blueprint.exclude;
		blueprintPresets = blueprint.presets;
	}
	const wanted = union(blueprintPresets, spec.presets);
	const names = difference(wanted, [...blueprintExcludes, ...spec.exclude]).toSorted();
	const unknown = names.filter((name) => !registry.has(name));
	if (unknown.length > 0) {
		const shown = unknown.slice(0, MAX_LIST_SHOWN).join(", ");
		const suffix =
			unknown.length > MAX_LIST_SHOWN ? ` (+${unknown.length - MAX_LIST_SHOWN} more)` : "";
		const keys = [...registry.keys()].toSorted();
		const available =
			keys.length > MAX_LIST_SHOWN
				? `${keys.slice(0, MAX_LIST_SHOWN).join(", ")} (+${keys.length - MAX_LIST_SHOWN} more)`
				: keys.join(", ");
		throw new Error(`Unknown tech-stack preset(s): ${shown}${suffix}. Available: ${available}.`);
	}
	return names;
}

function collectJobs(
	registry: Map<string, PresetPackage>,
	names: string[],
	options: TechStackRunOptions,
	repoRoot: string,
): { jobs: Promise<CheckResult>[]; skips: CheckResult[] } {
	const jobs: Promise<CheckResult>[] = [];
	const skips: CheckResult[] = [];
	for (const name of names) {
		const pkg = registry.get(name);
		if (pkg === undefined) {
			throw new Error(`Preset "${name}" disappeared from the tech-stack registry.`);
		}
		for (const file of pkg.files) {
			const classified = classifyTarget(file.target, options.scope);
			if (classified.type === "skip") {
				skips.push(
					skippedForTarget(
						name,
						file.name,
						file.path,
						file.target,
						classified.reason,
						options.scope,
					),
				);
				continue;
			}
			const targetPath = resolveTargetPath(classified.path, options.baseDir, options.home);
			jobs.push(
				checkPresetFile({
					packageName: name,
					presetFileName: file.name,
					presetRelPath: file.path,
					presetTarget: file.target,
					repoRoot,
					scope: options.scope,
					targetPath,
				}),
			);
		}
	}
	return { jobs, skips };
}

export async function runTechStackChecks(
	spec: TechStackSpec,
	options: TechStackRunOptions,
): Promise<TechCheckOutput> {
	const cached = await ensureGithubRepo(spec, options.noCache);
	const warnings: string[] = [];
	if (cached.stale && cached.warning !== undefined) {
		warnings.push(`Warning: using cached tech-stack ${spec.id}@${spec.ref} (${cached.warning})`);
	}
	const repoRoot = cached.dir;
	const registryDoc = await loadRegistryDocument(repoRoot);
	const registry = await loadRegistry(repoRoot, options.scope, registryDoc);
	const names = await resolveWantedNames(spec, options.scope, repoRoot, registryDoc, registry);
	const { jobs, skips } = collectJobs(registry, names, options, repoRoot);
	return { results: [...skips, ...(await Promise.all(jobs))], warnings };
}

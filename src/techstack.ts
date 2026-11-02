import { difference, union } from "es-toolkit";

import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { resolveTargetPath } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import { checkPresetFile, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { RegistryDocument } from "#/techstack-registry.js";
import { loadBlueprint, loadRegistry, loadRegistryDocument } from "#/techstack-registry.js";

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	noCache: boolean;
	scope: CheckScope;
}

const MAX_UNKNOWN_SHOWN = 10;

async function resolveWantedNames(
	spec: TechStackSpec,
	scope: CheckScope,
	repoRoot: string,
	registryDoc: RegistryDocument,
	registryKeys: string[],
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
	const unknown = names.filter((name) => !registryKeys.includes(name));
	if (unknown.length > 0) {
		const shown = unknown.slice(0, MAX_UNKNOWN_SHOWN).join(", ");
		const suffix =
			unknown.length > MAX_UNKNOWN_SHOWN ? ` (+${unknown.length - MAX_UNKNOWN_SHOWN} more)` : "";
		const available =
			registryKeys.length > MAX_UNKNOWN_SHOWN
				? `${registryKeys.slice(0, MAX_UNKNOWN_SHOWN).join(", ")} (+${registryKeys.length - MAX_UNKNOWN_SHOWN} more)`
				: registryKeys.toSorted().join(", ");
		throw new Error(`Unknown tech-stack preset(s): ${shown}${suffix}. Available: ${available}.`);
	}
	return names;
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
	const names = await resolveWantedNames(spec, options.scope, repoRoot, registryDoc, [
		...registry.keys(),
	]);
	const skips: CheckResult[] = [];
	const jobs: Promise<CheckResult>[] = [];
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
	return [...skips, ...(await Promise.all(jobs))];
}

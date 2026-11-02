import type { CheckResult, CheckScope } from "#/checks.js";
import type { TechStackSpec } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import type { CheckFileArgs } from "#/techstack-check.js";
import { checkPresetFile, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { PresetPackage, RegistryDocument } from "#/techstack-registry.js";
import {
	MAX_LIST_SHOWN,
	loadBlueprint,
	loadRegistry,
	loadRegistryDocument,
} from "#/techstack-registry.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { resolveTargetPath } from "#/utils/fs.js";

export const CHECK_CONCURRENCY = 32;

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
	const wanted = new Set([...blueprintPresets, ...spec.presets]);
	for (const excluded of [...blueprintExcludes, ...spec.exclude]) {
		wanted.delete(excluded);
	}
	const names = [...wanted].toSorted();
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
): { skips: CheckResult[]; tasks: CheckFileArgs[] } {
	const tasks: CheckFileArgs[] = [];
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
			tasks.push({
				packageName: name,
				presetFileName: file.name,
				presetRelPath: file.path,
				presetTarget: file.target,
				repoRoot,
				scope: options.scope,
				targetPath,
			});
		}
	}
	return { skips, tasks };
}

export async function runTechStackChecks(
	spec: TechStackSpec,
	options: TechStackRunOptions,
): Promise<TechCheckOutput> {
	if (options.noCache) {
		try {
			const { runSparseChecks } = await import("#/techstack-sparse.js");
			return await runSparseChecks(spec, {
				baseDir: options.baseDir,
				home: options.home,
				scope: options.scope,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const warnings = [
				`Warning: sparse fetch failed for tech-stack ${spec.id}@${spec.ref} (${message}); falling back to full download.`,
			];
			const fallback = await runDiskChecks(spec, options);
			return { results: fallback.results, warnings: [...warnings, ...fallback.warnings] };
		}
	}
	return runDiskChecks(spec, options);
}

export async function recheckSelected(
	spec: TechStackSpec,
	options: TechStackRunOptions,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return [];
	}
	if (options.noCache) {
		const { recheckSparseSelected } = await import("#/techstack-sparse.js");
		return recheckSparseSelected(spec, options, selectedIds);
	}
	const cached = await ensureGithubRepo(spec, false);
	const repoRoot = cached.dir;
	const registryDoc = await loadRegistryDocument(repoRoot);
	const registry = await loadRegistry(repoRoot, options.scope, registryDoc);
	const names = await resolveWantedNames(spec, options.scope, repoRoot, registryDoc, registry);
	const { tasks } = collectJobs(registry, names, options, repoRoot);
	const filtered = tasks.filter((task) =>
		selectedIds.has(`preset:${task.packageName}:${task.presetFileName}`),
	);
	if (filtered.length <= CHECK_CONCURRENCY) {
		return Promise.all(filtered.map((task) => checkPresetFile(task)));
	}
	return mapWithConcurrency(filtered, CHECK_CONCURRENCY, (task) => checkPresetFile(task));
}

async function runDiskChecks(
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
	const { skips, tasks } = collectJobs(registry, names, options, repoRoot);
	const enforced =
		tasks.length <= CHECK_CONCURRENCY
			? await Promise.all(tasks.map((task) => checkPresetFile(task)))
			: await mapWithConcurrency(tasks, CHECK_CONCURRENCY, (task) => checkPresetFile(task));
	return { results: [...skips, ...enforced], warnings };
}

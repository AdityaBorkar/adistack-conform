import type { CheckResult, CheckScope } from "#/checks.js";
import type { ProjectRunSpec } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import type { CheckFileArgs } from "#/techstack-check.js";
import { checkPresetFile, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { ManifestFile } from "#/techstack-registry.js";
import {
	loadProjectManifest,
	loadRegistryDocument,
	resolveSourcePath,
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

function collectJobs(
	blueprint: string,
	files: ManifestFile[],
	manifestDir: string,
	repoRoot: string,
	options: TechStackRunOptions,
): { skips: CheckResult[]; tasks: CheckFileArgs[] } {
	const tasks: CheckFileArgs[] = [];
	const skips: CheckResult[] = [];
	for (const file of files) {
		const classified = classifyTarget(file.target, options.scope);
		if (classified.type === "skip") {
			skips.push(
				skippedForTarget(
					blueprint,
					file.name,
					file.source,
					file.target,
					classified.reason,
					options.scope,
				),
			);
			continue;
		}
		const targetPath = resolveTargetPath(classified.path, options.baseDir, options.home);
		tasks.push({
			blueprint,
			fileName: file.name,
			fileTarget: file.target,
			goldenPath: resolveSourcePath(file.source, manifestDir, repoRoot),
			scope: options.scope,
			sourceLabel: file.source,
			targetPath,
		});
	}
	return { skips, tasks };
}

export async function runProjectChecks(
	spec: ProjectRunSpec,
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

export async function recheckProjectSelected(
	spec: ProjectRunSpec,
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
	const { dir, files } = await loadProjectManifest(repoRoot, spec.blueprint, registryDoc);
	const { tasks } = collectJobs(spec.blueprint, files, dir, repoRoot, options);
	const filtered = tasks.filter((task) =>
		selectedIds.has(`project:${task.blueprint}:${task.fileName}`),
	);
	if (filtered.length <= CHECK_CONCURRENCY) {
		return Promise.all(filtered.map((task) => checkPresetFile(task)));
	}
	return mapWithConcurrency(filtered, CHECK_CONCURRENCY, (task) => checkPresetFile(task));
}

async function runDiskChecks(
	spec: ProjectRunSpec,
	options: TechStackRunOptions,
): Promise<TechCheckOutput> {
	const cached = await ensureGithubRepo(spec, options.noCache);
	const warnings: string[] = [];
	if (cached.stale && cached.warning !== undefined) {
		warnings.push(`Warning: using cached tech-stack ${spec.id}@${spec.ref} (${cached.warning})`);
	}
	const repoRoot = cached.dir;
	const registryDoc = await loadRegistryDocument(repoRoot);
	const { dir, files } = await loadProjectManifest(repoRoot, spec.blueprint, registryDoc);
	const { skips, tasks } = collectJobs(spec.blueprint, files, dir, repoRoot, options);
	const enforced =
		tasks.length <= CHECK_CONCURRENCY
			? await Promise.all(tasks.map((task) => checkPresetFile(task)))
			: await mapWithConcurrency(tasks, CHECK_CONCURRENCY, (task) => checkPresetFile(task));
	return { results: [...skips, ...enforced], warnings };
}

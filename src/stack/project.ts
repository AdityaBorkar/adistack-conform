import { checkFileStructureEntry, checkProjectFileWithGolden } from "#/stack/project-compare.js";
import type {
	ManifestCompare,
	ManifestFile,
	ManifestFileStructure,
	RegistryDocument,
} from "#/stack/registry.js";
import { resolveSourceRel } from "#/stack/registry.js";
import { fetchProjectManifest, fetchTextOrThrow, rawUrl } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import type { ProjectRunState } from "#/utils/config.js";
import { errorMessage, resolveTargetPath } from "#/utils/fs.js";
import { failManual, skipped, type CheckResult, type CheckScope } from "#/utils/result.js";

export const GOLDEN_FETCH_CONCURRENCY = 16;

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	scope: CheckScope;
}

interface NeededFile {
	blueprint: string;
	compare: ManifestCompare | undefined;
	fileName: string;
	fileTarget: string;
	sourceLabel: string;
	sourceRel: string;
	targetPath: string;
}

function collectNeeded(
	blueprint: string,
	files: ManifestFile[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): NeededFile[] {
	const needed: NeededFile[] = [];
	for (const file of files) {
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${file.name}`)) {
			continue;
		}
		needed.push({
			blueprint,
			compare: file.compare,
			fileName: file.name,
			fileTarget: file.target,
			sourceLabel: file.source,
			sourceRel: resolveSourceRel(file.source),
			targetPath: resolveTargetPath(file.target, options.baseDir, options.home),
		});
	}
	return needed;
}

async function fetchGoldens(
	id: string,
	ref: string,
	needed: readonly NeededFile[],
): Promise<Map<string, { error?: string; text?: string }>> {
	const goldens = new Map<string, { error?: string; text?: string }>();
	const toFetch = [...new Set(needed.map((item) => item.sourceRel))];
	await mapWithConcurrency(toFetch, GOLDEN_FETCH_CONCURRENCY, async (rel) => {
		try {
			goldens.set(rel, {
				text: await fetchTextOrThrow(rawUrl(id, ref, rel), `blueprint file ${rel}`),
			});
		} catch (error) {
			goldens.set(rel, { error: errorMessage(error) });
		}
	});
	return goldens;
}

function isNotFoundError(message: string): boolean {
	return message.includes("HTTP 404") || message.includes("not found");
}

function checkNeeded(
	needed: readonly NeededFile[],
	goldens: Map<string, { error?: string; text?: string }>,
	scope: CheckScope,
): Promise<CheckResult[]> {
	return Promise.all(
		needed.map((item): Promise<CheckResult> => {
			const golden = goldens.get(item.sourceRel);
			if (golden?.text === undefined) {
				const base = {
					id: `project:${item.blueprint}:${item.fileName}`,
					kind: "project",
					scope,
					source: `tech-stack:${item.blueprint}`,
					target: item.fileTarget,
				} as const;
				if (golden?.error !== undefined && !isNotFoundError(golden.error)) {
					return Promise.resolve(
						failManual(
							base,
							"<blueprint fetch failed>",
							item.sourceRel,
							`Cannot fetch blueprint ${item.sourceRel}: ${golden.error}`,
						),
					);
				}
				return Promise.resolve(
					failManual(
						base,
						"<blueprint file missing>",
						item.sourceRel,
						`Blueprint file missing in tech-stack repo: ${item.sourceRel}`,
					),
				);
			}
			return checkProjectFileWithGolden({
				blueprint: item.blueprint,
				compare: item.compare,
				fileName: item.fileName,
				fileTarget: item.fileTarget,
				golden: golden.text as string,
				scope,
				sourceLabel: item.sourceLabel,
				targetPath: item.targetPath,
			});
		}),
	);
}

async function runWithManifest(
	state: ProjectRunState,
	options: TechStackRunOptions,
	registry: RegistryDocument,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const { files, structure } = await fetchProjectManifest(
		state.id,
		state.ref,
		state.blueprint,
		registry,
	);
	const needed = collectNeeded(state.blueprint, files, options, onlyIds);
	const goldens = await fetchGoldens(state.id, state.ref, needed);
	const enforced = await checkNeeded(needed, goldens, options.scope);
	const structured = await checkFileStructure(state.blueprint, files, structure, options, onlyIds);
	return [...enforced, ...structured];
}

async function checkFileStructure(
	blueprint: string,
	files: ManifestFile[],
	structure: ManifestFileStructure[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const enforcedTargets = new Set(
		files.map((file) => resolveTargetPath(file.target, options.baseDir, options.home)),
	);
	const tasks: Promise<CheckResult>[] = [];
	const notes: CheckResult[] = [];
	const seenTargets = new Map<string, string>();
	for (const entry of structure) {
		const targetPath = resolveTargetPath(entry.target, options.baseDir, options.home);
		if (enforcedTargets.has(targetPath)) {
			continue;
		}
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${entry.name}`)) {
			continue;
		}
		if (seenTargets.has(targetPath)) {
			notes.push(
				skipped(
					{
						id: `project:${blueprint}:${entry.name}`,
						kind: "project",
						scope: options.scope,
						source: `tech-stack:${blueprint}`,
						target: entry.target,
					},
					"duplicate file-structure target",
					`same target as "${seenTargets.get(targetPath)}"; keeping the first entry`,
				),
			);
			continue;
		}
		seenTargets.set(targetPath, entry.name);
		tasks.push(
			checkFileStructureEntry({
				blueprint,
				entryName: entry.name,
				kind: entry.kind,
				scope: options.scope,
				targetPath,
			}),
		);
	}
	const results = await Promise.all(tasks);
	return [...results, ...notes];
}

export function runProjectChecks(
	state: ProjectRunState,
	options: TechStackRunOptions,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	return runWithManifest(state, options, registry);
}

export function recheckProjectSelected(
	state: ProjectRunState,
	options: TechStackRunOptions,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	return runWithManifest(state, options, registry, selectedIds);
}

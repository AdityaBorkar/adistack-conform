import { join } from "node:path";

import { failManual, type CheckResult, type CheckScope } from "#/checks.js";
import type { ProjectRunSpec } from "#/config.js";
import {
	checkFileStructureEntry,
	checkPresetFileWithGolden,
	classifyTarget,
	skippedForTarget,
} from "#/stack/check.js";
import { checkToolchainDeps, parseLocalPackageJson } from "#/stack/deps.js";
import type {
	ManifestCompare,
	ManifestFile,
	ManifestFileStructure,
	ManifestJs,
	RegistryDocument,
} from "#/stack/registry.js";
import { resolveSourceRel } from "#/stack/registry.js";
import { fetchProjectManifest, fetchTextOrThrow, rawUrl } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage, readFileSafe, resolveTargetPath } from "#/utils/fs.js";

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
	dirRel: string,
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): { needed: NeededFile[]; skips: CheckResult[] } {
	const needed: NeededFile[] = [];
	const skips: CheckResult[] = [];
	for (const file of files) {
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${file.name}`)) {
			continue;
		}
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
		needed.push({
			blueprint,
			compare: file.compare,
			fileName: file.name,
			fileTarget: file.target,
			sourceLabel: file.source,
			sourceRel: resolveSourceRel(file.source, dirRel),
			targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
		});
	}
	return { needed, skips };
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
				text: await fetchTextOrThrow(rawUrl(id, ref, rel), `preset file ${rel}`),
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
					kind: "preset",
					scope,
					source: `tech-stack:${item.blueprint}`,
					target: item.fileTarget,
				} as const;
				if (golden?.error !== undefined && !isNotFoundError(golden.error)) {
					return Promise.resolve(
						failManual(
							base,
							"<preset fetch failed>",
							item.sourceRel,
							`Cannot fetch preset ${item.sourceRel}: ${golden.error}`,
						),
					);
				}
				return Promise.resolve(
					failManual(
						base,
						"<preset file missing>",
						item.sourceRel,
						`Preset file missing in tech-stack repo: ${item.sourceRel}`,
					),
				);
			}
			return checkPresetFileWithGolden({
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
	spec: ProjectRunSpec,
	options: TechStackRunOptions,
	registry: RegistryDocument,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const { dirRel, files, js, structure } = await fetchProjectManifest(
		spec.id,
		spec.ref,
		spec.blueprint,
		registry,
	);
	const { needed, skips } = collectNeeded(spec.blueprint, files, dirRel, options, onlyIds);
	const goldens = await fetchGoldens(spec.id, spec.ref, needed);
	const enforced = await checkNeeded(needed, goldens, options.scope);
	const structured = await checkFileStructure(spec.blueprint, files, structure, options, onlyIds);
	const depResults = await checkDepsWithVersions(spec, js, options, onlyIds);
	return [...skips, ...enforced, ...structured, ...depResults];
}

function checkFileStructure(
	blueprint: string,
	files: ManifestFile[],
	structure: ManifestFileStructure[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const manifestNames = new Set(files.map((file) => file.name));
	const tasks: Promise<CheckResult>[] = [];
	for (const entry of structure) {
		if (manifestNames.has(entry.name)) {
			continue;
		}
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${entry.name}`)) {
			continue;
		}
		const classified = classifyTarget(entry.target, options.scope);
		if (classified.type === "skip") {
			tasks.push(
				Promise.resolve(
					skippedForTarget(
						blueprint,
						entry.name,
						entry.target,
						entry.target,
						classified.reason,
						options.scope,
					),
				),
			);
			continue;
		}
		tasks.push(
			checkFileStructureEntry({
				blueprint,
				entryName: entry.name,
				kind: entry.kind,
				scope: options.scope,
				targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
			}),
		);
	}
	return Promise.all(tasks);
}

async function checkDepsWithVersions(
	spec: ProjectRunSpec,
	js: ManifestJs | undefined,
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const localPath = join(options.baseDir, "package.json");
	const localRead = await readFileSafe(localPath);
	const localText = localRead.ok ? localRead.text : undefined;
	return checkToolchainDeps({
		blueprint: spec.blueprint,
		js,
		localPkg: parseLocalPackageJson(localText),
		onlyIds,
		scope: options.scope,
	});
}

export function runProjectChecks(
	spec: ProjectRunSpec,
	options: TechStackRunOptions,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	return runWithManifest(spec, options, registry);
}

export function recheckProjectSelected(
	spec: ProjectRunSpec,
	options: TechStackRunOptions,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	return runWithManifest(spec, options, registry, selectedIds);
}

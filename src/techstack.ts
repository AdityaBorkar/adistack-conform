import { failManual, type CheckResult, type CheckScope } from "#/checks.js";
import type { ProjectRunSpec } from "#/config.js";
import { checkPresetFileWithGolden, classifyTarget, skippedForTarget } from "#/techstack-check.js";
import type { ManifestFile, RegistryDocument } from "#/techstack-registry.js";
import { resolveSourceRel } from "#/techstack-registry.js";
import { fetchProjectManifest, fetchTextOrThrow, rawUrl } from "#/techstack-remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { resolveTargetPath } from "#/utils/fs.js";

export const GOLDEN_FETCH_CONCURRENCY = 16;

export interface TechStackRunOptions {
	baseDir: string;
	home: string;
	scope: CheckScope;
}

interface NeededFile {
	blueprint: string;
	fileName: string;
	fileTarget: string;
	needsGolden: boolean;
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
			fileName: file.name,
			fileTarget: file.target,
			needsGolden: !file.source.endsWith(".example"),
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
): Promise<Map<string, string>> {
	const goldens = new Map<string, string>();
	const toFetch = [
		...new Set(needed.filter((item) => item.needsGolden).map((item) => item.sourceRel)),
	];
	await mapWithConcurrency(toFetch, GOLDEN_FETCH_CONCURRENCY, async (rel) => {
		try {
			goldens.set(rel, await fetchTextOrThrow(rawUrl(id, ref, rel), `preset file ${rel}`));
		} catch {
			// Leave absent: caller reports "<preset file missing>".
		}
	});
	return goldens;
}

function checkNeeded(
	needed: readonly NeededFile[],
	goldens: Map<string, string>,
	scope: CheckScope,
): Promise<CheckResult[]> {
	return Promise.all(
		needed.map((item): Promise<CheckResult> => {
			if (!item.needsGolden) {
				return checkPresetFileWithGolden({
					blueprint: item.blueprint,
					fileName: item.fileName,
					fileTarget: item.fileTarget,
					golden: "",
					scope,
					sourceLabel: item.sourceLabel,
					targetPath: item.targetPath,
				});
			}
			const golden = goldens.get(item.sourceRel);
			if (golden === undefined) {
				return Promise.resolve(
					failManual(
						{
							id: `project:${item.blueprint}:${item.fileName}`,
							kind: "preset",
							scope,
							source: `tech-stack:${item.blueprint}`,
							target: item.fileTarget,
						},
						"<preset file missing>",
						item.sourceRel,
						`Preset file missing in tech-stack repo: ${item.sourceRel}`,
					),
				);
			}
			return checkPresetFileWithGolden({
				blueprint: item.blueprint,
				fileName: item.fileName,
				fileTarget: item.fileTarget,
				golden,
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
	const { dirRel, files } = await fetchProjectManifest(spec.id, spec.ref, spec.blueprint, registry);
	const { needed, skips } = collectNeeded(spec.blueprint, files, dirRel, options, onlyIds);
	const goldens = await fetchGoldens(spec.id, spec.ref, needed);
	const enforced = await checkNeeded(needed, goldens, options.scope);
	return [...skips, ...enforced];
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

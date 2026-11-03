import { join } from "node:path";

import { failManual, type CheckResult, type CheckScope } from "#/checks.js";
import type { ProjectRunSpec } from "#/config.js";
import {
	checkPresetFileWithGolden,
	checkRequiredDir,
	checkRequiredFileExists,
	classifyTarget,
	skippedForTarget,
} from "#/stack/check.js";
import { checkToolchainDeps, parseLocalPackageJson, presetDepVersions } from "#/stack/deps.js";
import type { ManifestDirectory, ManifestFile, RegistryDocument } from "#/stack/registry.js";
import { resolveSourceRel } from "#/stack/registry.js";
import { fetchProjectManifest, fetchTextOrThrow, rawUrl } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { readFileSafe, resolveTargetPath } from "#/utils/fs.js";

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
	const { directories, dirRel, files } = await fetchProjectManifest(
		spec.id,
		spec.ref,
		spec.blueprint,
		registry,
	);
	const { needed, skips } = collectNeeded(spec.blueprint, files, dirRel, options, onlyIds);
	const goldens = await fetchGoldens(spec.id, spec.ref, needed);
	const enforced = await checkNeeded(needed, goldens, options.scope);
	const requiredFiles = await checkRequiredFiles(spec.blueprint, files, options, onlyIds);
	const requiredDirs = await checkRequiredDirs(spec.blueprint, directories, options, onlyIds);
	const packageChecks = await checkPackageJsonAndDeps(spec, dirRel, files, options, onlyIds);
	return [...skips, ...enforced, ...requiredFiles, ...requiredDirs, ...packageChecks];
}

const REQUIRED_DOCS = ["AGENTS.md", "README.md"] as const;

function checkRequiredFiles(
	blueprint: string,
	files: ManifestFile[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const manifestNames = new Set(files.map((file) => file.name));
	return Promise.all(
		REQUIRED_DOCS.filter(
			(fileName) =>
				!manifestNames.has(fileName) &&
				(onlyIds === undefined || onlyIds.has(`project:${blueprint}:${fileName}`)),
		).map((fileName) =>
			checkRequiredFileExists({
				blueprint,
				fileName,
				scope: options.scope,
				targetPath: resolveTargetPath(fileName, options.baseDir, options.home),
			}),
		),
	);
}

function checkRequiredDirs(
	blueprint: string,
	directories: ManifestDirectory[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const tasks: Promise<CheckResult>[] = [];
	for (const dir of directories) {
		if (onlyIds !== undefined && !onlyIds.has(`project:${blueprint}:${dir.name}`)) {
			continue;
		}
		const classified = classifyTarget(dir.target, options.scope);
		if (classified.type === "skip") {
			tasks.push(
				Promise.resolve(
					skippedForTarget(
						blueprint,
						dir.name,
						dir.target,
						dir.target,
						classified.reason,
						options.scope,
					),
				),
			);
			continue;
		}
		tasks.push(
			checkRequiredDir({
				blueprint,
				dirName: dir.name,
				scope: options.scope,
				targetPath: resolveTargetPath(classified.path, options.baseDir, options.home),
			}),
		);
	}
	return Promise.all(tasks);
}

function targetBasename(target: string): string {
	const [token = ""] = target.split(/\s+/u);
	const parts = token.split("/");
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index] as string;
		if (part !== "") {
			return part;
		}
	}
	return "";
}

function hasPackageJsonEntry(files: ManifestFile[]): boolean {
	return files.some((file) => targetBasename(file.target) === "package.json");
}

async function checkPackageJsonAndDeps(
	spec: ProjectRunSpec,
	dirRel: string,
	files: ManifestFile[],
	options: TechStackRunOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const sourceRel = resolveSourceRel("../$presets/package.json", dirRel);
	let presetText: string | undefined;
	try {
		presetText = await fetchTextOrThrow(
			rawUrl(spec.id, spec.ref, sourceRel),
			`preset file ${sourceRel}`,
		);
	} catch {
		presetText = undefined;
	}
	const results: CheckResult[] = [];
	if (
		!hasPackageJsonEntry(files) &&
		presetText !== undefined &&
		(onlyIds === undefined || onlyIds.has(`project:${spec.blueprint}:Package JSON`))
	) {
		const targetPath = resolveTargetPath("package.json", options.baseDir, options.home);
		const targetRead = await readFileSafe(targetPath);
		if (targetRead.ok) {
			results.push(
				await checkPresetFileWithGolden({
					blueprint: spec.blueprint,
					fileName: "Package JSON",
					fileTarget: "package.json",
					golden: presetText,
					scope: options.scope,
					sourceLabel: sourceRel,
					targetPath,
				}),
			);
		} else if (targetRead.reason === "missing") {
			results.push(
				failManual(
					{
						id: `project:${spec.blueprint}:Package JSON`,
						kind: "preset",
						scope: options.scope,
						source: `tech-stack:${spec.blueprint}`,
						target: "package.json",
					},
					"<missing>",
					"exists (templated from preset)",
					`package.json is missing. Copy ${sourceRel} to ${targetPath}, adapt name/version/description/bin/files/exports, then re-run check.`,
				),
			);
		} else {
			results.push(
				failManual(
					{
						id: `project:${spec.blueprint}:Package JSON`,
						kind: "preset",
						scope: options.scope,
						source: `tech-stack:${spec.blueprint}`,
						target: "package.json",
					},
					"<unreadable>",
					"exists (templated from preset)",
					`Cannot read ${targetPath} (may need sudo): ${targetRead.error}`,
				),
			);
		}
	}
	const localPath = join(options.baseDir, "package.json");
	const localRead = await readFileSafe(localPath);
	const localText = localRead.ok ? localRead.text : undefined;
	results.push(
		...checkToolchainDeps({
			blueprint: spec.blueprint,
			files,
			localPkg: parseLocalPackageJson(localText),
			onlyIds,
			presetVersions: presetDepVersions(presetText),
			scope: options.scope,
		}),
	);
	return results;
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

import type { ProjectRunState } from "#/core/config.js";
import { checkProjectFileWithUpstream, projectBase } from "#/core/project/compare.js";
import { checkFileStructure } from "#/core/project/structure.js";
import { failManual, type CheckResult, type CheckScope } from "#/core/result.js";
import type { ManifestCompare, ManifestFile, RegistryDocument } from "#/core/upstream/registry.js";
import { resolveSourceRel } from "#/core/upstream/registry.js";
import {
	UPSTREAM_FETCH_CONCURRENCY,
	fetchProjectManifest,
	fetchTextOrThrow,
	rawUrl,
} from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";
import { resolveTargetPath } from "#/utils/fs.js";

export interface ProjectCheckOptions {
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
	options: ProjectCheckOptions,
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

async function fetchUpstreams(
	id: string,
	ref: string,
	needed: readonly NeededFile[],
): Promise<Map<string, { error?: string; text?: string }>> {
	const upstreams = new Map<string, { error?: string; text?: string }>();
	const toFetch = [...new Set(needed.map((item) => item.sourceRel))];
	await mapWithConcurrency(toFetch, UPSTREAM_FETCH_CONCURRENCY, async (rel) => {
		try {
			upstreams.set(rel, {
				text: await fetchTextOrThrow(rawUrl(id, ref, rel), `blueprint file ${rel}`),
			});
		} catch (error) {
			upstreams.set(rel, { error: errorMessage(error) });
		}
	});
	return upstreams;
}

function isNotFoundError(message: string): boolean {
	return message.includes("HTTP 404") || message.includes("not found");
}

function checkNeeded(
	needed: readonly NeededFile[],
	upstreams: Map<string, { error?: string; text?: string }>,
	scope: CheckScope,
): Promise<CheckResult[]> {
	return Promise.all(
		needed.map((item): Promise<CheckResult> => {
			const upstream = upstreams.get(item.sourceRel);
			if (upstream?.text === undefined) {
				const base = projectBase(item.blueprint, item.fileName, item.fileTarget, scope);
				if (upstream?.error !== undefined && !isNotFoundError(upstream.error)) {
					return Promise.resolve(
						failManual(
							base,
							"<blueprint fetch failed>",
							item.sourceRel,
							`Cannot fetch blueprint ${item.sourceRel}: ${upstream.error}`,
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
			return checkProjectFileWithUpstream({
				blueprint: item.blueprint,
				compare: item.compare,
				fileName: item.fileName,
				fileTarget: item.fileTarget,
				scope,
				sourceLabel: item.sourceLabel,
				targetPath: item.targetPath,
				upstream: upstream.text as string,
			});
		}),
	);
}

async function runWithManifest(
	state: ProjectRunState,
	options: ProjectCheckOptions,
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
	const upstreams = await fetchUpstreams(state.id, state.ref, needed);
	const enforced = await checkNeeded(needed, upstreams, options.scope);
	const structured = await checkFileStructure(state.blueprint, files, structure, options, onlyIds);
	return [...enforced, ...structured];
}

export function runProjectChecks(
	state: ProjectRunState,
	options: ProjectCheckOptions,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	return runWithManifest(state, options, registry);
}

export function recheckProjectSelected(
	state: ProjectRunState,
	options: ProjectCheckOptions,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	return runWithManifest(state, options, registry, selectedIds);
}

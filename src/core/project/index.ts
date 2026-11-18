import type { RunState } from "#/core/config.js";
import { checkProjectFileWithUpstream, projectBase } from "#/core/project/compare.js";
import { checkFileStructure } from "#/core/project/structure.js";
import { failManual, type CheckResult } from "#/core/result.js";
import type { ManifestCompare, ManifestFile, RegistryDocument } from "#/core/upstream/registry.js";
import {
	UPSTREAM_FETCH_CONCURRENCY,
	fetchBlueprint,
	fetchTextOrThrow,
	isNotFoundError,
	rawUrl,
} from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";
import { resolveTargetPath } from "#/utils/fs.js";

export interface ProjectCheckOptions {
	baseDir: string;
	home: string;
}

interface NeededFile {
	compare: ManifestCompare | undefined;
	fileName: string;
	fileTarget: string;
	sourceRel: string;
	targetPath: string;
}

type Upstream = { error: string; notFound: boolean; text?: undefined } | { text: string };

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
			compare: file.compare,
			fileName: file.name,
			fileTarget: file.target,
			sourceRel: file.source,
			targetPath: resolveTargetPath(file.target, options.baseDir, options.home),
		});
	}
	return needed;
}

async function fetchUpstreams(
	id: string,
	ref: string,
	needed: readonly NeededFile[],
): Promise<Map<string, Upstream>> {
	const upstreams = new Map<string, Upstream>();
	const toFetch = [...new Set(needed.map((item) => item.sourceRel))];
	await mapWithConcurrency(toFetch, UPSTREAM_FETCH_CONCURRENCY, async (rel) => {
		try {
			upstreams.set(rel, {
				text: await fetchTextOrThrow(rawUrl(id, ref, rel), `blueprint file ${rel}`),
			});
		} catch (error) {
			upstreams.set(rel, { error: errorMessage(error), notFound: isNotFoundError(error) });
		}
	});
	return upstreams;
}

function checkNeeded(
	blueprint: string,
	needed: readonly NeededFile[],
	upstreams: Map<string, Upstream>,
): Promise<CheckResult[]> {
	return Promise.all(
		needed.map((item): Promise<CheckResult> => {
			const upstream = upstreams.get(item.sourceRel);
			if (upstream?.text === undefined) {
				const base = projectBase(blueprint, item.fileName, item.fileTarget);
				if (upstream !== undefined && !upstream.notFound) {
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
				blueprint,
				compare: item.compare,
				fileName: item.fileName,
				fileTarget: item.fileTarget,
				sourceLabel: item.sourceRel,
				targetPath: item.targetPath,
				upstream: upstream.text,
			});
		}),
	);
}

// `onlyIds` narrows a re-check after fix to the selected results.
export async function runProjectChecks(
	state: RunState,
	options: ProjectCheckOptions,
	registry: RegistryDocument,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const { data } = await fetchBlueprint(state, registry, "projects");
	const { files, file_structure: structure } = data;
	const needed = collectNeeded(state.blueprint, files, options, onlyIds);
	const upstreams = await fetchUpstreams(state.id, state.ref, needed);
	const enforced = await checkNeeded(state.blueprint, needed, upstreams);
	const structured = await checkFileStructure(state.blueprint, files, structure, options, onlyIds);
	return [...enforced, ...structured];
}

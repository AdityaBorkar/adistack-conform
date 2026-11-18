import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { MachineRunState } from "#/core/config.js";
import { fixSelected } from "#/core/fix.js";
import { linkCachePath, resolveTarget } from "#/core/machine/paths.js";
import type { CheckResult } from "#/core/result.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { fetchBytesOrThrow, fetchMachineManifest, rawUrl } from "#/core/upstream/remote.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { isTemplateFile } from "#/schemas/machine-manifest.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

// A failed fetch returns undefined: the check results already carry that error.
async function loadMachineManifest(
	state: MachineRunState,
	registry: RegistryDocument,
): Promise<MachineManifest | undefined> {
	try {
		return (await fetchMachineManifest(state.id, state.ref, state.blueprint, registry)).manifest;
	} catch {
		return undefined;
	}
}

// Link fixes point at fetched upstreams materialized at the cache path, so
// the fix step must write those bytes first or the link points at nothing.
async function materializeLinkUpstreams(
	state: MachineRunState | undefined,
	manifest: MachineManifest | undefined,
	home: string,
	fixable: CheckResult[],
): Promise<CheckResult[]> {
	// Lookups below are by check id.
	const byId = new Map<string, { source: string; targetAbs: string }>();
	for (const file of manifest?.files ?? []) {
		if (state !== undefined && !isTemplateFile(file)) {
			byId.set(`machine:${state.blueprint}:link:${file.name}`, {
				source: file.source,
				targetAbs: resolveTarget(file.target, home),
			});
		}
	}
	const prepared = await mapWithConcurrency(fixable, 16, async (item) => {
		const fix = item.fix;
		if (fix?.kind !== "symlink") {
			return { item, ready: true };
		}
		const found = byId.get(item.id);
		// No owner (stale result, unknown blueprint, or manifest fetch failed)
		// or a path that no longer matches the manifest: skip instead of
		// leaving a dangling link.
		if (
			state === undefined ||
			found === undefined ||
			found.targetAbs !== fix.targetAbs ||
			linkCachePath(fix.targetAbs) !== fix.cachePath
		) {
			console.error(
				`✗ not fixed ${item.id}: cannot find link upstream for ${fix.targetAbs}; skipping (run check again first).`,
			);
			return { item, ready: false };
		}
		try {
			const bytes = await fetchBytesOrThrow(
				rawUrl(state.id, state.ref, found.source),
				`blueprint file ${found.source}`,
			);
			await mkdir(dirname(fix.cachePath), { recursive: true });
			await Bun.write(fix.cachePath, bytes);
			return { item, ready: true };
		} catch (error) {
			console.error(
				`✗ not fixed ${item.id}: cannot materialize link upstream: ${errorMessage(error)}`,
			);
			return { item, ready: false };
		}
	});
	return prepared.filter((entry) => entry.ready).map((entry) => entry.item);
}

// One call for the whole fix ritual: load the machine manifest when a link
// fix needs it, materialize link upstreams before `ln` runs, then run every
// fix (template modes travel on the overwrite-file fix itself).
export async function fixSelectedAcrossScopes(args: {
	home: string;
	registry: RegistryDocument;
	selected: CheckResult[];
	state: MachineRunState | undefined;
}): Promise<CheckResult[]> {
	const { home, registry, selected, state } = args;
	const needsManifest =
		state !== undefined && selected.some((item) => item.fix?.kind === "symlink");
	const manifest = needsManifest ? await loadMachineManifest(state, registry) : undefined;
	return fixSelected(await materializeLinkUpstreams(state, manifest, home, selected));
}

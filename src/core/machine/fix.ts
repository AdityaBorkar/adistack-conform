import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { MachineRunState } from "#/core/config.js";
import { fixSelected } from "#/core/fix.js";
import { linkCachePath, resolveTarget } from "#/core/machine/paths.js";
import type { CheckResult } from "#/core/result.js";
import type { Registries } from "#/core/upstream/registries.js";
import { fetchBytesOrThrow, fetchMachineManifest, rawUrl } from "#/core/upstream/remote.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { isTemplateFile } from "#/schemas/machine-manifest.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

export interface MachineStateManifest {
	manifest: MachineManifest;
	state: MachineRunState;
}

export async function loadMachineManifests(
	states: readonly MachineRunState[],
	registries: Registries,
): Promise<MachineStateManifest[]> {
	const settled = await Promise.all(
		states.map(async (state): Promise<MachineStateManifest | undefined> => {
			try {
				// Local registry lookup (not requireRegistry): a missing
				// registry just skips; drift results carry the fetch error.
				const registry = registries.get(`${state.id}@${state.ref}`);
				if (registry === undefined) {
					return undefined;
				}
				const { manifest } = await fetchMachineManifest(
					state.id,
					state.ref,
					state.blueprint,
					registry,
				);
				return { manifest, state };
			} catch {
				// Drift results already carry the fetch error; the fix stage just skips.
				return undefined;
			}
		}),
	);
	return settled.filter((entry) => entry !== undefined);
}

// Link fixes point at fetched upstreams materialized at the cache path, so
// the fix step must write those bytes first or the link points at nothing.
async function materializeLinkUpstreams(
	entries: readonly MachineStateManifest[],
	home: string,
	fixable: CheckResult[],
): Promise<CheckResult[]> {
	// One pass over manifests; lookups below are by check id.
	const byId = new Map<
		string,
		{ owner: MachineStateManifest; source: string; targetAbs: string }
	>();
	for (const entry of entries) {
		for (const file of entry.manifest.files) {
			if (isTemplateFile(file)) {
				continue;
			}
			const targetAbs = resolveTarget(file.target, home);
			byId.set(`machine:${entry.state.blueprint}:link:${file.name}`, {
				owner: entry,
				source: file.source,
				targetAbs,
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
			found === undefined ||
			found.targetAbs !== fix.targetAbs ||
			linkCachePath(fix.targetAbs) !== fix.cachePath
		) {
			console.error(
				`✗ not fixed ${item.id}: cannot find link upstream for ${fix.targetAbs}; skipping (re-check to refresh).`,
			);
			return { item, ready: false };
		}
		try {
			const bytes = await fetchBytesOrThrow(
				rawUrl(found.owner.state.id, found.owner.state.ref, found.source),
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

// Overwrite-file fixes never set modes: chmod templated files to the declared mode.
async function enforceTemplateModes(
	entries: readonly MachineStateManifest[],
	home: string,
	fixed: CheckResult[],
): Promise<void> {
	const modes = new Map<string, string>();
	for (const entry of entries) {
		for (const file of entry.manifest.files) {
			if (isTemplateFile(file) && file.mode !== undefined) {
				modes.set(resolveTarget(file.target, home), file.mode);
			}
		}
	}
	await Promise.all(
		fixed.map(async (item) => {
			const fix = item.fix;
			if (fix?.kind !== "overwrite-file") {
				return;
			}
			const mode = modes.get(fix.filePath);
			if (mode === undefined) {
				return;
			}
			try {
				await chmod(fix.filePath, Number.parseInt(mode, 8));
			} catch (error) {
				console.error(`✗ not fixed ${item.id}: cannot chmod ${mode}: ${errorMessage(error)}`);
			}
		}),
	);
}

// One call for the whole machine fix ritual: load manifests when a selected
// fix needs them, materialize link upstreams before `ln` runs, apply fixes,
// then chmod templated files to their declared modes. Shared by `fix` and
// `switch` so 0600 secrets never land world-readable.
export async function applyMachineFixes(args: {
	home: string;
	registries: Registries;
	selected: CheckResult[];
	states: readonly MachineRunState[];
}): Promise<CheckResult[]> {
	const { home, registries, selected, states } = args;
	const needsManifests = selected.some(
		(item) =>
			item.fix?.kind === "symlink" ||
			(item.fix?.kind === "overwrite-file" && item.scope === "machine"),
	);
	const manifests = needsManifests ? await loadMachineManifests(states, registries) : [];
	const ready = await materializeLinkUpstreams(manifests, home, selected);
	const fixed = await fixSelected(ready);
	await enforceTemplateModes(manifests, home, fixed);
	return fixed;
}

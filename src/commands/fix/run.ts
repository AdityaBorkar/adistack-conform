import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { isTemplateFile } from "#/schemas/machine-manifest.js";
import { fixGithubApiFix } from "#/stack/github-api.js";
import { linkCachePath, resolveTarget } from "#/stack/machine-files.js";
import { statLinkPath } from "#/stack/machine-live.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchBytesOrThrow, fetchMachineManifest, rawUrl } from "#/stack/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import type { MachineRunState } from "#/utils/config.js";
import { errorMessage, readFileSafe, writeFileEnsuringDir } from "#/utils/fs.js";
import type { CheckResult } from "#/utils/result.js";

export const FIX_TIMEOUT_MS = 10 * 60_000;

async function runCommandFix(argv: string[], label: string): Promise<void> {
	const proc = Bun.spawn(argv, {
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			proc.kill();
			setTimeout(() => {
				try {
					proc.kill(9);
				} catch {
					// Already exited.
				}
			}, 5000).unref?.();
		} catch {
			// Already exited; the await below settles first.
		}
	}, FIX_TIMEOUT_MS);
	let code: number;
	try {
		code = await proc.exited;
	} finally {
		clearTimeout(timer);
	}
	if (timedOut) {
		throw new Error(`Command timed out after ${Math.round(FIX_TIMEOUT_MS / 1000)}s: ${label}`);
	}
	if (code !== 0) {
		throw new Error(`Command failed with exit code ${code}: ${label}`);
	}
}

export async function fixResult(result: CheckResult): Promise<void> {
	const fix = result.fix;
	if (fix === undefined) {
		throw new Error(`Result ${result.id} is not fixable.`);
	}
	if (fix.kind === "github-api") {
		await fixGithubApiFix(fix);
		return;
	}
	if (fix.kind === "overwrite-file") {
		await writeFileEnsuringDir(fix.filePath, fix.newContent);
		return;
	}
	if (fix.kind === "symlink") {
		await runCommandFix(["ln", "-sfn", fix.cachePath, fix.targetAbs], fix.label);
		return;
	}
	await runCommandFix([fix.command, ...fix.args], fix.label);
}

async function backupExistingFile(filePath: string): Promise<string | undefined> {
	const existing = await readFileSafe(filePath);
	if (!existing.ok) {
		return undefined;
	}
	let backupPath = `${filePath}.conform.bak`;
	for (let suffix = 1; suffix < 100; suffix += 1) {
		if (!(await Bun.file(backupPath).exists())) {
			break;
		}
		backupPath = `${filePath}.conform.bak.${suffix}`;
	}
	if (await Bun.file(backupPath).exists()) {
		throw new Error(`Backup ${backupPath} already exists; refusing to overwrite it.`);
	}
	await Bun.write(backupPath, existing.text);
	return backupPath;
}

// `ln -sfn` replaces whatever is at the target: back up a regular file first
// (same .conform.bak rule as overwrite-file fixes). Symlinks need no backup;
// directories are refused so a file fix never swallows a directory.
async function backupLinkTarget(targetAbs: string): Promise<string | undefined> {
	const stat = await statLinkPath(targetAbs);
	if (stat.kind === "missing" || stat.kind === "symlink") {
		return undefined;
	}
	if (!stat.isFile) {
		throw new Error(`Refusing to replace ${targetAbs}: not a regular file.`);
	}
	return backupExistingFile(targetAbs);
}

async function fixOnce(item: CheckResult, written: Map<string, string>): Promise<boolean> {
	const fix = item.fix;
	if (fix?.kind === "overwrite-file") {
		const prior = written.get(fix.filePath);
		if (prior !== undefined) {
			if (prior === fix.newContent) {
				console.log(`✓ fixed ${item.id} (already written)`);
				return true;
			}
			console.error(
				`✗ not fixed ${item.id}: conflicting fixes write different content to ${fix.filePath}; resolve the blueprints manually.`,
			);
			return false;
		}
		const backup = await backupExistingFile(fix.filePath);
		await fixResult(item);
		written.set(fix.filePath, fix.newContent);
		console.log(`✓ fixed ${item.id}${backup === undefined ? "" : ` (backup: ${backup})`}`);
		return true;
	}
	if (fix?.kind === "symlink") {
		const linkBackup = await backupLinkTarget(fix.targetAbs);
		await fixResult(item);
		console.log(`✓ fixed ${item.id}${linkBackup === undefined ? "" : ` (backup: ${linkBackup})`}`);
		return true;
	}
	await fixResult(item);
	console.log(`✓ fixed ${item.id}`);
	return true;
}

export async function fixSelected(selected: CheckResult[]): Promise<CheckResult[]> {
	const byFile = new Map<string, CheckResult[]>();
	const others: CheckResult[] = [];
	for (const item of selected) {
		if (item.fix?.kind === "overwrite-file") {
			const list = byFile.get(item.fix.filePath) ?? [];
			list.push(item);
			byFile.set(item.fix.filePath, list);
		} else {
			others.push(item);
		}
	}
	// File writes first so conflicting same-path fixes are coalesced through
	// the `written` map before any command fix runs; order within each group
	// follows selection order.
	const ordered = [...[...byFile.values()].flat(), ...others];
	const written = new Map<string, string>();
	const fixed: CheckResult[] = [];
	for (const item of ordered) {
		try {
			if (await fixOnce(item, written)) {
				fixed.push(item);
			}
		} catch (error) {
			console.error(`✗ not fixed ${item.id}: ${errorMessage(error)}`);
		}
	}
	return fixed;
}

export interface MachineStateManifest {
	manifest: MachineManifest;
	state: MachineRunState;
}

export async function loadMachineManifests(
	states: readonly MachineRunState[],
	registries: Map<string, RegistryDocument>,
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
	registries: Map<string, RegistryDocument>;
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

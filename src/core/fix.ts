import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { copyFile, lstat, rename, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { fixGithubApiFix } from "#/core/github/api.js";
import type { CheckFix, CheckResult, SymlinkFix } from "#/core/result.js";
import { errorMessage } from "#/utils/error.js";
import { isMissingError, realPathOf, writeFileEnsuringDir } from "#/utils/fs.js";
import { runCommand } from "#/utils/process.js";

const FIX_TIMEOUT_MS = 10 * 60_000;

async function lstatOrMissing(path: string): Promise<Stats | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isMissingError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isMissingError(error)) {
			throw error;
		}
	}
}

// Backs up a regular file to the next free .conform.bak[.N]. Refuses before
// reading a byte when the path is a symlink (a planted link must never copy
// its target into the workspace) or not a regular file. copyFile keeps the
// mode, so a 0600 file never gets a world-readable backup; COPYFILE_EXCL never
// overwrites an older backup. `single` keeps one backup (secrets files), so
// decrypted copies do not pile up.
async function backupExistingFile(filePath: string, single = false): Promise<string | undefined> {
	const info = await lstatOrMissing(filePath);
	if (info === undefined) {
		return undefined;
	}
	if (info.isSymbolicLink()) {
		throw new Error(`Refusing to write through symlink: ${filePath}`);
	}
	if (!info.isFile()) {
		throw new Error(`Refusing to replace ${filePath}: not a regular file.`);
	}
	if (single) {
		await unlinkIfPresent(`${filePath}.conform.bak`);
	}
	for (let suffix = 0; suffix < 100; suffix += 1) {
		const backupPath = `${filePath}.conform.bak${suffix === 0 ? "" : `.${suffix}`}`;
		try {
			await copyFile(filePath, backupPath, constants.COPYFILE_EXCL);
			return backupPath;
		} catch (error) {
			if ((error as { code?: unknown } | null)?.code !== "EEXIST") {
				throw error;
			}
		}
	}
	throw new Error(`Too many backups of ${filePath}; remove old .conform.bak files first.`);
}

// Writes the checked upstream bytes to the cache, then swaps the link in
// atomically (symlink to a temp name, rename over the target). A symlink at
// the target needs no backup; a regular file is backed up first.
async function linkToCache(fix: SymlinkFix): Promise<string | undefined> {
	const current = await lstatOrMissing(fix.targetAbs);
	const backup =
		current?.isSymbolicLink() === true ? undefined : await backupExistingFile(fix.targetAbs);
	await writeFileEnsuringDir(fix.cachePath, fix.content);
	const tmp = `${fix.targetAbs}.conform-tmp`;
	await unlinkIfPresent(tmp);
	await symlink(fix.cachePath, tmp);
	await rename(tmp, fix.targetAbs);
	return backup;
}

async function fixOnce(item: CheckResult, written: Map<string, string>): Promise<boolean> {
	const fix = item.fix;
	if (fix === undefined) {
		throw new Error(`Result ${item.id} is not fixable.`);
	}
	let backup: string | undefined;
	if (fix.kind === "overwrite-file") {
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
		backup = await backupExistingFile(fix.filePath, fix.secret === true);
		const mode = fix.mode === undefined ? undefined : Number.parseInt(fix.mode, 8);
		await writeFileEnsuringDir(fix.filePath, fix.newContent, mode);
		written.set(fix.filePath, fix.newContent);
	} else if (fix.kind === "symlink") {
		backup = await linkToCache(fix);
	} else if (fix.kind === "github-api") {
		await fixGithubApiFix(fix);
	} else {
		await runCommand([fix.command, ...fix.args], fix.label, FIX_TIMEOUT_MS);
	}
	console.log(`✓ fixed ${item.id}${backup === undefined ? "" : ` (backup: ${backup})`}`);
	return true;
}

export async function fixSelected(selected: CheckResult[]): Promise<CheckResult[]> {
	// File writes first so conflicting same-path fixes are coalesced through
	// the `written` map before any command fix runs; order within each group
	// follows selection order.
	const files = selected.filter((item) => item.fix?.kind === "overwrite-file");
	const ordered = [...files, ...selected.filter((item) => item.fix?.kind !== "overwrite-file")];
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

function writtenPath(fix: CheckFix | undefined): string | undefined {
	if (fix?.kind === "overwrite-file") {
		return fix.filePath;
	}
	return fix?.kind === "symlink" ? fix.targetAbs : undefined;
}

// Compares real locations: a symlinked parent dir (e.g. `.github -> /elsewhere`)
// cannot smuggle a write out of the project. The last segment stays literal,
// since fixes replace it rather than write through it.
async function isInsideDir(filePath: string, realDir: string): Promise<boolean> {
	const real = join(await realPathOf(dirname(filePath)), basename(filePath));
	const rel = relative(realDir, real);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// `--all` without a TTY never runs commands, edits GitHub, or writes outside
// the project: returns why it refuses, or undefined when every fix is safe.
export async function unattendedRefusal(
	fixable: readonly CheckResult[],
	projectDir: string,
): Promise<string | undefined> {
	const risky = fixable.filter(
		(item) => item.fix?.kind === "run-command" || item.fix?.kind === "github-api",
	);
	if (risky.length > 0) {
		return `Refusing --all in non-TTY: ${risky.length} fix(es) run commands or edit GitHub (${risky.map((item) => item.id).join(", ")}). Run again in a terminal or select file-only fixes.`;
	}
	const realDir = await realPathOf(projectDir);
	const outside: CheckResult[] = [];
	for (const item of fixable) {
		const path = writtenPath(item.fix);
		if (path !== undefined && !(await isInsideDir(path, realDir))) {
			outside.push(item);
		}
	}
	if (outside.length > 0) {
		return `Refusing --all in non-TTY: ${outside.length} fix(es) write outside the project dir (${outside.map((item) => item.id).join(", ")}). Run again in a terminal to confirm.`;
	}
	return undefined;
}

import { isAbsolute, relative, resolve } from "node:path";

import { fixGithubApiFix } from "#/core/github/api.js";
import { statLinkPath } from "#/core/machine/live.js";
import type { CheckResult } from "#/core/result.js";
import { errorMessage } from "#/utils/error.js";
import { readFileSafe, writeFileEnsuringDir } from "#/utils/fs.js";

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

function isInsideDir(filePath: string, dir: string): boolean {
	const rel = relative(resolve(dir), resolve(filePath));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// `--all` without a TTY never runs commands, edits GitHub, or writes outside
// the project: returns why it refuses, or undefined when every fix is safe.
export function unattendedRefusal(
	fixable: readonly CheckResult[],
	cwd: string,
): string | undefined {
	const risky = fixable.filter(
		(item) =>
			item.fix?.kind === "run-command" ||
			item.fix?.kind === "symlink" ||
			item.fix?.kind === "github-api",
	);
	if (risky.length > 0) {
		return `Refusing --all in non-TTY: ${risky.length} fix(es) run commands or edit GitHub (${risky.map((item) => item.id).join(", ")}). Run again in a terminal or select file-only fixes.`;
	}
	const outside = fixable.filter(
		(item) => item.fix?.kind === "overwrite-file" && !isInsideDir(item.fix.filePath, cwd),
	);
	if (outside.length > 0) {
		return `Refusing --all in non-TTY: ${outside.length} file fix(es) write outside the project dir (${outside.map((item) => item.id).join(", ")}). Run again in a terminal to confirm.`;
	}
	return undefined;
}

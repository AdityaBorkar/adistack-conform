import { applyGithubApiFix } from "#/stack/github-api.js";
import { errorMessage, readFileSafe, writeFileEnsuringDir } from "#/utils/fs.js";
import type { CheckResult } from "#/utils/result.js";

export const FIX_TIMEOUT_MS = 10 * 60_000;

export async function applyFix(result: CheckResult): Promise<void> {
	if (!result.fix) {
		throw new Error(`Result ${result.id} is not fixable.`);
	}
	if (result.fix.kind === "github-api") {
		await applyGithubApiFix(result.fix);
		return;
	}
	if (result.fix.kind === "overwrite-file") {
		await writeFileEnsuringDir(result.fix.filePath, result.fix.newContent);
		return;
	}
	const proc = Bun.spawn([result.fix.command, ...result.fix.args], {
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
		throw new Error(
			`Command timed out after ${Math.round(FIX_TIMEOUT_MS / 1000)}s: ${result.fix.label}`,
		);
	}
	if (code !== 0) {
		throw new Error(`Command failed with exit code ${code}: ${result.fix.label}`);
	}
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

async function applyOnce(item: CheckResult, written: Map<string, string>): Promise<boolean> {
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
		await applyFix(item);
		written.set(fix.filePath, fix.newContent);
		console.log(`✓ fixed ${item.id}${backup === undefined ? "" : ` (backup: ${backup})`}`);
		return true;
	}
	await applyFix(item);
	console.log(`✓ fixed ${item.id}`);
	return true;
}

export async function applySelected(selected: CheckResult[]): Promise<number> {
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
	const ordered = [...[...byFile.values()].flat(), ...others];
	const written = new Map<string, string>();
	let applied = 0;
	for (const item of ordered) {
		try {
			if (await applyOnce(item, written)) {
				applied += 1;
			}
		} catch (error) {
			console.error(`✗ not fixed ${item.id}: ${errorMessage(error)}`);
		}
	}
	return applied;
}

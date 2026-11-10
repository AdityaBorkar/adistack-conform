import { applyGithubApiFix } from "#/stack/github-api.js";
import { errorMessage, writeFileEnsuringDir } from "#/utils/fs.js";
import type { CheckResult } from "#/utils/result.js";

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
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`Command failed with exit code ${code}: ${result.fix.label}`);
	}
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
	let applied = 0;
	for (const item of ordered) {
		try {
			await applyFix(item);
			applied += 1;
			console.log(`✓ fixed ${item.id}`);
		} catch (error) {
			console.error(`✗ not fixed ${item.id}: ${errorMessage(error)}`);
		}
	}
	return applied;
}

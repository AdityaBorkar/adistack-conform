import * as prompts from "@clack/prompts";

import type { CheckResult } from "#/checks.js";
import { applyFix, desiredContent, readActualContent } from "#/checks.js";
import { renderDiff } from "#/diff.js";
import { formatResult } from "#/output.js";

export function reportUnfixable(unfixable: CheckResult[]): void {
	for (const item of unfixable) {
		for (const line of formatResult(item)) {
			console.error(line);
		}
		if (item.hint === undefined) {
			console.error(`    fix manually: see target ${item.target}`);
		}
	}
}

export function printDryRun(fixable: CheckResult[]): void {
	console.log(`\nDry run: ${fixable.length} item(s) would be fixed.`);
	for (const item of fixable) {
		console.log(`  - ${item.id} (${item.target})`);
	}
}

export async function renderFixDiffs(fixable: CheckResult[]): Promise<void> {
	const rendered = await Promise.all(
		fixable.map(async (item) => {
			const actual = await readActualContent(item);
			return `\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", actual, desiredContent(item))}`;
		}),
	);
	for (const text of rendered) {
		console.log(text);
	}
}

export async function promptForSelection(fixable: CheckResult[]): Promise<CheckResult[]> {
	if (!process.stdin.isTTY) {
		console.error("Not a TTY: re-run with --all to apply fixes non-interactively.");
		process.exit(2);
	}
	prompts.intro("Select fixes to apply (space to toggle, enter to confirm).");
	const choice = await prompts.multiselect({
		message: "Pick items to fix.",
		options: [
			{ label: `Select all (${fixable.length} items)`, value: "__all" },
			...fixable.map((item) => ({
				hint: item.target,
				label: item.id,
				value: item.id,
			})),
		],
		required: false,
	});
	if (prompts.isCancel(choice) || choice.length === 0) {
		prompts.outro("No fixes applied.");
		process.exit(1);
	}
	const ids = new Set(choice as string[]);
	const selected = ids.has("__all") ? fixable : fixable.filter((item) => ids.has(item.id));
	if (selected.length === 0) {
		prompts.outro("No fixes applied.");
		process.exit(1);
	}
	return selected;
}

export async function applySelected(selected: CheckResult[]): Promise<number> {
	let applied = 0;
	for (const item of selected) {
		try {
			await applyFix(item);
			applied += 1;
			console.log(`✓ fixed ${item.id}`);
		} catch (error) {
			console.error(
				`✗ not fixed ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return applied;
}

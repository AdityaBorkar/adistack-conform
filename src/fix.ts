import * as prompts from "@clack/prompts";

import type { CheckResult } from "#/checks.js";
import { applyFix, desiredContent, readActualContent } from "#/checks.js";
import { renderDiff } from "#/diff.js";
import { errorMessage } from "#/fs.js";
import { formatResult } from "#/output.js";

export type PromptOutcome =
	| { kind: "cancelled" }
	| { kind: "no-tty" }
	| { kind: "selected"; selected: CheckResult[] };

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

export async function promptForSelection(fixable: CheckResult[]): Promise<PromptOutcome> {
	if (!process.stdin.isTTY) {
		return { kind: "no-tty" };
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
		return { kind: "cancelled" };
	}
	const ids = new Set(choice as string[]);
	const selected = ids.has("__all") ? fixable : fixable.filter((item) => ids.has(item.id));
	if (selected.length === 0) {
		return { kind: "cancelled" };
	}
	return { kind: "selected", selected };
}

export async function applySelected(selected: CheckResult[]): Promise<number> {
	const outcomes = await Promise.allSettled(selected.map((item) => applyFix(item)));
	let applied = 0;
	outcomes.forEach((outcome, index) => {
		const item = selected[index] as CheckResult;
		if (outcome.status === "fulfilled") {
			applied += 1;
			console.log(`✓ fixed ${item.id}`);
		} else {
			console.error(`✗ not fixed ${item.id}: ${errorMessage(outcome.reason)}`);
		}
	});
	return applied;
}

export function partitionResults(results: CheckResult[]): {
	failed: CheckResult[];
	fixable: CheckResult[];
	passed: number;
	unfixable: CheckResult[];
} {
	const failed = results.filter((item) => !item.ok);
	return {
		failed,
		fixable: failed.filter((item) => item.fixable),
		passed: results.filter((item) => item.ok && item.skipped !== true).length,
		unfixable: failed.filter((item) => !item.fixable),
	};
}

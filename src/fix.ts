import * as prompts from "@clack/prompts";

import type { CheckResult } from "#/checks.js";
import { applyFix } from "#/checks.js";
import { errorMessage } from "#/fs.js";

export type PromptOutcome =
	| { kind: "cancelled" }
	| { kind: "no-tty" }
	| { kind: "selected"; selected: CheckResult[] };

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

export type SelectionOutcome =
	| { kind: "cancelled" }
	| { kind: "no-tty" }
	| { kind: "selected"; selected: CheckResult[] };

export async function resolveSelection(
	fixable: CheckResult[],
	allFlag: boolean | undefined,
): Promise<SelectionOutcome> {
	if (allFlag) {
		return { kind: "selected", selected: fixable };
	}
	const outcome = await promptForSelection(fixable);
	if (outcome.kind === "no-tty") {
		return { kind: "no-tty" };
	}
	if (outcome.kind === "cancelled") {
		return { kind: "cancelled" };
	}
	return { kind: "selected", selected: outcome.selected };
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

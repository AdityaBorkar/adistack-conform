import type { CheckResult } from "#/checks.js";
import { applyFix, describeFix } from "#/checks.js";
import { errorMessage } from "#/utils/fs.js";

export type PromptOutcome =
	| { kind: "cancelled" }
	| { kind: "no-tty" }
	| { kind: "selected"; selected: CheckResult[] };

export function isInteractive(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function promptForSelection(fixable: CheckResult[]): Promise<PromptOutcome> {
	if (!isInteractive()) {
		return { kind: "no-tty" };
	}
	const prompts = await import("@clack/prompts");
	prompts.intro("Select fixes to apply (space to toggle, enter to confirm).");
	const choice = await prompts.groupMultiselect({
		message: "Pick items to fix.",
		options: {
			"Select all": fixable.map((item) => ({
				hint: `${item.target} — ${describeFix(item)}`,
				label: `${item.id} — ${describeFix(item)}`,
				value: item.id,
			})),
		},
		required: false,
	});
	if (prompts.isCancel(choice) || choice.length === 0) {
		return { kind: "cancelled" };
	}
	const ids = new Set(choice as string[]);
	const selected = fixable.filter((item) => ids.has(item.id));
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

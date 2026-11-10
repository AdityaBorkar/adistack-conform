import type { CheckResult } from "#/utils/result.js";
import { describeFix } from "#/utils/result.js";

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

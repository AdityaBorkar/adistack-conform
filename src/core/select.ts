import type { CheckResult } from "#/core/result.js";
import { describeFix } from "#/core/result.js";

export type SelectionOutcome =
	| { kind: "cancelled" }
	| { kind: "no-tty" }
	| { kind: "selected"; selected: CheckResult[] };

export function isInteractive(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

// `--all` takes every fixable item; otherwise ask in the terminal.
export async function selectFixes(
	fixable: CheckResult[],
	all: boolean | undefined,
): Promise<SelectionOutcome> {
	if (all === true) {
		return { kind: "selected", selected: fixable };
	}
	if (!isInteractive()) {
		return { kind: "no-tty" };
	}
	const prompts = await import("@clack/prompts");
	prompts.intro("Select fixes to run (space to toggle, enter to confirm).");
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
	return selected.length === 0 ? { kind: "cancelled" } : { kind: "selected", selected };
}

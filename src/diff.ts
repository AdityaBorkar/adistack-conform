const GREEN = "\u001B[32m";
const GREY = "\u001B[90m";
const RED = "\u001B[31m";
const RESET = "\u001B[0m";

function splitLines(text: string): string[] {
	if (text === "") {
		return [];
	}
	return text.replaceAll("\r\n", "\n").split("\n");
}

function lcsTable(a: string[], b: string[]): number[][] {
	const table: number[][] = Array.from({ length: a.length + 1 }, () =>
		Array.from({ length: b.length + 1 }, () => 0),
	);
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			table[i]![j] =
				a[i] === b[j]
					? (table[i + 1]![j + 1] as number) + 1
					: Math.max(table[i + 1]![j] as number, table[i]![j + 1] as number);
		}
	}
	return table;
}

export interface DiffLine {
	text: string;
	type: "context" | "del" | "ins";
}

export function lineDiff(actual: string, expected: string, context = 3): DiffLine[] {
	const a = splitLines(actual);
	const b = splitLines(expected);
	if (a.length > 2000 || b.length > 2000) {
		return [
			{ text: `diff skipped: file too large (${a.length} vs ${b.length} lines)`, type: "context" },
		];
	}
	const table = lcsTable(a, b);
	const ops: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			ops.push({ text: a[i] as string, type: "context" });
			i += 1;
			j += 1;
		} else if ((table[i + 1]![j] as number) >= (table[i]![j + 1] as number)) {
			ops.push({ text: a[i] as string, type: "del" });
			i += 1;
		} else {
			ops.push({ text: b[j] as string, type: "ins" });
			j += 1;
		}
	}
	while (i < a.length) {
		ops.push({ text: a[i] as string, type: "del" });
		i += 1;
	}
	while (j < b.length) {
		ops.push({ text: b[j] as string, type: "ins" });
		j += 1;
	}

	const keep = Array.from({ length: ops.length }, () => false);
	for (let index = 0; index < ops.length; index += 1) {
		if (ops[index]!.type !== "context") {
			for (
				let k = Math.max(0, index - context);
				k <= Math.min(ops.length - 1, index + context);
				k += 1
			) {
				keep[k] = true;
			}
		}
	}
	const out: DiffLine[] = [];
	let gap = false;
	for (let index = 0; index < ops.length; index += 1) {
		if (!keep[index]) {
			if (!gap) {
				out.push({ text: "…", type: "context" });
				gap = true;
			}
			continue;
		}
		gap = false;
		out.push(ops[index] as DiffLine);
	}
	return out;
}

export function renderDiff(
	actualLabel: string,
	expectedLabel: string,
	actual: string,
	expected: string,
): string {
	const lines = lineDiff(actual, expected);
	const out: string[] = [
		`${GREY}--- ${actualLabel}${RESET}`,
		`${GREY}+++ ${expectedLabel}${RESET}`,
	];
	for (const line of lines) {
		if (line.type === "del") {
			out.push(`${RED}- ${line.text}${RESET}`);
		} else if (line.type === "ins") {
			out.push(`${GREEN}+ ${line.text}${RESET}`);
		} else {
			out.push(`${GREY}  ${line.text}${RESET}`);
		}
	}
	return out.join("\n");
}

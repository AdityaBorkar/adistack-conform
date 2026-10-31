import { createTwoFilesPatch, diffLines } from "diff";
import pc from "picocolors";

export interface DiffLine {
	text: string;
	type: "context" | "del" | "ins";
}

export function lineDiff(actual: string, expected: string): DiffLine[] {
	const a = actual.replaceAll("\r\n", "\n");
	const b = expected.replaceAll("\r\n", "\n");
	if (a === b) {
		if (a === "") {
			return [];
		}
		const equalLines = a.split("\n");
		if (equalLines.at(-1) === "") {
			equalLines.pop();
		}
		return equalLines.map((text) => ({ text, type: "context" as const }));
	}
	return diffLines(a, b).flatMap((part) => {
		const lines = part.value.split("\n");
		if (lines.length > 0 && lines.at(-1) === "") {
			lines.pop();
		}
		const type = part.added
			? ("ins" as const)
			: part.removed
				? ("del" as const)
				: ("context" as const);
		return lines.map((text) => ({ text, type }));
	});
}

export function renderDiff(
	actualLabel: string,
	expectedLabel: string,
	actual: string,
	expected: string,
	context = 3,
): string {
	const patch = createTwoFilesPatch(
		actualLabel,
		expectedLabel,
		actual.replaceAll("\r\n", "\n"),
		expected.replaceAll("\r\n", "\n"),
		"",
		"",
		{
			context,
		},
	);
	return patch
		.split("\n")
		.map((line) => {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				return pc.green(line);
			}
			if (line.startsWith("-") && !line.startsWith("---")) {
				return pc.red(line);
			}
			return pc.gray(line);
		})
		.join("\n");
}

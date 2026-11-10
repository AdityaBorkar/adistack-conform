import { createTwoFilesPatch } from "diff";
import pc from "picocolors";

const EMPTY_HEADER = "";
const DEFAULT_CONTEXT = 3;
const MAX_DIFF_CHARS = 200_000;

function normalize(text: string): string {
	return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function renderDiff(
	actualLabel: string,
	expectedLabel: string,
	actual: string,
	expected: string,
	context = DEFAULT_CONTEXT,
): string {
	const normalizedActual = normalize(actual);
	const normalizedExpected = normalize(expected);
	if (normalizedActual === normalizedExpected && actual !== expected) {
		return "(line endings differ only: check CRLF vs LF)";
	}
	if (normalizedActual.length + normalizedExpected.length > MAX_DIFF_CHARS) {
		return `(diff skipped: ${normalizedActual.length + normalizedExpected.length} chars > ${MAX_DIFF_CHARS})`;
	}
	const patch = createTwoFilesPatch(
		actualLabel,
		expectedLabel,
		normalizedActual,
		normalizedExpected,
		EMPTY_HEADER,
		EMPTY_HEADER,
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

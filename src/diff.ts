import { createTwoFilesPatch } from "diff";
import pc from "picocolors";

const EMPTY_HEADER = "";
const DEFAULT_CONTEXT = 3;

export function renderDiff(
	actualLabel: string,
	expectedLabel: string,
	actual: string,
	expected: string,
	context = DEFAULT_CONTEXT,
): string {
	const normalizedActual = actual.includes("\r") ? actual.replaceAll("\r\n", "\n") : actual;
	const normalizedExpected = expected.includes("\r") ? expected.replaceAll("\r\n", "\n") : expected;
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

import { createTwoFilesPatch } from "diff";
import pc from "picocolors";

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

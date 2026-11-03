import * as v from "valibot";

export function parseOrThrow<T>(
	schema: v.GenericSchema<unknown, T>,
	path: string,
	parsed: unknown,
	label: string,
): T {
	const result = v.safeParse(schema, parsed);
	if (!result.success) {
		throw new Error(
			`Invalid ${label} in ${path}:\n${v.summarize(result.issues as [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]])}`,
		);
	}
	return result.output;
}

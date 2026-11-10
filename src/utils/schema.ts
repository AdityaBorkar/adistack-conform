import * as z from "zod";

export function parseOrThrow<T>(
	schema: z.ZodType<T>,
	path: string,
	parsed: unknown,
	label: string,
): T {
	const result = schema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid ${label} in ${path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

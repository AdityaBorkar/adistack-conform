import * as v from "valibot";

export const TechStackSourceSchema = v.object({
	branch: v.optional(
		v.pipe(
			v.string(),
			v.minLength(1),
			v.description("Git branch of the tech-stack repo (defaults to ref)."),
		),
	),
	ref: v.optional(
		v.pipe(v.string(), v.minLength(1), v.description("Git branch, tag, or commit.")),
		"main",
	),
	repo: v.pipe(
		v.string(),
		v.regex(/^[^/\s]+\/[^/\s]+$/u),
		v.description(
			"GitHub owner/repo holding blueprints and presets (project) or nix flakes (machine).",
		),
	),
	type: v.pipe(v.literal("github"), v.description("Tech-stack source; only github is supported.")),
});

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

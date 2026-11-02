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
		v.description("GitHub owner/repo holding blueprints and presets."),
	),
	type: v.pipe(v.literal("github"), v.description("Preset source; only github is supported.")),
});

export function makeConfigSchema(options: {
	blueprintDescription: string;
	schemaDescription: string;
}) {
	return v.object({
		$schema: v.optional(v.pipe(v.string(), v.description(options.schemaDescription))),
		blueprint: v.pipe(v.string(), v.minLength(1), v.description(options.blueprintDescription)),
		exclude: v.optional(
			v.pipe(
				v.array(v.pipe(v.string(), v.minLength(1))),
				v.description("Preset names dropped from the effective set."),
			),
			() => [],
		),
		presets: v.optional(
			v.pipe(
				v.array(v.pipe(v.string(), v.minLength(1))),
				v.description("Extra preset names merged over the blueprint."),
			),
			() => [],
		),
		source: v.pipe(
			TechStackSourceSchema,
			v.description("Tech-stack repo holding blueprints and presets."),
		),
	});
}

export function makePresetManifestSchema(options: {
	packagesDescription: string;
	pathDescription: string;
	schemaDescription: string;
	typeDescription: string;
	typeLiteral: string;
}) {
	const fileSchema = v.object({
		name: v.pipe(v.string(), v.minLength(1), v.description("File name within the preset.")),
		path: v.pipe(v.string(), v.minLength(1), v.description(options.pathDescription)),
		target: v.pipe(v.string(), v.minLength(1), v.description("Enforcement target.")),
	});
	const packageSchema = v.object({
		files: v.pipe(
			v.array(fileSchema),
			v.minLength(1),
			v.description("Files belonging to this preset."),
		),
		name: v.pipe(v.string(), v.minLength(1), v.description("Preset name.")),
	});
	return v.object({
		$schema: v.optional(v.pipe(v.string(), v.description(options.schemaDescription))),
		packages: v.pipe(v.array(packageSchema), v.description(options.packagesDescription)),
		type: v.pipe(v.literal(options.typeLiteral), v.description(options.typeDescription)),
	});
}

export function makeBlueprintSchema(options: {
	nameDescription: string;
	schemaDescription: string;
	typeDescription: string;
	typeLiteral: string;
}) {
	return v.object({
		$schema: v.optional(v.pipe(v.string(), v.description(options.schemaDescription))),
		description: v.optional(
			v.pipe(v.string(), v.description("Human-readable blueprint description.")),
		),
		exclude: v.optional(
			v.pipe(
				v.array(v.pipe(v.string(), v.minLength(1))),
				v.description("Preset names dropped from the effective set."),
			),
			() => [],
		),
		name: v.pipe(v.string(), v.minLength(1), v.description(options.nameDescription)),
		presets: v.optional(
			v.pipe(
				v.array(v.pipe(v.string(), v.minLength(1))),
				v.description("Preset names included by this blueprint."),
			),
			() => [],
		),
		type: v.pipe(v.literal(options.typeLiteral), v.description(options.typeDescription)),
	});
}

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

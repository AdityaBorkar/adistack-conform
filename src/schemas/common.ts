import * as z from "zod";

export const TechStackSourceSchema = z.object({
	branch: z
		.string()
		.min(1)
		.optional()
		.describe("Git branch of the tech-stack repo (defaults to ref)."),
	ref: z.string().min(1).default("main").describe("Git branch, tag, or commit."),
	repo: z
		.string()
		.regex(/^[^/\s]+\/[^/\s]+$/u)
		.describe("GitHub owner/repo holding blueprints and presets."),
	type: z.literal("github").describe("Preset source; only github is supported."),
});

export function makeConfigSchema(options: {
	blueprintDescription: string;
	schemaDescription: string;
}) {
	return z.object({
		$schema: z.string().optional().describe(options.schemaDescription),
		blueprint: z.string().min(1).describe(options.blueprintDescription),
		exclude: z
			.array(z.string().min(1))
			.default([])
			.describe("Preset names dropped from the effective set."),
		presets: z
			.array(z.string().min(1))
			.default([])
			.describe("Extra preset names merged over the blueprint."),
		source: TechStackSourceSchema.describe("Tech-stack repo holding blueprints and presets."),
	});
}

export function makePresetManifestSchema(options: {
	packagesDescription: string;
	pathDescription: string;
	schemaDescription: string;
	typeDescription: string;
	typeLiteral: string;
}) {
	const fileSchema = z.object({
		name: z.string().min(1).describe("File name within the preset."),
		path: z.string().min(1).describe(options.pathDescription),
		target: z.string().min(1).describe("Enforcement target."),
	});
	const packageSchema = z.object({
		files: z.array(fileSchema).min(1).describe("Files belonging to this preset."),
		name: z.string().min(1).describe("Preset name."),
		reference: z.string().min(1).describe("Repo-relative preset directory."),
	});
	return z.object({
		$schema: z.string().optional().describe(options.schemaDescription),
		packages: z.array(packageSchema).describe(options.packagesDescription),
		type: z.literal(options.typeLiteral).describe(options.typeDescription),
	});
}

export function makeBlueprintSchema(options: {
	nameDescription: string;
	schemaDescription: string;
	typeDescription: string;
	typeLiteral: string;
}) {
	return z.object({
		$schema: z.string().optional().describe(options.schemaDescription),
		description: z.string().optional().describe("Human-readable blueprint description."),
		exclude: z
			.array(z.string().min(1))
			.default([])
			.describe("Preset names dropped from the effective set."),
		name: z.string().min(1).describe(options.nameDescription),
		presets: z
			.array(z.string().min(1))
			.default([])
			.describe("Preset names included by this blueprint."),
		type: z.literal(options.typeLiteral).describe(options.typeDescription),
	});
}

export function parseOrThrow<T>(
	schema: z.ZodType<T>,
	path: string,
	parsed: unknown,
	label?: string,
): T {
	const result = schema.safeParse(parsed);
	if (!result.success) {
		const expected = label ?? "conform.project.json or conform.machine.json format";
		throw new Error(`Invalid ${expected} in ${path}:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}

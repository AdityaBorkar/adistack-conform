import * as z from "zod";

const ProjectSourceSchema = z.object({
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

export const ProjectSchema = z.object({
	$schema: z
		.string()
		.optional()
		.describe("JSON Schema reference, e.g. ./configuration_schema/project.json."),
	blueprint: z.string().min(1).describe("Project blueprint name, e.g. cli-app."),
	exclude: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names dropped from the effective set."),
	presets: z
		.array(z.string().min(1))
		.default([])
		.describe("Extra preset names merged over the blueprint."),
	source: ProjectSourceSchema.describe("Tech-stack repo holding blueprints and presets."),
});

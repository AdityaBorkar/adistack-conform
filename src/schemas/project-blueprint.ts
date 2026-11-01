import * as z from "zod";

export const ProjectBlueprintSchema = z.object({
	$schema: z.string().optional().describe("JSON Schema reference, e.g. project-blueprint.json."),
	description: z.string().optional().describe("Human-readable blueprint description."),
	exclude: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names dropped from the effective set."),
	name: z.string().min(1).describe("Display name for the project blueprint."),
	presets: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names included by this blueprint."),
	type: z.literal("project.blueprint").describe("Discriminant for project blueprints."),
});

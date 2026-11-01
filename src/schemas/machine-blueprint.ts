import * as z from "zod";

export const MachineBlueprintSchema = z.object({
	$schema: z.string().optional().describe("JSON Schema reference, e.g. machine-blueprint.json."),
	description: z.string().optional().describe("Human-readable blueprint description."),
	exclude: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names dropped from the effective set."),
	name: z.string().min(1).describe("Display name for the machine blueprint."),
	presets: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names included by this blueprint."),
	type: z.literal("machine.blueprint").describe("Discriminant for machine blueprints."),
});

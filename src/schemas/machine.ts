import * as z from "zod";

const MachineSourceSchema = z.object({
	ref: z.string().min(1).default("main").describe("Git branch, tag, or commit."),
	repo: z
		.string()
		.regex(/^[^/\s]+\/[^/\s]+$/u)
		.describe("GitHub owner/repo holding blueprints and presets."),
	type: z.literal("github").describe("Preset source; only github is supported."),
});

export const MachineSchema = z.object({
	$schema: z
		.string()
		.optional()
		.describe("JSON Schema reference, e.g. ./configuration_schema/machine.json."),
	blueprint: z.string().min(1).describe("Machine blueprint name, e.g. main."),
	exclude: z
		.array(z.string().min(1))
		.default([])
		.describe("Preset names dropped from the effective set."),
	fix: z
		.enum(["overwrite", "report"])
		.default("overwrite")
		.describe("Whether preset mismatches are auto-fixable."),
	presets: z
		.array(z.string().min(1))
		.default([])
		.describe("Extra preset names merged over the blueprint."),
	source: MachineSourceSchema.describe("Tech-stack repo holding blueprints and presets."),
});

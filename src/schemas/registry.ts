import * as z from "zod";

const RegistrySectionSchema = z.object({
	blueprints: z
		.array(z.string().min(1))
		.describe("Blueprint locations relative to tech-stack root."),
	presets: z.array(z.string().min(1)).describe("Preset locations relative to tech-stack root."),
});

export const RegistrySchema = z.object({
	$schema: z.string().optional().describe("JSON Schema reference, e.g. registry.json."),
	machine: RegistrySectionSchema.describe("Machine blueprints and presets locations."),
	project: RegistrySectionSchema.describe("Project blueprints and presets locations."),
});

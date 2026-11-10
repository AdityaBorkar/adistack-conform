import * as z from "zod";

const RegistryEntrySchema = z.object({
	name: z.string().min(1).describe("Display name for the blueprint."),
	path: z
		.string()
		.min(1)
		.describe(
			"Blueprint path relative to the tech-stack root: a project blueprint file (e.g. ./projects/cli-app.json) or a machine flake directory (e.g. ./machines/main/).",
		),
});

export const RegistrySchema = z.compile(
	z.object({
		$schema: z
			.string()
			.describe(
				"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json.",
			)
			.optional(),
		machines: z
			.array(RegistryEntrySchema)
			.describe("Machine blueprints as explicit name/path entries."),
		projects: z
			.array(RegistryEntrySchema)
			.describe("Project blueprints as explicit name/path entries."),
	}),
);

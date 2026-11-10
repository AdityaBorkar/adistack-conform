import * as z from "zod";

const MachineEntrySchema = z.object({
	name: z.string().min(1).describe("Display name for the blueprint."),
	path: z
		.string()
		.min(1)
		.describe("Machine flake directory relative to the tech-stack root (e.g. ./machines/main/)."),
});

export const RegistrySchema = z.compile(
	z.object({
		$schema: z
			.string()
			.describe(
				"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json.",
			)
			.optional(),
		github_configs: z
			.record(z.string(), z.string().min(1))
			.describe("GitHub settings blueprints as key/path entries."),
		machines: z
			.record(z.string(), MachineEntrySchema)
			.describe("Machine blueprints as key/entry pairs."),
		projects: z
			.record(z.string(), z.string().min(1))
			.describe("Project blueprints as key/path entries."),
	}),
);

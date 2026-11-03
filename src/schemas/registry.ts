import * as v from "valibot";

const RegistryEntrySchema = v.object({
	name: v.pipe(v.string(), v.minLength(1), v.description("Display name for the blueprint.")),
	path: v.pipe(
		v.string(),
		v.minLength(1),
		v.description("Blueprint directory relative to the tech-stack root, e.g. ./projects/cli-app/."),
	),
});

export const RegistrySchema = v.object({
	$schema: v.optional(
		v.pipe(
			v.string(),
			v.description(
				"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json.",
			),
		),
	),
	machines: v.pipe(
		v.array(RegistryEntrySchema),
		v.description("Machine blueprints as explicit name/path entries."),
	),
	projects: v.pipe(
		v.array(RegistryEntrySchema),
		v.description("Project blueprints as explicit name/path entries."),
	),
});

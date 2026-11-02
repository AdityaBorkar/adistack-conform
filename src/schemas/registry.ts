import * as v from "valibot";

const RegistrySectionSchema = v.object({
	blueprints: v.pipe(
		v.array(v.pipe(v.string(), v.minLength(1))),
		v.description("Blueprint locations relative to tech-stack root."),
	),
	presets: v.pipe(
		v.array(v.pipe(v.string(), v.minLength(1))),
		v.description("Preset locations relative to tech-stack root."),
	),
});

export const RegistrySchema = v.object({
	$schema: v.optional(
		v.pipe(v.string(), v.description("JSON Schema reference, e.g. registry.json.")),
	),
	machine: v.pipe(
		RegistrySectionSchema,
		v.description("Machine blueprints and presets locations."),
	),
	project: v.pipe(
		RegistrySectionSchema,
		v.description("Project blueprints and presets locations."),
	),
});

import * as v from "valibot";

const ManifestFileSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1), v.description("File name within the blueprint.")),
	source: v.pipe(
		v.string(),
		v.minLength(1),
		v.description(
			"Source path of the golden file. Relative to the manifest directory when starting with ./ or ../, otherwise relative to the tech-stack root.",
		),
	),
	target: v.pipe(v.string(), v.minLength(1), v.description("Enforcement target.")),
});

export const ManifestSchema = v.object({
	$schema: v.optional(
		v.pipe(
			v.string(),
			v.description(
				"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/project-manifest.json.",
			),
		),
	),
	description: v.optional(
		v.pipe(v.string(), v.description("Human-readable blueprint description.")),
	),
	files: v.pipe(v.array(ManifestFileSchema), v.description("Files enforced by this blueprint.")),
});

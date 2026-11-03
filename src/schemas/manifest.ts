import * as v from "valibot";

const ManifestPackageSchema = v.pipe(
	v.union([
		v.pipe(v.string(), v.minLength(1), v.description("Package required in devDependencies.")),
		v.object({
			name: v.pipe(v.string(), v.minLength(1), v.description("Required package name.")),
			section: v.optional(
				v.picklist(
					["dependencies", "devDependencies", "peerDependencies"],
					"Package section; defaults to devDependencies.",
				),
				"devDependencies",
			),
		}),
	]),
	v.description("Packages this file needs installed in package.json."),
);

const ManifestFileSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1), v.description("File name within the blueprint.")),
	packages: v.optional(
		v.pipe(v.array(ManifestPackageSchema), v.description("Packages this file needs installed.")),
	),
	source: v.pipe(
		v.string(),
		v.minLength(1),
		v.description(
			"Source path of the golden file. Relative to the manifest directory when starting with ./ or ../, otherwise relative to the tech-stack root.",
		),
	),
	target: v.pipe(v.string(), v.minLength(1), v.description("Enforcement target.")),
});

const ManifestDirectorySchema = v.object({
	name: v.pipe(v.string(), v.minLength(1), v.description("Directory name within the blueprint.")),
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
	directories: v.optional(
		v.pipe(
			v.array(ManifestDirectorySchema),
			v.description("Directories enforced by this blueprint."),
		),
	),
	files: v.pipe(v.array(ManifestFileSchema), v.description("Files enforced by this blueprint.")),
});

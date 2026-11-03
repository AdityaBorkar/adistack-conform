import * as v from "valibot";

const ManifestDepMapSchema = (description: string) =>
	v.optional(
		v.pipe(v.record(v.string(), v.pipe(v.string(), v.minLength(1))), v.description(description)),
		{},
	);

const ManifestJsSchema = v.object({
	dependencies: ManifestDepMapSchema(
		"Packages required in dependencies, pinned to exact versions.",
	),
	devDependencies: ManifestDepMapSchema(
		"Packages required in devDependencies, pinned to exact versions.",
	),
	peerDependencies: ManifestDepMapSchema(
		"Packages required in peerDependencies, pinned to exact versions.",
	),
	pm: v.optional(
		v.pipe(
			v.string(),
			v.minLength(1),
			v.description("Package manager binary used in install hints, e.g. bun."),
		),
		"bun",
	),
});

const ManifestCompareSchema = v.object({
	ignore: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Top-level keys excluded from the compare; local values are preserved by fix."),
		),
		[],
	),
	pinned: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description(
				"Top-level keys that must match the golden (objects merge per key, so local extras are allowed); fix takes golden values.",
			),
		),
		[],
	),
	strip: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Top-level keys removed from both sides before comparing and from fix output."),
		),
		[],
	),
	versioned: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description(
				"Object sections (e.g. dependencies) where versions must match for packages present on both sides; fix takes golden versions.",
			),
		),
		[],
	),
});

const ManifestFileSchema = v.object({
	compare: v.optional(
		v.pipe(ManifestCompareSchema, v.description("Semantic compare/fix rules for this file.")),
	),
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

const ManifestFileStructureSchema = v.object({
	kind: v.pipe(
		v.picklist(["dir", "file"]),
		v.description("Required entry kind: dir must exist as a directory, file must exist as a file."),
	),
	name: v.pipe(v.string(), v.minLength(1), v.description("Entry name within the blueprint.")),
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
	file_structure: v.optional(
		v.pipe(
			v.array(ManifestFileStructureSchema),
			v.description("Existence-only entries enforced by this blueprint (no content compare)."),
		),
		[],
	),
	files: v.pipe(v.array(ManifestFileSchema), v.description("Files enforced by this blueprint.")),
	github: v.optional(
		v.pipe(
			v.string(),
			v.minLength(1),
			v.description(
				"Source path of the GitHub settings preset. Relative to the manifest directory when starting with ./ or ../, otherwise relative to the tech-stack root.",
			),
		),
	),
	js: v.optional(
		v.pipe(ManifestJsSchema, v.description("JavaScript packages required in package.json.")),
	),
});

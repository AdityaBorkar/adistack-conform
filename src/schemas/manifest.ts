import * as z from "zod";

const ManifestDepMapSchema = (description: string) =>
	z.record(z.string(), z.string().min(1)).describe(description).default({});

const ManifestJsSchema = z
	.object({
		dependencies: ManifestDepMapSchema(
			'Packages required in dependencies, pinned to exact versions; "any" allows any installed version.',
		),
		devDependencies: ManifestDepMapSchema(
			'Packages required in devDependencies, pinned to exact versions; "any" allows any installed version.',
		),
		peerDependencies: ManifestDepMapSchema(
			'Packages required in peerDependencies, pinned to exact versions; "any" allows any installed version.',
		),
		pm: z
			.string()
			.min(1)
			.describe("Package manager binary used in install hints, e.g. bun.")
			.default("bun"),
	})
	.strict();

const ManifestCompareSchema = z
	.object({
		ignore: z
			.array(z.string().min(1))
			.describe("Top-level keys excluded from the compare; local values are preserved by fix.")
			.default([]),
		strip: z
			.array(z.string().min(1))
			.describe("Top-level keys removed from both sides before comparing and from fix output.")
			.default([]),
		versioned: z
			.array(z.string().min(1))
			.describe(
				"Object sections (e.g. dependencies) where versions must match for packages present on both sides; fix takes golden versions.",
			)
			.default([]),
	})
	.strict();

const ManifestFileSchema = z
	.object({
		compare: ManifestCompareSchema.describe("Semantic compare/fix rules for this file.").optional(),
		name: z.string().min(1).describe("File name within the blueprint."),
		source: z
			.string()
			.min(1)
			.describe(
				"Repo-relative source path of the golden file (e.g. projects/files/<group>/<file>).",
			),
		target: z.string().min(1).describe("Enforcement target."),
	})
	.strict();

const ManifestFileStructureSchema = z
	.object({
		kind: z
			.enum(["dir", "file"])
			.describe("Required entry kind: dir must exist as a directory, file must exist as a file."),
		name: z.string().min(1).describe("Entry name within the blueprint."),
		target: z.string().min(1).describe("Enforcement target."),
	})
	.strict();

export const ManifestSchema = z.compile(
	z
		.object({
			$schema: z
				.string()
				.describe(
					"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/project-manifest.json.",
				)
				.optional(),
			description: z.string().describe("Human-readable blueprint description.").optional(),
			file_structure: z
				.array(ManifestFileStructureSchema)
				.describe("Existence-only entries enforced by this blueprint (no content compare).")
				.default([]),
			files: z.array(ManifestFileSchema).describe("Files enforced by this blueprint."),
			github: z
				.string()
				.min(1)
				.describe("Repo-relative source path of the GitHub settings preset.")
				.optional(),
			js: ManifestJsSchema.describe("JavaScript packages required in package.json.").optional(),
		})
		.strict(),
);

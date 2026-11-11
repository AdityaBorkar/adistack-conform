import * as z from "zod";

const ManifestCompareSchema = z
	.object({
		ignore: z
			.array(z.string().min(1))
			.describe("Top-level keys excluded from the compare; local values are preserved by fix.")
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
				"Repo-relative source path of the upstream file (e.g. projects/files/<group>/<file>).",
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
			"@description": z.string().describe("Human-readable blueprint description.").optional(),
			"@name": z.string().min(1).describe("Human-readable blueprint name.").optional(),
			file_structure: z
				.array(ManifestFileStructureSchema)
				.describe("Existence-only entries enforced by this blueprint (no content compare).")
				.default([]),
			files: z.array(ManifestFileSchema).describe("Files enforced by this blueprint."),
		})
		.strict()
		.superRefine((data, ctx) => {
			if (data.files.length === 0 && data.file_structure.length === 0) {
				ctx.addIssue({
					code: "custom",
					message:
						"Blueprint enforces nothing: add at least one files[] or file_structure[] entry.",
				});
			}
			for (const [label, names] of [
				["files", data.files.map((file) => file.name)],
				["file_structure", data.file_structure.map((entry) => entry.name)],
			] as const) {
				const seen = new Set<string>();
				for (const name of names) {
					if (seen.has(name)) {
						ctx.addIssue({ code: "custom", message: `${label} has duplicate name "${name}".` });
					}
					seen.add(name);
				}
			}
		}),
);

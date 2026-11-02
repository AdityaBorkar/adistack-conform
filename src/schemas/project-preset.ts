import { makePresetManifestSchema } from "#/schemas/common.js";

export const ProjectPresetManifestSchema = makePresetManifestSchema({
	packagesDescription: "All project presets.",
	pathDescription: "Repo-relative source path, e.g. project/presets/oxlint/config.json.",
	schemaDescription: "JSON Schema reference, e.g. project-preset.json.",
	typeDescription: "Discriminant for the project presets manifest.",
	typeLiteral: "project.presets",
});

import * as z from "zod";

const ProjectPresetFileSchema = z.object({
	name: z.string().min(1).describe("File name within the preset."),
	path: z
		.string()
		.min(1)
		.describe("Repo-relative source path, e.g. project/presets/oxlint/config.json."),
	target: z.string().min(1).describe("Enforcement target."),
});

const ProjectPresetPackageSchema = z.object({
	files: z.array(ProjectPresetFileSchema).min(1).describe("Files belonging to this preset."),
	name: z.string().min(1).describe("Preset name."),
	reference: z.string().min(1).describe("Repo-relative preset directory."),
});

export const ProjectPresetManifestSchema = z.object({
	$schema: z.string().optional().describe("JSON Schema reference, e.g. project-preset.json."),
	packages: z.array(ProjectPresetPackageSchema).describe("All project presets."),
	type: z.literal("project.presets").describe("Discriminant for the project presets manifest."),
});

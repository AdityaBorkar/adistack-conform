import * as z from "zod";

const MachinePresetFileSchema = z.object({
	name: z.string().min(1).describe("File name within the preset."),
	path: z
		.string()
		.min(1)
		.describe("Repo-relative source path, e.g. machine/presets/git/gitconfig."),
	target: z.string().min(1).describe("Enforcement target."),
});

const MachinePresetPackageSchema = z.object({
	files: z.array(MachinePresetFileSchema).min(1).describe("Files belonging to this preset."),
	name: z.string().min(1).describe("Preset name."),
	reference: z.string().min(1).describe("Repo-relative preset directory."),
});

export const MachinePresetManifestSchema = z.object({
	$schema: z.string().optional().describe("JSON Schema reference, e.g. machine-preset.json."),
	packages: z.array(MachinePresetPackageSchema).describe("All machine presets."),
	type: z.literal("machine.presets").describe("Discriminant for the machine presets manifest."),
});

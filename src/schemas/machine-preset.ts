import { makePresetManifestSchema } from "#/schemas/common.js";

export const MachinePresetManifestSchema = makePresetManifestSchema({
	packagesDescription: "All machine presets.",
	pathDescription: "Repo-relative source path, e.g. machine/presets/git/gitconfig.",
	schemaDescription: "JSON Schema reference, e.g. machine-preset.json.",
	typeDescription: "Discriminant for the machine presets manifest.",
	typeLiteral: "machine.presets",
});

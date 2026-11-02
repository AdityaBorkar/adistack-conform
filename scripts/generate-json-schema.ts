import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toJsonSchema } from "@valibot/to-json-schema";

import { MachineBlueprintSchema } from "#/schemas/machine-blueprint.js";
import { MachinePresetManifestSchema } from "#/schemas/machine-preset.js";
import { MachineSchema } from "#/schemas/machine.js";
import { ProjectBlueprintSchema } from "#/schemas/project-blueprint.js";
import { ProjectPresetManifestSchema } from "#/schemas/project-preset.js";
import { ProjectSchema } from "#/schemas/project.js";
import { RegistrySchema } from "#/schemas/registry.js";

const outDir = join(import.meta.dir, "..", "configuration_schema");

await mkdir(outDir, { recursive: true });

const targets = {
	"machine.json": MachineSchema,
	"machine-blueprint.json": MachineBlueprintSchema,
	"machine-preset.json": MachinePresetManifestSchema,
	"project.json": ProjectSchema,
	"project-blueprint.json": ProjectBlueprintSchema,
	"project-preset.json": ProjectPresetManifestSchema,
	"registry.json": RegistrySchema,
} as const;

await Promise.all(
	Object.entries(targets).map(async ([file, schema]) => {
		const outPath = join(outDir, file);
		// JSON Schema patterns carry no flags: strip `u` like zod did (warns per regex).
		const jsonSchema = toJsonSchema(schema, { errorMode: "warn", target: "draft-2020-12" });
		await Bun.write(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);
		console.log(`Wrote ${outPath}`);
	}),
);

import { write } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import { ConformSchema } from "#/schemas/config.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";

export async function generateJsonSchema() {
	const OUTPUT_DIR = join(import.meta.dir, "..", "config");

	const TARGETS = {
		"github-manifest.json": GithubSchema,
		"project-manifest.json": ManifestSchema,
		"registry.json": RegistrySchema,
		"schema.json": ConformSchema,
	} as const;

	await mkdir(OUTPUT_DIR, { recursive: true });

	await Promise.all(
		Object.entries(TARGETS).map(async ([file, schema]) => {
			const outPath = join(OUTPUT_DIR, file);
			const jsonSchema = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" });
			await write(outPath, `${JSON.stringify(jsonSchema, null, "\t")}\n`);
			console.log(`Wrote ${outPath}`);
		}),
	);
}

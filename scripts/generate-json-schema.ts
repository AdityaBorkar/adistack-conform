import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toJsonSchema } from "@valibot/to-json-schema";

import { ConformSchema } from "#/schemas/conform.js";
import { GithubSchema } from "#/schemas/github.js";
import { ManifestSchema } from "#/schemas/manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";

const OUTPUT_DIR = join(import.meta.dir, "..", "configuration_schema");

const TARGETS = {
	"conform.json": ConformSchema,
	"github.json": GithubSchema,
	"project-manifest.json": ManifestSchema,
	"registry.json": RegistrySchema,
} as const;

export async function generateJsonSchema() {
	await mkdir(OUTPUT_DIR, { recursive: true });

	await Promise.all(
		Object.entries(TARGETS).map(async ([file, schema]) => {
			const outPath = join(OUTPUT_DIR, file);
			const jsonSchema = toJsonSchema(schema, { errorMode: "warn", target: "draft-2020-12" });
			await Bun.write(outPath, `${JSON.stringify(jsonSchema, null, "\t")}\n`);
			console.log(`Wrote ${outPath}`);
		}),
	);
}

if (import.meta.main) {
	await generateJsonSchema();
}

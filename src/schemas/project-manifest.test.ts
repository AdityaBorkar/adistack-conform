import { describe, expect, test } from "bun:test";

import { ManifestSchema } from "#/schemas/project-manifest.js";

const file = (name: string) => ({ name, source: "projects/files/x.json", target: `${name}.json` });
const entry = (name: string) => ({ kind: "file", name, target: `${name}.md` });

describe("ManifestSchema names", () => {
	test("unique names across both lists pass", () => {
		const result = ManifestSchema.safeParse({ file_structure: [entry("b")], files: [file("a")] });
		expect(result.success).toBe(true);
	});

	test("a name shared by files and file_structure fails (they would share one result id)", () => {
		const result = ManifestSchema.safeParse({
			file_structure: [entry("readme")],
			files: [file("readme")],
		});
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain("already used in files");
	});

	test("duplicates within one list still fail", () => {
		const result = ManifestSchema.safeParse({ files: [file("a"), file("a")] });
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain('files has duplicate name \\"a\\"');
	});
});

import { describe, expect, test } from "bun:test";

import { memoryReader } from "#/core/upstream/memory-reader.js";
import { UpstreamMissingError, openTechStack } from "#/core/upstream/tech-stack.js";

const registry = `// JSONC, as authors write it
{ "github_configs": {}, "machines": {}, "projects": { "app": "./projects/app.json", "gone": "./projects/gone.json" } }`;

describe("openTechStack", () => {
	test("parses the JSONC registry and resolves blueprints by name", async () => {
		const techStack = await openTechStack(
			memoryReader({
				"projects/app.json":
					'{ "file_structure": [{ "kind": "dir", "name": "docs", "target": "docs" }], "files": [] }',
				"registry.json": registry,
			}),
		);
		expect(Object.keys(techStack.registry.projects)).toEqual(["app", "gone"]);
		const { data, rel } = await techStack.blueprint("projects", "app");
		expect(rel).toBe("projects/app.json");
		expect(data.files).toEqual([]);
	});

	test("classifies a missing registry entry apart from a missing blueprint file", async () => {
		const techStack = await openTechStack(memoryReader({ "registry.json": registry }));
		const entry = await techStack.blueprint("projects", "nope").catch((error: unknown) => error);
		expect(entry).toBeInstanceOf(UpstreamMissingError);
		expect((entry as UpstreamMissingError).what).toBe("entry");
		expect((entry as Error).message).toContain("Available project blueprints: app, gone.");
		const file = await techStack.blueprint("projects", "gone").catch((error: unknown) => error);
		expect((file as UpstreamMissingError).what).toBe("file");
		expect((file as UpstreamMissingError).rel).toBe("projects/gone.json");
	});

	test("an unreachable file is not a missing one", async () => {
		const techStack = await openTechStack(
			memoryReader({ "registry.json": registry }, new Set(["projects/app.json"])),
		);
		const error = await techStack.blueprint("projects", "app").catch((caught: unknown) => caught);
		expect(error).not.toBeInstanceOf(UpstreamMissingError);
	});

	test("invalid JSON names the file through the reader", async () => {
		await expect(openTechStack(memoryReader({ "registry.json": "{" }))).rejects.toThrow(
			"registry.json (memory)",
		);
	});
});

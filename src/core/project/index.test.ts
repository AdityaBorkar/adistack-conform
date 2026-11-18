import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProjectChecks } from "#/core/project/index.js";
import { memoryReader } from "#/core/upstream/memory-reader.js";
import { openTechStack } from "#/core/upstream/tech-stack.js";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })));
	dirs = [];
});

const manifest = JSON.stringify({
	file_structure: [
		{ kind: "dir", name: "docs", target: "docs" },
		{ kind: "file", name: "shadowed", target: "tsconfig.json" },
	],
	files: [
		{ name: "tsconfig", source: "projects/files/tsconfig.json", target: "tsconfig.json" },
		{ name: "gone", source: "projects/files/gone.json", target: "gone.json" },
		{ name: "down", source: "projects/files/down.json", target: "down.json" },
	],
});

async function run(onlyIds?: ReadonlySet<string>) {
	const baseDir = await mkdtemp(join(tmpdir(), "conform-project-"));
	dirs.push(baseDir);
	await mkdir(join(baseDir, "docs"));
	await Bun.write(join(baseDir, "tsconfig.json"), "{}\n");
	const techStack = await openTechStack(
		memoryReader(
			{
				"projects/app.json": manifest,
				"projects/files/tsconfig.json": "{}\n",
				"registry.json": JSON.stringify({
					github_configs: {},
					machines: {},
					projects: { app: "./projects/app.json" },
				}),
			},
			new Set(["projects/files/down.json"]),
		),
	);
	const ctx = { baseDir, home: baseDir, state: { blueprint: "app" }, strict: false, techStack };
	return runProjectChecks(ctx, onlyIds);
}

describe("runProjectChecks", () => {
	test("tells a missing upstream from an unreachable one", async () => {
		const byId = new Map((await run()).map((item) => [item.id, item]));
		expect(byId.get("project:app:tsconfig")?.ok).toBe(true);
		expect(byId.get("project:app:docs")?.ok).toBe(true);
		expect(byId.get("project:app:gone")?.actual).toBe("<blueprint file missing>");
		expect(byId.get("project:app:down")?.actual).toBe("<blueprint fetch failed>");
		// A file-structure entry on an enforced file's target is left to the file check.
		expect(byId.has("project:app:shadowed")).toBe(false);
	});

	test("a re-check narrows to the selected ids in both lists", async () => {
		const results = await run(new Set(["project:app:docs", "project:app:gone"]));
		expect(results.map((item) => item.id).toSorted()).toEqual([
			"project:app:docs",
			"project:app:gone",
		]);
	});
});

import { describe, expect, test } from "bun:test";

import type { RegistryDocument } from "#/core/upstream/registry.js";
import { blueprintRel, findEntry } from "#/core/upstream/registry.js";

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: "./machines/main.json" },
	projects: { "cli-app": "./projects/cli-app.json" },
} as unknown as RegistryDocument;

describe("findEntry projects", () => {
	test("matches the file layout by basename without .json", () => {
		expect(findEntry(registry, "projects", "cli-app")?.path).toBe("./projects/cli-app.json");
	});

	test("matches by entry key and full path", () => {
		expect(findEntry(registry, "projects", "cli-app")?.path).toBe("./projects/cli-app.json");
		expect(findEntry(registry, "projects", "projects/cli-app.json")?.path).toBe(
			"./projects/cli-app.json",
		);
		expect(findEntry(registry, "projects", "./projects/cli-app.json")?.path).toBe(
			"./projects/cli-app.json",
		);
	});

	test("basename-only lookups without an exact key do not resolve", () => {
		expect(findEntry(registry, "projects", "projects/cli-app")).toBeUndefined();
	});
});

describe("findEntry machines", () => {
	test("matches by key and full path", () => {
		expect(findEntry(registry, "machines", "main")?.path).toBe("./machines/main.json");
		expect(findEntry(registry, "machines", "machines/main.json")?.path).toBe(
			"./machines/main.json",
		);
		expect(findEntry(registry, "machines", "machines/main")).toBeUndefined();
	});
});

describe("findEntry github_configs", () => {
	test("matches by key and path", () => {
		expect(findEntry(registry, "github_configs", "npm-package")?.path).toBe(
			"./github-configs/npm-package.json",
		);
		expect(findEntry(registry, "github_configs", "github-configs/npm-package.json")?.path).toBe(
			"./github-configs/npm-package.json",
		);
	});
});

describe("blueprintRel", () => {
	test("file entries fetch the file itself", () => {
		expect(blueprintRel("./projects/cli-app.json")).toBe("projects/cli-app.json");
		expect(blueprintRel("./machines/main.json")).toBe("machines/main.json");
	});

	test("directory entries are rejected", () => {
		expect(() => blueprintRel("./projects/legacy/")).toThrow("no longer supported");
		expect(() => blueprintRel("./machines/main/")).toThrow("no longer supported");
	});

	test("interior parent segments are rejected", () => {
		expect(() => blueprintRel("projects/../../x.json")).toThrow("..");
	});
});

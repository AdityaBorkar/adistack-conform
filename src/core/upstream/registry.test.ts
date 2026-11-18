import { describe, expect, test } from "bun:test";

import type { RegistryDocument } from "#/core/upstream/registry.js";
import {
	findGithubEntry,
	findMachineEntry,
	findProjectEntry,
	blueprintRel,
	resolveSourceRel,
} from "#/core/upstream/registry.js";

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: "./machines/main.json" },
	projects: { "cli-app": "./projects/cli-app.json" },
} as unknown as RegistryDocument;

describe("findProjectEntry", () => {
	test("matches the file layout by basename without .json", () => {
		expect(findProjectEntry("cli-app", registry)?.path).toBe("./projects/cli-app.json");
	});

	test("matches by entry key and full path", () => {
		expect(findProjectEntry("cli-app", registry)?.path).toBe("./projects/cli-app.json");
		expect(findProjectEntry("projects/cli-app.json", registry)?.path).toBe(
			"./projects/cli-app.json",
		);
		expect(findProjectEntry("./projects/cli-app.json", registry)?.path).toBe(
			"./projects/cli-app.json",
		);
	});

	test("basename-only lookups without an exact key do not resolve", () => {
		expect(findProjectEntry("projects/cli-app", registry)).toBeUndefined();
	});
});

describe("findMachineEntry", () => {
	test("matches by key and full path", () => {
		expect(findMachineEntry("main", registry)?.path).toBe("./machines/main.json");
		expect(findMachineEntry("machines/main.json", registry)?.path).toBe("./machines/main.json");
		expect(findMachineEntry("machines/main", registry)).toBeUndefined();
	});
});

describe("findGithubEntry", () => {
	test("matches by key and path", () => {
		expect(findGithubEntry("npm-package", registry)?.path).toBe(
			"./github-configs/npm-package.json",
		);
		expect(findGithubEntry("github-configs/npm-package.json", registry)?.path).toBe(
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

	test("repo-relative sources pass through", () => {
		expect(resolveSourceRel("projects/files/bunfig/base.toml")).toBe(
			"projects/files/bunfig/base.toml",
		);
	});

	test("relative sources are rejected", () => {
		expect(() => resolveSourceRel("./files/bunfig.toml")).toThrow("repo-relative");
		expect(() => resolveSourceRel("../files/bunfig.toml")).toThrow("repo-relative");
	});

	test("interior parent segments are rejected", () => {
		expect(() => resolveSourceRel("projects/files/../../conform.json")).toThrow("..");
		expect(() => resolveSourceRel("projects//files/x.json")).toThrow("empty");
		expect(() => blueprintRel("projects/../../x.json")).toThrow("..");
	});
});

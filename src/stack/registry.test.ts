import { describe, expect, test } from "bun:test";

import type { RegistryDocument } from "#/stack/registry.js";
import {
	findGithubEntry,
	findMachineEntry,
	findProjectEntry,
	manifestDirRel,
	manifestRel,
	resolveSourceRel,
} from "#/stack/registry.js";

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: { name: "Primary Developer Machine", path: "./machines/main/" } },
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
		expect(findProjectEntry("projects/cli-app", registry)?.path).toBe("./projects/cli-app.json");
	});
});

describe("findMachineEntry", () => {
	test("matches by key, display name, and directory", () => {
		expect(findMachineEntry("main", registry)?.path).toBe("./machines/main/");
		expect(findMachineEntry("Primary Developer Machine", registry)?.path).toBe("./machines/main/");
		expect(findMachineEntry("machines/main", registry)?.path).toBe("./machines/main/");
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

describe("manifestRel and manifestDirRel", () => {
	test("file entries fetch the file itself", () => {
		expect(manifestRel("./projects/cli-app.json")).toBe("projects/cli-app.json");
	});

	test("directory entries are rejected", () => {
		expect(() => manifestRel("./projects/legacy/")).toThrow("no longer supported");
	});

	test("machine directories pass through", () => {
		expect(manifestDirRel("./machines/main/")).toBe("machines/main");
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
});

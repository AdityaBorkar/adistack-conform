import { describe, expect, test } from "bun:test";

import type { RegistryDocument } from "#/stack/registry.js";
import {
	findProjectEntry,
	manifestDirRel,
	manifestRel,
	resolveSourceRel,
} from "#/stack/registry.js";

const registry = {
	machines: [{ name: "main", path: "./machines/main/" }],
	projects: [{ name: "CLI", path: "./projects/cli-app.json" }],
} as unknown as RegistryDocument;

describe("findProjectEntry", () => {
	test("matches the file layout by basename without .json", () => {
		expect(findProjectEntry("cli-app", registry)?.path).toBe("./projects/cli-app.json");
	});

	test("matches by entry name and full path", () => {
		expect(findProjectEntry("CLI", registry)?.path).toBe("./projects/cli-app.json");
		expect(findProjectEntry("projects/cli-app.json", registry)?.path).toBe(
			"./projects/cli-app.json",
		);
		expect(findProjectEntry("projects/cli-app", registry)?.path).toBe("./projects/cli-app.json");
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

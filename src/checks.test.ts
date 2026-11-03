import { describe, expect, test } from "bun:test";

import { describeFix } from "#/checks.js";
import { renderDiff } from "#/diff.js";
import { checkToolchainDeps, parseLocalPackageJson } from "#/stack/deps.js";

describe("deps", () => {
	test("missing required dep is reported", () => {
		const results = checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: { "left-pad": "1.3.0" },
				devDependencies: {},
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { dependencies: {} },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.expected).toContain("@1.3.0");
	});

	test("version drift is reported", () => {
		const results = checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: { "left-pad": "2.0.0" },
				devDependencies: {},
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { dependencies: { "left-pad": "1.0.0" } },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.actual).toBe("1.0.0");
	});

	test("matching version passes", () => {
		const results = checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: {},
				devDependencies: { oxlint: "1.90.0" },
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { devDependencies: { oxlint: "1.90.0" } },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("bad package.json text is undefined", () => {
		expect(parseLocalPackageJson("{nope")).toBeUndefined();
		const absent: string | undefined = process.env["CONFORM_TEST_ABSENT"];
		expect(parseLocalPackageJson(absent)).toBeUndefined();
	});
});

describe("describeFix", () => {
	test("labels each fix kind", () => {
		expect(
			describeFix({
				actual: "",
				expected: "",
				fix: { filePath: "/x", kind: "overwrite-file", newContent: "a" },
				id: "i",
				kind: "k",
				ok: false,
				scope: "project",
				target: "t",
			}),
		).toBe("overwrite /x");
		expect(
			describeFix({
				actual: "",
				expected: "",
				fix: { args: ["a"], command: "nix", kind: "run-command", label: "l" },
				id: "i",
				kind: "k",
				ok: false,
				scope: "machine",
				target: "t",
			}),
		).toBe("run nix a");
	});
});

describe("renderDiff", () => {
	test("huge inputs are capped", () => {
		const big = "x".repeat(300_000);
		expect(renderDiff("a", "b", big, "y")).toContain("diff skipped");
	});

	test("lone carriage returns are normalized", () => {
		const out = renderDiff("a", "b", "x\ry", "x\ry");
		expect(typeof out).toBe("string");
	});
});

describe("version", () => {
	test("VERSION matches package.json", async () => {
		const indexText = await Bun.file(new URL("./index.ts", import.meta.url)).text();
		const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
			version: string;
		};
		expect(indexText).toContain(`VERSION = "${pkg.version}"`);
	});
});

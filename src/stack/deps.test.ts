import { describe, expect, test } from "bun:test";

import { checkToolchainDeps } from "#/stack/deps.js";

describe("checkToolchainDeps", () => {
	test("any version passes when installed", async () => {
		const results = await checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: { commander: "any" },
				devDependencies: {},
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { dependencies: { commander: "15.1.0" } },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("any version fails when missing, without a version pin in the hint", async () => {
		const results = await checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: { commander: "any" },
				devDependencies: {},
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { dependencies: {} },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("bun add commander");
		expect(results[0]?.hint).not.toContain("@any");
	});

	test("exact version drift still fails", async () => {
		const results = await checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: {},
				devDependencies: { oxlint: "1.92.0" },
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { devDependencies: { oxlint: "1.90.0" } },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.hint).toContain("1.92.0");
	});

	test("exact version match passes", async () => {
		const results = await checkToolchainDeps({
			blueprint: "b",
			js: {
				dependencies: {},
				devDependencies: { oxlint: "1.92.0" },
				peerDependencies: {},
				pm: "bun",
			},
			localPkg: { devDependencies: { oxlint: "1.92.0" } },
			scope: "project",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});
});

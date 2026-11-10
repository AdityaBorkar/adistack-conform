import { describe, expect, test } from "bun:test";

import { describeFix } from "#/checks.js";
import { renderDiff } from "#/diff.js";
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

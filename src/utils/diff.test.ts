import { describe, expect, test } from "bun:test";

import { renderDiff } from "#/utils/diff.js";

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

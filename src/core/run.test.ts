import { describe, expect, test } from "bun:test";

import type { CheckResult } from "#/core/result.js";
import { mergeRecheck } from "#/core/run.js";

function result(id: string, ok: boolean): CheckResult {
	return { actual: "", expected: "", id, kind: "machine", ok, scope: "machine", target: id };
}

describe("mergeRecheck", () => {
	test("replaces rechecked IDs, drops vanished selected IDs, appends new results", () => {
		const previous = [result("a", false), result("extra", false), result("other", false)];
		const rechecked = [result("a", true), result("machine:main:packages", false)];
		const merged = mergeRecheck(previous, rechecked, new Set(["a", "extra"]));
		expect(merged.map((item) => [item.id, item.ok])).toEqual([
			["a", true],
			["other", false],
			["machine:main:packages", false],
		]);
	});
});

import { describe, expect, test } from "bun:test";

import type { CheckResult, CheckScope } from "#/core/result.js";
import { mergeRecheck } from "#/core/run.js";

function result(
	id: string,
	ok: boolean,
	scope: CheckScope = "machine",
	skipped?: true,
): CheckResult {
	return {
		actual: "",
		expected: "",
		id,
		kind: scope,
		ok,
		scope,
		target: id,
		...(skipped ? { skipped } : {}),
	};
}

function summary(results: CheckResult[]): Array<[string, boolean]> {
	return results.map((item) => [item.id, item.ok]);
}

describe("mergeRecheck", () => {
	test("replaces rechecked IDs and drops a vanished selected ID (e.g. a removed extra)", () => {
		const previous = [result("a", false), result("extra", false), result("other", false)];
		const merged = mergeRecheck(previous, [result("a", true)], new Set(["a", "extra"]));
		expect(summary(merged)).toEqual([
			["a", true],
			["other", false],
		]);
	});

	test("a new domain error keeps that scope's vanished selected IDs failing", () => {
		const previous = [result("a", false), result("extra", false), result("p", false, "project")];
		const rechecked = [result("a", true), result("machine:main:packages", false)];
		const merged = mergeRecheck(previous, rechecked, new Set(["a", "extra", "p"]));
		expect(summary(merged)).toEqual([
			["a", true],
			["extra", false],
			["machine:main:packages", false],
		]);
	});

	test("a same-ID skip on re-check (e.g. a per-check GitHub 403) keeps the drift", () => {
		const previous = [result("github:b:general", false, "github")];
		const rechecked = [result("github:b:general", false, "github", true)];
		const merged = mergeRecheck(previous, rechecked, new Set(["github:b:general"]));
		expect(merged).toEqual(previous);
	});

	test("a GitHub auth skip on re-check never reads as fixed", () => {
		const previous = [result("github:b:general", false, "github")];
		const rechecked = [result("github:b:auth", false, "github", true)];
		const merged = mergeRecheck(previous, rechecked, new Set(["github:b:general"]));
		expect(summary(merged)).toEqual([
			["github:b:general", false],
			["github:b:auth", false],
		]);
	});
});

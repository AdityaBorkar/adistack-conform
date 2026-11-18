import { describe, expect, test } from "bun:test";

import type { CheckResult } from "#/core/result.js";
import { assertUniqueIds, checkBase, pass } from "#/core/result.js";

function result(name: string): CheckResult {
	return pass(checkBase("project", "app", name, name), "ok", "ok");
}

describe("checkBase", () => {
	test("ids keep their wire shape per scope (ADR 0012)", () => {
		expect(checkBase("project", "app", "tsconfig", "tsconfig.json")).toEqual({
			id: "project:app:tsconfig",
			kind: "project",
			scope: "project",
			target: "tsconfig.json",
			upstream: "tech-stack:app",
		});
		expect(checkBase("machine", "main", "link:Zshrc", "~/.zshrc").id).toBe(
			"machine:main:link:Zshrc",
		);
		expect(checkBase("machine", "main", "bun:typescript", "bun:typescript").id).toBe(
			"machine:main:bun:typescript",
		);
		expect(checkBase("github", "npm-package", "rulesets", "o/r").kind).toBe("github");
	});
});

describe("assertUniqueIds", () => {
	test("passes distinct ids through", () => {
		const results = [result("a"), result("b")];
		expect(assertUniqueIds(results)).toBe(results);
	});

	test("rejects a repeated id", () => {
		expect(() => assertUniqueIds([result("a"), result("a")])).toThrow(
			'Duplicate check result id "project:app:a"',
		);
	});
});

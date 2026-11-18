import { describe, expect, test } from "bun:test";

import { RepoRelSourceSchema } from "#/schemas/source.js";

describe("RepoRelSourceSchema", () => {
	test("accepts repo-relative paths", () => {
		expect(RepoRelSourceSchema.safeParse("projects/files/bunfig/base.toml").success).toBe(true);
	});

	test("rejects leading slash, dot prefixes, empty and dot segments, backslashes", () => {
		for (const bad of [
			"/projects/x.json",
			"./files/bunfig.toml",
			"../files/bunfig.toml",
			"projects/files/../../conform.json",
			"projects//files/x.json",
			"projects\\x.json",
		]) {
			expect(RepoRelSourceSchema.safeParse(bad).success).toBe(false);
		}
	});
});

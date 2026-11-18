import { describe, expect, test } from "bun:test";

import { resolveConfigPath } from "#/utils/fs.js";

describe("resolveConfigPath", () => {
	test("expands ~ against $HOME", () => {
		const saved = process.env["HOME"];
		try {
			process.env["HOME"] = "/tmp/conform-home-test";
			expect(resolveConfigPath("~/conform.json")).toBe("/tmp/conform-home-test/conform.json");
		} finally {
			if (saved === undefined) {
				delete process.env["HOME"];
			} else {
				process.env["HOME"] = saved;
			}
		}
	});
});

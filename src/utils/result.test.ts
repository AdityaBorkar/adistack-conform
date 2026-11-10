import { describe, expect, test } from "bun:test";

import { describeFix } from "#/utils/result.js";

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
		).toBe("run l");
	});
});

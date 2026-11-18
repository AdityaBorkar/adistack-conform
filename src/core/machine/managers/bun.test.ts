import { describe, expect, test } from "bun:test";

import { parseBunGlobalVersions } from "#/core/machine/managers/bun.js";

describe("parseBunGlobalVersions", () => {
	test("parses tree lines with name@version", () => {
		const stdout = [
			"/home/user/.bun/install/global/node_modules:",
			"├── eas-cli@1.2.3",
			"└── typescript@5.6.2",
			"",
		].join("\n");
		expect(parseBunGlobalVersions(stdout)).toEqual(
			new Map([
				["eas-cli", "1.2.3"],
				["typescript", "5.6.2"],
			]),
		);
	});

	test("keeps scoped names and skips header lines", () => {
		const stdout = ["global packages:", "  @scope/tool@0.1.0", "plain-line-without-version"].join(
			"\n",
		);
		expect(parseBunGlobalVersions(stdout)).toEqual(new Map([["@scope/tool", "0.1.0"]]));
	});

	test("empty output yields an empty map", () => {
		expect(parseBunGlobalVersions("")).toEqual(new Map());
	});
});

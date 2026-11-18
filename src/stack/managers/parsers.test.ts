import { describe, expect, test } from "bun:test";

import {
	parseBunGlobalVersions,
	parsePacmanExplicit,
	parsePacmanVersions,
	splitDeclared,
} from "#/stack/managers/parse.js";

describe("parsePacmanExplicit", () => {
	test("splits whitespace-separated names and drops blanks", () => {
		expect(parsePacmanExplicit("ripgrep\nfd\n\nbase\n")).toEqual(["ripgrep", "fd", "base"]);
		expect(parsePacmanExplicit("")).toEqual([]);
		expect(parsePacmanExplicit("  \n ")).toEqual([]);
	});
});

describe("parsePacmanVersions", () => {
	test("parses name+version lines into a map", () => {
		expect(parsePacmanVersions("ripgrep 14.1.0-1\nbase 1-1\n")).toEqual(
			new Map([
				["ripgrep", "14.1.0-1"],
				["base", "1-1"],
			]),
		);
		expect(parsePacmanVersions("")).toEqual(new Map());
	});
});

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

describe("splitDeclared", () => {
	test("missing is declared minus installed", () => {
		const { extra, missing } = splitDeclared(["b", "a"], new Set(["a"]), new Set());
		expect(missing).toEqual(["b"]);
		expect(extra).toEqual([]);
	});

	test("extra is installed minus declared minus allowlist", () => {
		const { extra } = splitDeclared(["a"], new Set(["a", "z", "base"]), new Set(["base"]));
		expect(extra).toEqual(["z"]);
	});

	test("outputs are sorted and deduplicated", () => {
		const { extra, missing } = splitDeclared(["b", "a", "b"], new Set(["z", "y"]), new Set());
		expect(missing).toEqual(["a", "b"]);
		expect(extra).toEqual(["y", "z"]);
	});
});

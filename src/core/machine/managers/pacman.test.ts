import { describe, expect, test } from "bun:test";

import { parsePacmanExplicit, parsePacmanVersions } from "#/core/machine/managers/pacman.js";

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

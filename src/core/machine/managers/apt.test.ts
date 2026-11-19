import { describe, expect, test } from "bun:test";

import { parseAptExplicit, parseAptVersions } from "#/core/machine/managers/apt.js";

describe("parseAptExplicit", () => {
	test("splits whitespace-separated names and drops blanks", () => {
		expect(parseAptExplicit("ripgrep\nfd\n\nbase\n")).toEqual(["ripgrep", "fd", "base"]);
		expect(parseAptExplicit("")).toEqual([]);
		expect(parseAptExplicit("  \n ")).toEqual([]);
	});

	test("strips :arch qualifiers so names match dpkg-query output", () => {
		expect(parseAptExplicit("ripgrep:amd64\nfd\n")).toEqual(["ripgrep", "fd"]);
	});
});

describe("parseAptVersions", () => {
	test("keeps only installed (ii) rows as name+version", () => {
		expect(parseAptVersions("ii  ripgrep  14.1.0-1\nrc  old-pkg  1.0-1\nii  base  1-1\n")).toEqual(
			new Map([
				["ripgrep", "14.1.0-1"],
				["base", "1-1"],
			]),
		);
		expect(parseAptVersions("")).toEqual(new Map());
	});
});

import { describe, expect, test } from "bun:test";

import { linkCachePath, resolveTarget } from "#/core/machine/paths.js";

describe("resolveTarget", () => {
	test("expands a leading ~ against home", () => {
		expect(resolveTarget("~/.zshrc", "/home/ada")).toBe("/home/ada/.zshrc");
		expect(resolveTarget("~", "/home/ada")).toBe("/home/ada");
	});

	test("passes absolute paths through and anchors relatives at home", () => {
		expect(resolveTarget("/etc/zshrc", "/home/ada")).toBe("/etc/zshrc");
		expect(resolveTarget(".zshrc", "/home/ada")).toBe("/home/ada/.zshrc");
	});
});

describe("linkCachePath", () => {
	test("derives the sibling materialization path from the target", () => {
		expect(linkCachePath("/home/ada/.zshrc")).toBe("/home/ada/.zshrc.conform-src");
	});
});

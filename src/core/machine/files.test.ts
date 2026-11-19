import { describe, expect, test } from "bun:test";

import { checkFiles } from "#/core/machine/files.js";

const blueprint = "main";

const file = {
	name: "Zshrc",
	source: "machines/main/files/.zshrc",
	target: "/home/ada/.zshrc",
};

describe("checkFiles", () => {
	test("missing target fails fixable with an overwrite carrying the upstream", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.resolve("content\n"),
			files: [file],
			stat: () => Promise.resolve({ kind: "missing" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:file:Zshrc");
		expect(results[0]?.kind).toBe("machine");
		expect(results[0]?.scope).toBe("machine");
		expect(results[0]?.target).toBe("/home/ada/.zshrc");
		expect(results[0]?.upstream).toBe("tech-stack:main");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toEqual({
			filePath: "/home/ada/.zshrc",
			kind: "overwrite-file",
			newContent: "content\n",
		});
	});

	test("fetch error is manual", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.reject(new Error("net down")),
			files: [file],
			stat: () => Promise.resolve({ kind: "missing" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("net down");
	});

	test("matching content passes", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.resolve("content\n"),
			files: [file],
			stat: () => Promise.resolve({ kind: "file", text: "content\n" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("differing content fails fixable with a diff", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.resolve("upstream\n"),
			files: [file],
			stat: () => Promise.resolve({ kind: "file", text: "mine\n" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.actual).toBe("mine\n");
		expect(results[0]?.expected).toBe("upstream\n");
		expect(results[0]?.fix).toEqual({
			filePath: "/home/ada/.zshrc",
			kind: "overwrite-file",
			newContent: "upstream\n",
		});
	});

	test("symlink target is fixable with a replacement hint", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.resolve("content\n"),
			files: [file],
			stat: () => Promise.resolve({ kind: "symlink" }),
		});
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix?.kind).toBe("overwrite-file");
		expect(results[0]?.hint).toContain("symlink");
	});

	test("directory target is manual, since the fix never replaces directories", async () => {
		const results = await checkFiles({
			blueprint,
			fetch: () => Promise.resolve("content\n"),
			files: [file],
			stat: () => Promise.resolve({ isFile: false, kind: "other" }),
		});
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("not a regular file");
	});
});

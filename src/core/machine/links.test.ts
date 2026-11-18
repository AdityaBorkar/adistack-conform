import { describe, expect, test } from "bun:test";

import { checkLinks } from "#/core/machine/links.js";

const blueprint = "main";
const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
	return encoder.encode(text);
}

describe("checkLinks", () => {
	const link = {
		name: "Zshrc",
		source: "machines/main/files/.zshrc",
		target: "/home/ada/.zshrc",
	};
	const cache = "/home/ada/.zshrc.conform-src";

	test("missing target fails fixable with an ln fix", async () => {
		const results = await checkLinks({
			blueprint,
			fetch: () => Promise.resolve(utf8("content")),
			links: [link],
			stat: () => Promise.resolve({ kind: "missing" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:link:Zshrc");
		expect(results[0]?.kind).toBe("machine");
		expect(results[0]?.scope).toBe("machine");
		expect(results[0]?.target).toBe("/home/ada/.zshrc");
		expect(results[0]?.upstream).toBe("tech-stack:main");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toEqual({
			cachePath: cache,
			kind: "symlink",
			label: `ln -sfn ${cache} /home/ada/.zshrc`,
			targetAbs: "/home/ada/.zshrc",
		});
	});

	test("fetch error is manual", async () => {
		const results = await checkLinks({
			blueprint,
			fetch: () => Promise.reject(new Error("net down")),
			links: [link],
			stat: () => Promise.resolve({ kind: "missing" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("net down");
	});

	test("dest-correct link with matching bytes passes", async () => {
		const results = await checkLinks({
			blueprint,
			fetch: () => Promise.resolve(utf8("content")),
			links: [link],
			stat: () => Promise.resolve({ bytes: utf8("content"), dest: cache, kind: "symlink" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("dangling link with correct dest fails fixable", async () => {
		const results = await checkLinks({
			blueprint,
			fetch: () => Promise.resolve(utf8("content")),
			links: [link],
			stat: () => Promise.resolve({ bytes: undefined, dest: cache, kind: "symlink" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.actual).toContain("dangling");
		expect(results[0]?.fix?.kind).toBe("symlink");
	});

	test("wrong dest fails fixable even when bytes match", async () => {
		const results = await checkLinks({
			blueprint,
			fetch: () => Promise.resolve(utf8("content")),
			links: [link],
			stat: () =>
				Promise.resolve({ bytes: utf8("content"), dest: "/tmp/elsewhere", kind: "symlink" }),
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toEqual({
			cachePath: cache,
			kind: "symlink",
			label: `ln -sfn ${cache} /home/ada/.zshrc`,
			targetAbs: "/home/ada/.zshrc",
		});
	});
});

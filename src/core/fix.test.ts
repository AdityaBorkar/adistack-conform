import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixSelected } from "#/core/fix.js";
import type { CheckResult } from "#/core/result.js";

const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
	console.log = () => {};
	console.error = () => {};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
});

function overwrite(id: string, filePath: string, newContent: string): CheckResult {
	return {
		actual: "<missing>",
		expected: newContent,
		fix: { filePath, kind: "overwrite-file", newContent },
		id,
		kind: "project",
		ok: false,
		scope: "project",
		target: "f.json",
		upstream: "tech-stack:b",
	};
}

describe("fixSelected", () => {
	test("writes a backup and dedupes identical same-file fixes", async () => {
		const filePath = join(tmpdir(), `conform-fix-${process.pid}-${Date.now()}`, "sub", "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		const fixed = await fixSelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":2}\n'),
		]);
		expect(fixed).toHaveLength(2);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
	});

	test("reports conflicting same-file fixes instead of last-wins", async () => {
		const filePath = join(tmpdir(), `conform-fix-conflict-${process.pid}-${Date.now()}`, "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		const fixed = await fixSelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":3}\n'),
		]);
		expect(fixed).toHaveLength(1);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
	});

	test("ln fix backs up a regular file before linking", async () => {
		const dir = join(tmpdir(), `conform-fix-ln-${process.pid}-${Date.now()}`);
		const target = join(dir, ".zshrc");
		const cache = `${target}.conform-src`;
		await Bun.write(cache, "upstream\n");
		await Bun.write(target, "mine\n");
		const fixed = await fixSelected([
			{
				actual: "<regular file or directory>",
				expected: `symlink to ${cache}`,
				fix: {
					cachePath: cache,
					kind: "symlink",
					label: `ln -sfn ${cache} ${target}`,
					targetAbs: target,
				},
				id: "machine:main:link:Zshrc",
				kind: "machine",
				ok: false,
				scope: "machine",
				target,
				upstream: "tech-stack:main",
			},
		]);
		expect(fixed).toHaveLength(1);
		expect(await Bun.file(`${target}.conform.bak`).text()).toBe("mine\n");
		const dest = await (await import("node:fs/promises")).readlink(target);
		expect(dest).toBe(cache);
	});

	test("second run never overwrites the first backup", async () => {
		const filePath = join(tmpdir(), `conform-fix-backup-${process.pid}-${Date.now()}`, "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		expect(await fixSelected([overwrite("project:b:one", filePath, '{"a":2}\n')])).toHaveLength(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await fixSelected([overwrite("project:b:two", filePath, '{"a":3}\n')])).toHaveLength(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await Bun.file(`${filePath}.conform.bak.1`).text()).toBe('{"a":2}\n');
		expect(await Bun.file(filePath).text()).toBe('{"a":3}\n');
	});
});

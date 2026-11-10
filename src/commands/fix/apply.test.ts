import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applySelected } from "#/commands/fix/apply.js";
import type { CheckResult } from "#/utils/result.js";

function overwrite(id: string, filePath: string, newContent: string): CheckResult {
	return {
		actual: "<missing>",
		expected: newContent,
		fix: { filePath, kind: "overwrite-file", newContent },
		id,
		kind: "project",
		ok: false,
		scope: "project",
		source: "tech-stack:b",
		target: "f.json",
	};
}

describe("applySelected", () => {
	test("writes a backup and dedupes identical same-file fixes", async () => {
		const filePath = join(tmpdir(), `conform-apply-${process.pid}-${Date.now()}`, "sub", "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		const applied = await applySelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":2}\n'),
		]);
		expect(applied).toBe(2);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
	});

	test("reports conflicting same-file fixes instead of last-wins", async () => {
		const filePath = join(
			tmpdir(),
			`conform-apply-conflict-${process.pid}-${Date.now()}`,
			"f.json",
		);
		await Bun.write(filePath, '{"a":1}\n');
		const applied = await applySelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":3}\n'),
		]);
		expect(applied).toBe(1);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
	});

	test("second run never overwrites the first backup", async () => {
		const filePath = join(tmpdir(), `conform-apply-backup-${process.pid}-${Date.now()}`, "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		expect(await applySelected([overwrite("project:b:one", filePath, '{"a":2}\n')])).toBe(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await applySelected([overwrite("project:b:two", filePath, '{"a":3}\n')])).toBe(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await Bun.file(`${filePath}.conform.bak.1`).text()).toBe('{"a":2}\n');
		expect(await Bun.file(filePath).text()).toBe('{"a":3}\n');
	});
});

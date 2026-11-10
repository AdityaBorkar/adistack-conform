import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPresetFileWithGolden } from "#/stack/check.js";

function tmp(name: string): string {
	return join(tmpdir(), `conform-test-${process.pid}-${name}`);
}

describe("checkPresetFileWithGolden", () => {
	test("blank golden never truncates an existing file", async () => {
		const path = tmp("kept.json");
		await Bun.write(path, '{"keep":true}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "f.json",
			fileTarget: "f.json",
			golden: "   \n",
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
		expect(await Bun.file(path).text()).toBe('{"keep":true}\n');
	});

	test("blank golden with missing file passes", async () => {
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "f.json",
			fileTarget: "f.json",
			golden: "",
			scope: "project",
			sourceLabel: "s",
			targetPath: tmp("definitely-missing-xyz.json"),
		});
		expect(result.ok).toBe(true);
	});

	test("missing file offers golden content", async () => {
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "f.json",
			fileTarget: "f.json",
			golden: '{"a":1}\n',
			scope: "project",
			sourceLabel: "s",
			targetPath: tmp("missing-abc.json"),
		});
		expect(result.ok).toBe(false);
		expect(result.fix?.kind).toBe("overwrite-file");
	});

	test("added preset dep is flagged and merged", async () => {
		const path = tmp("pkg.json");
		await Bun.write(path, '{"deps":{"a":"1.0.0"}}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			compare: { ignore: [], pinned: [], strip: [], versioned: ["deps"] },
			fileName: "package.json",
			fileTarget: "package.json",
			golden: '{"deps":{"a":"1.0.0","b":"2.0.0"}}\n',
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.expected).toContain("2.0.0");
		if (result.fix?.kind === "overwrite-file") {
			expect(result.fix.newContent).toContain('"b": "2.0.0"');
		} else {
			throw new Error("expected overwrite fix");
		}
	});

	test("ignore keeps local value", async () => {
		const path = tmp("ignored.json");
		await Bun.write(path, '{"keep":"local","same":1}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			compare: { ignore: ["keep"], pinned: [], strip: [], versioned: [] },
			fileName: "f.json",
			fileTarget: "f.json",
			golden: '{"keep":"golden","same":1}\n',
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("template byte-identical copy fails as unadapted", async () => {
		const golden =
			'{"name":"<package-name>","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n';
		const path = tmp("verbatim-pkg.json");
		await Bun.write(path, golden);
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			compare: { ignore: [], pinned: ["scripts", "type"], strip: [], versioned: [] },
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.fix).toBeUndefined();
		expect(result.actual).toContain("<package-name>");
	});

	test("adapted template passes when pinned keys match", async () => {
		const golden =
			'{"name":"<package-name>","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n';
		const path = tmp("adapted-pkg.json");
		await Bun.write(
			path,
			'{"name":"my-pkg","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n',
		);
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			compare: { ignore: [], pinned: ["scripts", "type"], strip: [], versioned: [] },
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("template pinned drift stays fixable without reintroducing placeholders", async () => {
		const golden =
			'{"name":"<package-name>","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n';
		const path = tmp("drifted-pkg.json");
		await Bun.write(path, '{"name":"my-pkg","type":"module","scripts":{"build":"old"}}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			compare: { ignore: [], pinned: ["scripts", "type"], strip: [], versioned: [] },
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		if (result.fix?.kind !== "overwrite-file") {
			throw new Error("expected overwrite fix");
		}
		expect(result.fix.newContent).toContain("my-pkg");
		expect(result.fix.newContent).toContain("bun ./scripts/build.ts");
		expect(result.fix.newContent).not.toContain("<package-name>");
	});
});

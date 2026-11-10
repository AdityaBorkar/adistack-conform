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
			compare: { ignore: [], strip: [], versioned: ["deps"] },
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
			compare: { ignore: ["keep"], strip: [], versioned: [] },
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

	test("adapted template passes when placeholders are replaced", async () => {
		const golden =
			'{"name":"<package-name>","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n';
		const path = tmp("adapted-pkg.json");
		await Bun.write(
			path,
			'{"name":"my-pkg","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n',
		);
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("template fixed fields must match the golden", async () => {
		const golden =
			'{"name":"<package-name>","type":"module","scripts":{"build":"bun ./scripts/build.ts"}}\n';
		const path = tmp("drifted-pkg.json");
		await Bun.write(path, '{"name":"my-pkg","type":"module","scripts":{"build":"old"}}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.fix).toBeUndefined();
		expect(result.actual).toContain("scripts.build differs from the preset");
	});

	test("placeholders accept per-project values", async () => {
		const golden = '{"name":"<package-name>","type":"module"}\n';
		const path = tmp("required-ok.json");
		await Bun.write(path, '{"name":"my-pkg","type":"module"}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("placeholders fail manual when missing", async () => {
		const golden = '{"name":"<package-name>","type":"module"}\n';
		const path = tmp("required-missing.json");
		await Bun.write(path, '{"type":"module"}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.fix).toBeUndefined();
		expect(result.actual).toContain("name is missing");
	});

	test("placeholders fail manual when empty or left in place", async () => {
		const golden = '{"name":"<package-name>","keywords":["<keyword>"]}\n';
		const emptyPath = tmp("required-empty.json");
		await Bun.write(emptyPath, '{"name":"","keywords":["real"]}\n');
		const emptyResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: emptyPath,
		});
		expect(emptyResult.ok).toBe(false);
		expect(emptyResult.fix).toBeUndefined();
		expect(emptyResult.actual).toContain("name needs a per-project value");

		const placeholderPath = tmp("required-placeholder.json");
		await Bun.write(placeholderPath, '{"name":"<something-else>","keywords":["real"]}\n');
		const placeholderResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: placeholderPath,
		});
		expect(placeholderResult.ok).toBe(false);
		expect(placeholderResult.fix).toBeUndefined();
		expect(placeholderResult.actual).toContain("still holds placeholders");
	});

	test("placeholders fail manual on type mismatch", async () => {
		const golden = '{"keywords":["<keyword>"]}\n';
		const path = tmp("required-type.json");
		await Bun.write(path, '{"keywords":"not-an-array"}\n');
		const result = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.fix).toBeUndefined();
		expect(result.actual).toContain("keywords should be an array");
	});

	test("partial placeholders match surrounding text", async () => {
		const golden =
			'{"homepage":"https://github.com/<owner>/<repo>#readme","name":"<package-name>"}\n';
		const okPath = tmp("partial-ok.json");
		await Bun.write(okPath, '{"homepage":"https://github.com/acme/pkg#readme","name":"pkg"}\n');
		const okResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: okPath,
		});
		expect(okResult.ok).toBe(true);

		const badPath = tmp("partial-bad.json");
		await Bun.write(badPath, '{"homepage":"https://example.com/other","name":"pkg"}\n');
		const badResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: badPath,
		});
		expect(badResult.ok).toBe(false);
		expect(badResult.fix).toBeUndefined();
		expect(badResult.actual).toContain("homepage does not match the preset template");
	});

	test("placeholder keys accept per-project names", async () => {
		const golden = '{"bin":{"<binary-name>":"./.output/<binary-name>"},"type":"module"}\n';
		const okPath = tmp("key-ok.json");
		await Bun.write(okPath, '{"bin":{"my-cli":"./.output/my-cli"},"type":"module"}\n');
		const okResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: okPath,
		});
		expect(okResult.ok).toBe(true);

		const missingPath = tmp("key-missing.json");
		await Bun.write(missingPath, '{"bin":{},"type":"module"}\n');
		const missingResult = await checkPresetFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: missingPath,
		});
		expect(missingResult.ok).toBe(false);
		expect(missingResult.fix).toBeUndefined();
		expect(missingResult.actual).toContain("bin.<binary-name> needs a per-project value");
	});
});

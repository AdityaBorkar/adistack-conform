import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkProjectFileWithGolden } from "#/stack/project-compare.js";

function tmp(name: string): string {
	return join(tmpdir(), `conform-test-${process.pid}-${name}`);
}

describe("checkProjectFileWithGolden", () => {
	test("missing file offers golden content", async () => {
		const result = await checkProjectFileWithGolden({
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

	test("ignore keeps local value", async () => {
		const path = tmp("ignored.json");
		await Bun.write(path, '{"keep":"local","same":1}\n');
		const result = await checkProjectFileWithGolden({
			blueprint: "b",
			compare: { ignore: ["keep"] },
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
		const result = await checkProjectFileWithGolden({
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
		const result = await checkProjectFileWithGolden({
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
		const result = await checkProjectFileWithGolden({
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
		expect(result.actual).toContain("scripts.build differs from the golden");
	});

	test("placeholders accept per-project values", async () => {
		const golden = '{"name":"<package-name>","type":"module"}\n';
		const path = tmp("required-ok.json");
		await Bun.write(path, '{"name":"my-pkg","type":"module"}\n');
		const result = await checkProjectFileWithGolden({
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
		const result = await checkProjectFileWithGolden({
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
		const emptyResult = await checkProjectFileWithGolden({
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
		const placeholderResult = await checkProjectFileWithGolden({
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
		const result = await checkProjectFileWithGolden({
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
		const okResult = await checkProjectFileWithGolden({
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
		const badResult = await checkProjectFileWithGolden({
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
		expect(badResult.actual).toContain("homepage does not match the template");
	});

	test("placeholder keys accept per-project names", async () => {
		const golden = '{"bin":{"<binary-name>":"./.output/<binary-name>"},"type":"module"}\n';
		const okPath = tmp("key-ok.json");
		await Bun.write(okPath, '{"bin":{"my-cli":"./.output/my-cli"},"type":"module"}\n');
		const okResult = await checkProjectFileWithGolden({
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
		const missingResult = await checkProjectFileWithGolden({
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

	test("template honors compare.ignore keys", async () => {
		const golden = '{"name":"<package-name>","cfg":{"a":1}}\n';
		const ignoredPath = tmp("template-ignore.json");
		await Bun.write(ignoredPath, '{"name":"my-pkg","cfg":{"a":2}}\n');
		const ignored = await checkProjectFileWithGolden({
			blueprint: "b",
			compare: { ignore: ["cfg"] },
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: ignoredPath,
		});
		expect(ignored.ok).toBe(true);

		const strictPath = tmp("template-no-ignore.json");
		await Bun.write(strictPath, '{"name":"my-pkg","cfg":{"a":2}}\n');
		const strict = await checkProjectFileWithGolden({
			blueprint: "b",
			fileName: "Package JSON",
			fileTarget: "package.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: strictPath,
		});
		expect(strict.ok).toBe(false);
	});

	test("array-root template goldens compare element-wise, never overwrite", async () => {
		const golden = '["<step>"]\n';
		const okPath = tmp("array-template-ok.json");
		await Bun.write(okPath, '["build"]\n');
		const okResult = await checkProjectFileWithGolden({
			blueprint: "b",
			fileName: "steps.json",
			fileTarget: "steps.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: okPath,
		});
		expect(okResult.ok).toBe(true);

		const verbatimPath = tmp("array-template-verbatim.json");
		await Bun.write(verbatimPath, golden);
		const verbatimResult = await checkProjectFileWithGolden({
			blueprint: "b",
			fileName: "steps.json",
			fileTarget: "steps.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: verbatimPath,
		});
		expect(verbatimResult.ok).toBe(false);
		expect(verbatimResult.fix).toBeUndefined();
	});

	test("compare.ignore with a non-JSON golden fails manual, never overwrites", async () => {
		const path = tmp("ignore-text.md");
		await Bun.write(path, "# local title\n");
		const result = await checkProjectFileWithGolden({
			blueprint: "b",
			compare: { ignore: ["keep"] },
			fileName: "doc.md",
			fileTarget: "doc.md",
			golden: "# golden title\n",
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(false);
		expect(result.fix).toBeUndefined();
	});

	test("angle brackets inside a larger value are not leftover placeholders", async () => {
		const golden = '{"desc":"<desc>"}\n';
		const path = tmp("angle-ok.json");
		await Bun.write(path, '{"desc":"Use Array<T> here"}\n');
		const result = await checkProjectFileWithGolden({
			blueprint: "b",
			fileName: "doc.json",
			fileTarget: "doc.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("template backtracks past repeated suffixes", async () => {
		const golden = '{"v":"a<x>aa"}\n';
		const path = tmp("template-backtrack.json");
		await Bun.write(path, '{"v":"aaaaa"}\n');
		const result = await checkProjectFileWithGolden({
			blueprint: "b",
			fileName: "doc.json",
			fileTarget: "doc.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});

	test("compare.ignore keeps extra local keys and still passes", async () => {
		const golden = '{"keep":"golden","same":1}\n';
		const path = tmp("ignore-extra.json");
		await Bun.write(path, '{"keep":"local","same":1,"extra":2}\n');
		const result = await checkProjectFileWithGolden({
			blueprint: "b",
			compare: { ignore: ["keep"] },
			fileName: "doc.json",
			fileTarget: "doc.json",
			golden,
			scope: "project",
			sourceLabel: "s",
			targetPath: path,
		});
		expect(result.ok).toBe(true);
	});
});

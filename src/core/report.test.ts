import { afterEach, describe, expect, test } from "bun:test";

import { printJsonSummary, renderFixDiffs } from "#/core/report.js";
import type { CheckResult } from "#/core/result.js";

const secretResult: CheckResult = {
	actual: "<redacted: 17 chars with secrets>",
	expected: "<redacted: 17 chars with secrets>",
	fix: {
		filePath: "/home/ada/.npmrc",
		kind: "overwrite-file",
		mode: "0600",
		newContent: "token=s3cr3t-new\n",
		secret: true,
	},
	id: "machine:main:secrets-template:Npmrc",
	kind: "machine",
	ok: false,
	scope: "machine",
	target: "/home/ada/.npmrc",
};

const originalLog = console.log;
const originalWrite = process.stdout.write.bind(process.stdout);

afterEach(() => {
	console.log = originalLog;
	process.stdout.write = originalWrite;
});

function capture(run: () => void): string {
	let out = "";
	console.log = (...args: unknown[]) => {
		out += `${args.join(" ")}\n`;
	};
	process.stdout.write = ((chunk: string) => {
		out += chunk;
		return true;
	}) as typeof process.stdout.write;
	run();
	return out;
}

describe("secret fixes", () => {
	test("JSON summary and diff preview never print the secret content", () => {
		const json = capture(() => printJsonSummary("/p/conform.json", [secretResult]));
		const diff = capture(() => renderFixDiffs([secretResult]));
		expect(json).not.toContain("s3cr3t");
		expect(diff).not.toContain("s3cr3t");
		expect(diff).toContain("diff hidden");
	});
});

describe("link fixes", () => {
	test("JSON summary leaves the link bytes out", () => {
		const link: CheckResult = {
			actual: "<missing>",
			expected: "symlink to /h/.zshrc.conform-src",
			fix: {
				cachePath: "/h/.zshrc.conform-src",
				content: new TextEncoder().encode("bytes"),
				kind: "symlink",
				label: "link /h/.zshrc -> /h/.zshrc.conform-src",
				targetAbs: "/h/.zshrc",
			},
			id: "machine:main:link:Zshrc",
			kind: "machine",
			ok: false,
			scope: "machine",
			target: "/h/.zshrc",
		};
		const parsed = JSON.parse(capture(() => printJsonSummary("/p/conform.json", [link]))) as {
			results: Array<{ fix: Record<string, unknown> }>;
		};
		expect(parsed.results[0]?.fix).toEqual({
			cachePath: "/h/.zshrc.conform-src",
			kind: "symlink",
			label: "link /h/.zshrc -> /h/.zshrc.conform-src",
			targetAbs: "/h/.zshrc",
		});
	});
});

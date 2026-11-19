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

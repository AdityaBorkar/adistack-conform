import { describe, expect, test } from "bun:test";

import { parseSimpleMapping } from "#/core/machine/live.js";
import { machineSecretsRel } from "#/core/upstream/blueprint.js";

describe("parseSimpleMapping", () => {
	test("reads flat KEY: value lines, unquoting values and skipping comments/markers", () => {
		const text = [
			"---",
			"# comment",
			"NPM_AUTH_TOKEN: abc",
			'AWS_KEY_1: "q v"',
			"MY_KEY: 'x'",
			"",
		].join("\n");
		expect(parseSimpleMapping(text)).toEqual({
			AWS_KEY_1: "q v",
			MY_KEY: "x",
			NPM_AUTH_TOKEN: "abc",
		});
	});

	test("nested or indented lines throw instead of rendering empty values", () => {
		expect(() => parseSimpleMapping("PARENT:\n  CHILD: x\n")).toThrow("line 2");
		expect(() => parseSimpleMapping("-BAD: x\n")).toThrow("Unsupported secrets line 1");
	});

	test("lowercase, dotted, and dashed keys throw instead of rendering empty values", () => {
		for (const line of ["npm_auth_token: x", "npm-token: x", "a.b: x", "__proto__: x"]) {
			expect(() => parseSimpleMapping(`${line}\n`)).toThrow("Unsupported secrets line 1");
		}
	});

	test("CAPITAL keys become own keys, never the prototype", () => {
		const values = parseSimpleMapping("MY_KEY: x\n");
		expect(Object.hasOwn(values, "MY_KEY")).toBe(true);
		expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
	});
});

describe("machineSecretsRel", () => {
	test("sits next to the manifest", () => {
		expect(machineSecretsRel("machines/main.json")).toBe("machines/secrets.yaml");
		expect(machineSecretsRel("main.json")).toBe("secrets.yaml");
	});
});

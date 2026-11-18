import { describe, expect, test } from "bun:test";

import { parseSimpleMapping } from "#/core/machine/live.js";
import { machineSecretsRel } from "#/core/upstream/blueprint.js";

describe("parseSimpleMapping", () => {
	test("reads flat KEY: value lines, unquoting values and skipping comments/markers", () => {
		const text = [
			"---",
			"# comment",
			"npm_auth_token: abc",
			'npm-token: "q v"',
			"dotted.key: 'x'",
			"",
		].join("\n");
		expect(parseSimpleMapping(text)).toEqual({
			"dotted.key": "x",
			npm_auth_token: "abc",
			"npm-token": "q v",
		});
	});

	test("nested or indented lines throw instead of rendering empty values", () => {
		expect(() => parseSimpleMapping("parent:\n  child: x\n")).toThrow("line 2");
		expect(() => parseSimpleMapping("-bad: x\n")).toThrow("Unsupported secrets line 1");
	});

	test("__proto__ becomes an own key, never the prototype", () => {
		const values = parseSimpleMapping("__proto__: x\n");
		expect(Object.hasOwn(values, "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
	});
});

describe("machineSecretsRel", () => {
	test("sits next to the manifest", () => {
		expect(machineSecretsRel("machines/main.json")).toBe("machines/secrets.yaml");
		expect(machineSecretsRel("main.json")).toBe("secrets.yaml");
	});
});

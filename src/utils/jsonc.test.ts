import { describe, expect, test } from "bun:test";

import { parseJsonc } from "#/utils/jsonc.js";

describe("parseJsonc", () => {
	test("trailing comma before a comment is allowed", () => {
		expect(parseJsonc('{"a":1, /* note */}')).toEqual({ a: 1 });
		expect(parseJsonc('{"a":1,\n// note\n}')).toEqual({ a: 1 });
	});

	test("unterminated block comment throws", () => {
		expect(() => parseJsonc('{"a":1} /* oops')).toThrow("Unterminated block comment");
	});
});

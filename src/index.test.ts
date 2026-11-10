import { describe, expect, test } from "bun:test";

describe("version", () => {
	test("VERSION matches package.json", async () => {
		const indexText = await Bun.file(new URL("./index.ts", import.meta.url)).text();
		const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
			version: string;
		};
		expect(indexText).toContain(`VERSION = "${pkg.version}"`);
	});
});

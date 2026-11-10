import { describe, expect, test } from "bun:test";

describe("version", () => {
	test("build injects package.json version", async () => {
		const buildText = await Bun.file(new URL("../scripts/build.ts", import.meta.url)).text();
		expect(buildText).toContain("CONFORM_VERSION");
		const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
			version: string;
		};
		expect(typeof pkg.version).toBe("string");
		const indexText = await Bun.file(new URL("./index.ts", import.meta.url)).text();
		expect(indexText).toContain("packageVersion()");
	});
});

import { describe, expect, test } from "bun:test";

import { MachineManifestSchema } from "#/schemas/machine-manifest.js";

describe("MachineManifestSchema", () => {
	test("valid minimal manifest passes with defaults", () => {
		const result = MachineManifestSchema.safeParse({
			packages: { bun: { "eas-cli": "latest" }, pacman: { ripgrep: "14.1.0-1" } },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.system).toBe("x86_64-linux");
			expect(result.data.params).toEqual([]);
			expect(result.data.allowlist).toEqual({});
		}
	});

	test("unknown manager key fails", () => {
		const result = MachineManifestSchema.safeParse({
			packages: { apt: { ripgrep: "latest" } },
		});
		expect(result.success).toBe(false);
	});

	test("blank version fails", () => {
		const result = MachineManifestSchema.safeParse({
			packages: { pacman: { ripgrep: "" } },
		});
		expect(result.success).toBe(false);
	});

	test("bad file sources fail", () => {
		for (const source of ["../x", "/x", "a//b"]) {
			const result = MachineManifestSchema.safeParse({
				files: [{ name: "Zshrc", source, target: "~/.zshrc" }],
			});
			expect(result.success).toBe(false);
		}
	});

	test("empty manifest fails", () => {
		expect(MachineManifestSchema.safeParse({}).success).toBe(false);
	});

	test("file mode other than 0600/0644 fails", () => {
		const result = MachineManifestSchema.safeParse({
			files: [
				{
					mode: "0755",
					name: "Npmrc",
					secrets: ["npm_auth_token"],
					source: "machines/main/files/.npmrc",
					target: "~/.npmrc",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test("file without secrets links (mode optional)", () => {
		const result = MachineManifestSchema.safeParse({
			files: [{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" }],
		});
		expect(result.success).toBe(true);
	});

	test("mode on a link file fails", () => {
		const result = MachineManifestSchema.safeParse({
			files: [
				{ mode: "0600", name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" },
			],
		});
		expect(result.success).toBe(false);
	});

	test("empty secrets list fails", () => {
		const result = MachineManifestSchema.safeParse({
			files: [
				{
					name: "Npmrc",
					secrets: [],
					source: "machines/main/files/.npmrc",
					target: "~/.npmrc",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test("duplicate file names fail", () => {
		const result = MachineManifestSchema.safeParse({
			files: [
				{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" },
				{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" },
			],
		});
		expect(result.success).toBe(false);
	});

	test("unknown top-level key fails", () => {
		const result = MachineManifestSchema.safeParse({
			packages: { pacman: { ripgrep: "latest" } },
			surprise: true,
		});
		expect(result.success).toBe(false);
	});
});

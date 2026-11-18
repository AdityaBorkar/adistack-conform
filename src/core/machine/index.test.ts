import { describe, expect, test } from "bun:test";

import type { MachineRunState } from "#/core/config.js";
import { checkMachine, recheckMachineSelected } from "#/core/machine/index.js";
import type { MachineCheckInput, MachineLive } from "#/core/machine/index.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
	return encoder.encode(text);
}

function fakeLive(overrides: Partial<MachineLive> = {}): MachineLive {
	return {
		decryptSecrets: () => Promise.resolve({}),
		fetchSource: () => Promise.resolve(utf8("content")),
		fetchText: () => Promise.resolve("content"),
		listBun: () => Promise.resolve({ explicit: new Set<string>(), versions: new Map() }),
		listPacman: () => Promise.resolve({ explicit: new Set<string>(), versions: new Map() }),
		readTemplateTarget: () => Promise.resolve({ exists: false }),
		statLink: () => Promise.resolve({ kind: "missing" }),
		...overrides,
	};
}

function manifest(overrides: Partial<MachineManifest> = {}): MachineManifest {
	return {
		allowlist: {},
		files: [],
		packages: { bun: {}, pacman: { ripgrep: "latest" } },
		...overrides,
	};
}

function installed(names: string[]): { explicit: Set<string>; versions: Map<string, string> } {
	return {
		explicit: new Set(names),
		versions: new Map(names.map((name) => [name, "1.0.0-1"] as const)),
	};
}

function input(overrides: Partial<MachineCheckInput> = {}): MachineCheckInput {
	return {
		blueprint: "main",
		home: "/home/ada",
		live: fakeLive({ listPacman: () => Promise.resolve(installed(["ripgrep"])) }),
		manifest: manifest(),
		strict: false,
		...overrides,
	};
}

describe("checkMachine packages", () => {
	test("non-strict: extras are skipped", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({ listPacman: () => Promise.resolve(installed(["ripgrep", "extra-pkg"])) }),
			}),
		);
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.skipped).toBe(true);
		expect(extra?.fix).toBeUndefined();
		expect(extra?.ok).toBe(false);
	});

	test("strict: extras are fixable", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({ listPacman: () => Promise.resolve(installed(["ripgrep", "extra-pkg"])) }),
				strict: true,
			}),
		);
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.skipped).toBeUndefined();
		expect(extra?.ok).toBe(false);
		expect(extra?.fix).toEqual({
			args: ["pacman", "-Rs", "--noconfirm", "extra-pkg"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -Rs --noconfirm extra-pkg",
		});
	});

	test("missing package is fixable strict or not", async () => {
		const runs = await Promise.all(
			([false, true] as const).map((strict) => checkMachine(input({ live: fakeLive(), strict }))),
		);
		for (const results of runs) {
			const missing = results.find((item) => item.id === "machine:main:pacman:ripgrep");
			expect(missing?.ok).toBe(false);
			expect(missing?.fix?.kind).toBe("run-command");
		}
	});
});

describe("checkMachine links", () => {
	test("missing link is fixable with an ln label pointing at .conform-src", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive(),
				manifest: manifest({
					files: [{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" }],
					packages: { bun: {}, pacman: {} },
				}),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:link:Zshrc");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix?.kind).toBe("symlink");
		if (results[0]?.fix?.kind === "symlink") {
			expect(results[0].fix.label).toContain(".conform-src");
		}
	});
});

describe("checkMachine templates", () => {
	test("undecryptable secrets are manual", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({ decryptSecrets: () => Promise.reject(new Error("sops: no age key")) }),
				manifest: manifest({
					files: [
						{
							mode: "0600",
							name: "Npmrc",
							secrets: ["npm_auth_token"],
							source: "machines/main/files/.npmrc",
							target: "~/.npmrc",
						},
					],
					packages: { bun: {}, pacman: {} },
				}),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:template:Npmrc");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("sops");
	});
});

describe("recheckMachineSelected", () => {
	test("empty selection short-circuits without network", async () => {
		const state: MachineRunState = { blueprint: "main", id: "o/r", ref: "main" };
		const results = await recheckMachineSelected(
			state,
			{} as RegistryDocument,
			new Set<string>(),
			false,
		);
		expect(results).toEqual([]);
	});
});

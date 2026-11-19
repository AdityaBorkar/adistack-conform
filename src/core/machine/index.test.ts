import { describe, expect, test } from "bun:test";

import { checkMachine } from "#/core/machine/index.js";
import type { MachineCheckInput, MachineLive } from "#/core/machine/index.js";
import { systemManagerForOsRelease } from "#/core/machine/os.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";

function fakeLive(overrides: Partial<MachineLive> = {}): MachineLive {
	return {
		decryptSecrets: () => Promise.resolve({}),
		detectSystemManager: () => Promise.resolve("pacman"),
		fetchSource: () => Promise.resolve("content"),
		fetchText: () => Promise.resolve("content"),
		listPackages: () => Promise.resolve({ explicit: new Set<string>(), versions: new Map() }),
		readSecretsTemplateTarget: () => Promise.resolve({ exists: false }),
		statFile: () => Promise.resolve({ kind: "missing" }),
		...overrides,
	};
}

function manifest(overrides: Partial<MachineManifest> = {}): MachineManifest {
	return {
		allowlist: {},
		files: [],
		packages: { apt: {}, bun: {}, pacman: { ripgrep: "latest" } },
		...overrides,
	};
}

function installed(names: string[]): { explicit: Set<string>; versions: Map<string, string> } {
	return {
		explicit: new Set(names),
		versions: new Map(names.map((name) => [name, "1.0.0-1"] as const)),
	};
}

function pacmanOnly(names: string[]): MachineLive["listPackages"] {
	return (manager) => Promise.resolve(installed(manager === "pacman" ? names : []));
}

function input(overrides: Partial<MachineCheckInput> = {}): MachineCheckInput {
	return {
		blueprint: "main",
		home: "/home/ada",
		live: fakeLive({ listPackages: pacmanOnly(["ripgrep"]) }),
		manifest: manifest(),
		skipSecrets: false,
		strict: false,
		...overrides,
	};
}

describe("checkMachine packages", () => {
	test("non-strict: extras are skipped", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({ listPackages: pacmanOnly(["ripgrep", "extra-pkg"]) }),
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
				live: fakeLive({ listPackages: pacmanOnly(["ripgrep", "extra-pkg"]) }),
				strict: true,
			}),
		);
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.skipped).toBeUndefined();
		expect(extra?.ok).toBe(false);
		expect(extra?.fix).toEqual({
			args: ["pacman", "-Rs", "--noconfirm", "--", "extra-pkg"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -Rs --noconfirm -- extra-pkg",
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

	test("debian runs apt plus bun and ignores pacman", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({
					detectSystemManager: () => Promise.resolve("apt"),
					listPackages: (manager) =>
						Promise.resolve(installed(manager === "apt" ? ["ripgrep"] : [])),
				}),
				manifest: manifest({
					packages: {
						apt: { ripgrep: "latest" },
						bun: {},
						pacman: { "should-be-ignored": "latest" },
					},
				}),
			}),
		);
		expect(results.find((item) => item.id === "machine:main:apt:ripgrep")?.ok).toBe(true);
		expect(results.some((item) => item.id.includes("should-be-ignored"))).toBe(false);
		expect(results.some((item) => item.id === "machine:main:packages:system")).toBe(false);
	});

	test("unsupported distros check bun only and warn instead of failing", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({
					detectSystemManager: () => Promise.resolve(systemManagerForOsRelease("ID=fedora\n")),
					listPackages: (manager) =>
						Promise.resolve(installed(manager === "bun" ? ["eas-cli"] : [])),
				}),
				manifest: manifest({
					packages: {
						apt: { "apt-pkg": "latest" },
						bun: { "eas-cli": "latest" },
						pacman: { "pacman-pkg": "latest" },
					},
				}),
			}),
		);
		const warning = results.find((item) => item.id === "machine:main:packages:system");
		expect(warning?.skipped).toBe(true);
		expect(warning?.actual).toBe(
			"It seems you have not defined any system packages OR your OS Distro is not supported.",
		);
		expect(results.some((item) => item.id.includes("apt-pkg"))).toBe(false);
		expect(results.some((item) => item.id.includes("pacman-pkg"))).toBe(false);
		expect(results.find((item) => item.id === "machine:main:bun:eas-cli")?.ok).toBe(true);
	});
});

describe("checkMachine files", () => {
	test("missing file is fixable with an overwrite carrying the upstream", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive(),
				manifest: manifest({
					files: [{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" }],
					packages: { apt: {}, bun: {}, pacman: {} },
				}),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:file:Zshrc");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix?.kind).toBe("overwrite-file");
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
							secrets: ["NPM_AUTH_TOKEN"],
							source: "machines/main/files/.npmrc",
							target: "~/.npmrc",
						},
					],
					packages: { apt: {}, bun: {}, pacman: {} },
				}),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:secrets-template:Npmrc");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("sops");
	});

	test("skipSecrets checks structure without decrypting", async () => {
		const results = await checkMachine(
			input({
				live: fakeLive({
					decryptSecrets: () => Promise.reject(new Error("must not decrypt")),
					fetchText: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
					readSecretsTemplateTarget: () =>
						Promise.resolve({ exists: true, mode: "600", text: "token=anything\n" }),
				}),
				manifest: manifest({
					files: [
						{
							mode: "0600",
							name: "Npmrc",
							secrets: ["NPM_AUTH_TOKEN"],
							source: "machines/main/files/.npmrc",
							target: "~/.npmrc",
						},
					],
					packages: { apt: {}, bun: {}, pacman: {} },
				}),
				skipSecrets: true,
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});
});

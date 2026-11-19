import { describe, expect, test } from "bun:test";

import type { InstalledPackages, ManagerId } from "#/core/machine/managers/types.js";
import { systemManagerForOsRelease } from "#/core/machine/os.js";
import {
	activeManagers,
	evaluatePackages,
	listInstalled,
	splitDeclared,
	systemWarning,
	SYSTEM_WARNING,
} from "#/core/machine/packages.js";
import type { EvaluatePackagesArgs } from "#/core/machine/packages.js";
import { partitionResults } from "#/core/result.js";

function installed(names: string[], versions: Record<string, string> = {}): InstalledPackages {
	const explicit = new Set(names);
	const map = new Map<string, string>();
	for (const name of names) {
		map.set(name, versions[name] ?? "1.0.0-1");
	}
	return { explicit, versions: map };
}

function baseArgs(overrides: Partial<EvaluatePackagesArgs> = {}): EvaluatePackagesArgs {
	return {
		allowlist: { pacman: ["base", "linux"] },
		blueprint: "main",
		declared: { apt: {}, bun: {}, pacman: { ripgrep: "latest" } },
		installed: {
			apt: installed([]),
			bun: installed([]),
			pacman: installed(["ripgrep", "base", "linux"]),
		},
		strict: false,
		systemManager: "pacman",
		...overrides,
	};
}

describe("evaluatePackages", () => {
	test("all present passes strict or not", () => {
		for (const strict of [false, true] as const) {
			const results = evaluatePackages(baseArgs({ strict }));
			expect(results).toHaveLength(1);
			expect(results[0]?.ok).toBe(true);
			expect(results[0]?.id).toBe("machine:main:pacman:ripgrep");
			expect(results[0]?.scope).toBe("machine");
			expect(results[0]?.upstream).toBe("tech-stack:main");
		}
	});

	test("pinned version matching installed passes", () => {
		const results = evaluatePackages(
			baseArgs({
				declared: { apt: {}, bun: {}, pacman: { ripgrep: "14.1.0-1" } },
				installed: {
					apt: installed([]),
					bun: installed([]),
					pacman: installed(["ripgrep"], { ripgrep: "14.1.0-1" }),
				},
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("pinned version drift is fixable strict or not", () => {
		for (const strict of [false, true] as const) {
			const results = evaluatePackages(
				baseArgs({
					declared: { apt: {}, bun: {}, pacman: { ripgrep: "14.1.0-1" } },
					installed: {
						apt: installed([]),
						bun: installed([]),
						pacman: installed(["ripgrep"], { ripgrep: "13.0.0-1" }),
					},
					strict,
				}),
			);
			expect(results).toHaveLength(1);
			expect(results[0]?.ok).toBe(false);
			expect(results[0]?.fix).toEqual({
				args: ["pacman", "-S", "--needed", "--noconfirm", "--", "ripgrep=14.1.0-1"],
				command: "sudo",
				kind: "run-command",
				label: "sudo pacman -S --needed --noconfirm -- ripgrep=14.1.0-1",
				preCommands: [
					{
						args: ["pacman", "-Syu", "--noconfirm"],
						command: "sudo",
						label: "sudo pacman -Syu --noconfirm",
					},
					{
						args: [
							"sh",
							"-c",
							'[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -',
						],
						command: "sudo",
						label: `sudo sh -c '[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -'`,
					},
				],
			});
		}
	});

	test("non-strict: missing fails fixable, extra is skipped", () => {
		const results = evaluatePackages(
			baseArgs({
				installed: { apt: installed([]), bun: installed([]), pacman: installed(["extra-pkg"]) },
			}),
		);
		const missing = results.find((item) => item.id === "machine:main:pacman:ripgrep");
		expect(missing?.ok).toBe(false);
		expect(missing?.fix).toEqual({
			args: ["pacman", "-S", "--needed", "--noconfirm", "--", "ripgrep"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -S --needed --noconfirm -- ripgrep",
			preCommands: [
				{
					args: ["pacman", "-Syu", "--noconfirm"],
					command: "sudo",
					label: "sudo pacman -Syu --noconfirm",
				},
				{
					args: [
						"sh",
						"-c",
						'[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -',
					],
					command: "sudo",
					label: `sudo sh -c '[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -'`,
				},
			],
		});
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.skipped).toBe(true);
		expect(extra?.fix).toBeUndefined();
		expect(partitionResults(results).failed.map((item) => item.id)).toEqual([
			"machine:main:pacman:ripgrep",
		]);
	});

	test("strict: missing and extra both fail fixable", () => {
		const results = evaluatePackages(
			baseArgs({
				installed: { apt: installed([]), bun: installed([]), pacman: installed(["extra-pkg"]) },
				strict: true,
			}),
		);
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.ok).toBe(false);
		expect(extra?.skipped).toBeUndefined();
		expect(extra?.fix).toEqual({
			args: ["pacman", "-Rs", "--noconfirm", "--", "extra-pkg"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -Rs --noconfirm -- extra-pkg",
		});
		expect(partitionResults(results).fixable).toHaveLength(2);
	});

	test("apt fixes use name=version", () => {
		const missing = evaluatePackages(
			baseArgs({
				declared: { apt: { ripgrep: "14.1.0-1" }, bun: {}, pacman: {} },
				installed: { apt: installed([]), bun: installed([]), pacman: installed([]) },
				strict: true,
				systemManager: "apt",
			}),
		);
		expect(missing).toHaveLength(1);
		expect(missing[0]?.id).toBe("machine:main:apt:ripgrep");
		expect(missing[0]?.fix).toEqual({
			args: ["apt-get", "install", "-y", "--", "ripgrep=14.1.0-1"],
			command: "sudo",
			kind: "run-command",
			label: "sudo apt-get install -y -- ripgrep=14.1.0-1",
			preCommands: [
				{ args: ["apt-get", "update"], command: "sudo", label: "sudo apt-get update" },
				{ args: ["apt-get", "upgrade", "-y"], command: "sudo", label: "sudo apt-get upgrade -y" },
				{
					args: ["apt-get", "autoremove", "-y"],
					command: "sudo",
					label: "sudo apt-get autoremove -y",
				},
			],
		});
		const extra = evaluatePackages(
			baseArgs({
				declared: { apt: {}, bun: {}, pacman: {} },
				installed: { apt: installed(["stray"]), bun: installed([]), pacman: installed([]) },
				strict: true,
				systemManager: "apt",
			}),
		);
		expect(extra[0]?.fix).toEqual({
			args: ["apt-get", "remove", "-y", "--", "stray"],
			command: "sudo",
			kind: "run-command",
			label: "sudo apt-get remove -y -- stray",
		});
	});

	test("bun fixes use name@version", () => {
		const missing = evaluatePackages(
			baseArgs({
				declared: { apt: {}, bun: { "eas-cli": "2.0.0" }, pacman: {} },
				installed: { apt: installed([]), bun: installed([]), pacman: installed([]) },
				strict: true,
			}),
		);
		expect(missing[0]?.fix).toEqual({
			args: ["add", "-g", "eas-cli@2.0.0"],
			command: "bun",
			kind: "run-command",
			label: "bun add -g eas-cli@2.0.0",
		});
		const extra = evaluatePackages(
			baseArgs({
				declared: { apt: {}, bun: {}, pacman: {} },
				installed: { apt: installed([]), bun: installed(["stray"]), pacman: installed([]) },
				strict: true,
			}),
		);
		expect(extra[0]?.fix).toEqual({
			args: ["remove", "-g", "stray"],
			command: "bun",
			kind: "run-command",
			label: "bun remove -g stray",
		});
	});
});

describe("listInstalled", () => {
	test("a manager whose tools are absent contributes nothing", async () => {
		const result = await listInstalled((manager: ManagerId) => {
			if (manager === "apt") {
				return Promise.reject(new Error("Cannot run apt-mark showmanual: not found"));
			}
			return Promise.resolve(installed(["ripgrep"]));
		});
		expect(result.apt).toEqual({ explicit: new Set(), versions: new Map() });
		expect(result.pacman.versions.get("ripgrep")).toBe("1.0.0-1");
	});

	test("other listing failures still reject", async () => {
		await expect(
			listInstalled(() => Promise.reject(new Error("Command failed (dpkg-query -W): exit 1"))),
		).rejects.toThrow("Command failed");
	});

	test("only queried managers are listed, the rest stay empty", async () => {
		const seen: ManagerId[] = [];
		const result = await listInstalled(
			(manager) => {
				seen.push(manager);
				return Promise.resolve(installed(["ripgrep"]));
			},
			["pacman", "bun"],
		);
		expect(seen.toSorted()).toEqual(["bun", "pacman"]);
		expect(result.pacman.versions.get("ripgrep")).toBe("1.0.0-1");
		expect(result.bun.versions.get("ripgrep")).toBe("1.0.0-1");
		expect(result.apt).toEqual({ explicit: new Set(), versions: new Map() });
	});
});

describe("splitDeclared", () => {
	test("missing is declared minus installed", () => {
		const { extra, missing } = splitDeclared(["b", "a"], installed(["a"]), new Set());
		expect(missing).toEqual(["b"]);
		expect(extra).toEqual([]);
	});

	test("extra is installed minus declared minus allowlist", () => {
		const { extra } = splitDeclared(["a"], installed(["a", "z", "base"]), new Set(["base"]));
		expect(extra).toEqual(["z"]);
	});

	test("outputs are sorted and deduplicated", () => {
		const { extra, missing } = splitDeclared(["b", "a", "b"], installed(["z", "y"]), new Set());
		expect(missing).toEqual(["a", "b"]);
		expect(extra).toEqual(["y", "z"]);
	});

	test("a declared package installed only as a dependency is not missing", () => {
		const asDependency: InstalledPackages = {
			explicit: new Set(),
			versions: new Map([["git", "2.47.0-1"]]),
		};
		const { extra, missing } = splitDeclared(["git"], asDependency, new Set());
		expect(missing).toEqual([]);
		expect(extra).toEqual([]);
	});
});

describe("activeManagers", () => {
	test("arch runs pacman plus bun", () => {
		expect(activeManagers("pacman")).toEqual(["bun", "pacman"]);
	});

	test("debian runs apt plus bun", () => {
		expect(activeManagers("apt")).toEqual(["apt", "bun"]);
	});

	test("unsupported distros run bun only", () => {
		expect(activeManagers(systemManagerForOsRelease("ID=fedora\n"))).toEqual(["bun"]);
	});
});

describe("systemWarning", () => {
	test("is a skip carrying the unsupported-distro message", () => {
		const warning = systemWarning("main");
		expect(warning.id).toBe("machine:main:packages:system");
		expect(warning.skipped).toBe(true);
		expect(warning.ok).toBe(false);
		expect(warning.actual).toBe(SYSTEM_WARNING);
		expect(warning.actual).toBe(
			"It seems you have not defined any system packages OR your OS Distro is not supported.",
		);
	});
});

describe("evaluatePackages with auto-os selection", () => {
	test("arch ignores declared apt packages", () => {
		const results = evaluatePackages(
			baseArgs({
				declared: {
					apt: { "should-be-ignored": "latest" },
					bun: {},
					pacman: { ripgrep: "latest" },
				},
				systemManager: "pacman",
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:pacman:ripgrep");
	});

	test("debian ignores declared pacman packages", () => {
		const results = evaluatePackages(
			baseArgs({
				declared: {
					apt: { ripgrep: "latest" },
					bun: {},
					pacman: { "should-be-ignored": "latest" },
				},
				installed: {
					apt: installed(["ripgrep"]),
					bun: installed([]),
					pacman: installed([]),
				},
				systemManager: "apt",
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:apt:ripgrep");
	});

	test("unsupported distros evaluate bun only", () => {
		const results = evaluatePackages(
			baseArgs({
				declared: {
					apt: { "apt-pkg": "latest" },
					bun: { "bun-pkg": "latest" },
					pacman: { "pacman-pkg": "latest" },
				},
				installed: { apt: installed([]), bun: installed([]), pacman: installed([]) },
				systemManager: systemManagerForOsRelease("ID=fedora\n"),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:bun:bun-pkg");
	});
});

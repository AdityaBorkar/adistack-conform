import { describe, expect, test } from "bun:test";

import { declaredFromManifest, evaluatePackages } from "#/stack/machine-packages.js";
import type { EvaluatePackagesArgs, ManifestPackages } from "#/stack/machine-packages.js";
import type { InstalledPackages } from "#/stack/managers/types.js";
import { partitionResults } from "#/utils/result.js";

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
		allowlist: { bun: new Set(), pacman: new Set(["base", "linux"]) },
		blueprint: "main",
		declared: [{ manager: "pacman", name: "ripgrep", version: "latest" }],
		installed: { bun: installed([]), pacman: installed(["ripgrep", "base", "linux"]) },
		mode: "conform",
		...overrides,
	};
}

function manifest(packages: ManifestPackages) {
	return packages;
}

describe("declaredFromManifest", () => {
	test("flattens pacman/bun maps to manager entries", () => {
		expect(
			declaredFromManifest(
				manifest({ bun: { "eas-cli": "latest" }, pacman: { ripgrep: "14.1.0-1" } }),
			),
		).toEqual([
			{ manager: "pacman", name: "ripgrep", version: "14.1.0-1" },
			{ manager: "bun", name: "eas-cli", version: "latest" },
		]);
	});
});

describe("evaluatePackages", () => {
	test("all present passes in both modes", () => {
		for (const mode of ["conform", "drift"] as const) {
			const results = evaluatePackages(baseArgs({ mode }));
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
				declared: [{ manager: "pacman", name: "ripgrep", version: "14.1.0-1" }],
				installed: {
					bun: installed([]),
					pacman: installed(["ripgrep"], { ripgrep: "14.1.0-1" }),
				},
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(true);
	});

	test("pinned version drift is fixable in both modes", () => {
		for (const mode of ["conform", "drift"] as const) {
			const results = evaluatePackages(
				baseArgs({
					declared: [{ manager: "pacman", name: "ripgrep", version: "14.1.0-1" }],
					installed: {
						bun: installed([]),
						pacman: installed(["ripgrep"], { ripgrep: "13.0.0-1" }),
					},
					mode,
				}),
			);
			expect(results).toHaveLength(1);
			expect(results[0]?.ok).toBe(false);
			expect(results[0]?.fix).toEqual({
				args: ["pacman", "-S", "--needed", "--noconfirm", "ripgrep=14.1.0-1"],
				command: "sudo",
				kind: "run-command",
				label: "sudo pacman -S --needed --noconfirm ripgrep=14.1.0-1",
			});
		}
	});

	test("conform mode: missing fails fixable, extra is skipped", () => {
		const results = evaluatePackages(
			baseArgs({ installed: { bun: installed([]), pacman: installed(["extra-pkg"]) } }),
		);
		const missing = results.find((item) => item.id === "machine:main:pacman:ripgrep");
		expect(missing?.ok).toBe(false);
		expect(missing?.fix).toEqual({
			args: ["pacman", "-S", "--needed", "--noconfirm", "ripgrep"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -S --needed --noconfirm ripgrep",
		});
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.skipped).toBe(true);
		expect(extra?.fix).toBeUndefined();
		expect(partitionResults(results).failed.map((item) => item.id)).toEqual([
			"machine:main:pacman:ripgrep",
		]);
	});

	test("drift mode: missing and extra both fail fixable", () => {
		const results = evaluatePackages(
			baseArgs({
				installed: { bun: installed([]), pacman: installed(["extra-pkg"]) },
				mode: "drift",
			}),
		);
		const extra = results.find((item) => item.id === "machine:main:pacman:extra-pkg");
		expect(extra?.ok).toBe(false);
		expect(extra?.skipped).toBeUndefined();
		expect(extra?.fix).toEqual({
			args: ["pacman", "-Rs", "--noconfirm", "extra-pkg"],
			command: "sudo",
			kind: "run-command",
			label: "sudo pacman -Rs --noconfirm extra-pkg",
		});
		expect(partitionResults(results).fixable).toHaveLength(2);
	});

	test("bun fixes use name@version", () => {
		const missing = evaluatePackages(
			baseArgs({
				declared: [{ manager: "bun", name: "eas-cli", version: "2.0.0" }],
				installed: { bun: installed([]), pacman: installed([]) },
				mode: "drift",
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
				declared: [],
				installed: { bun: installed(["stray"]), pacman: installed([]) },
				mode: "drift",
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

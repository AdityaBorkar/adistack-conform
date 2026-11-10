import { describe, expect, test } from "bun:test";

import { collectValidateTargets, validateTargets } from "#/commands/validate.js";
import type { RegistryDocument } from "#/stack/registry.js";
import type { LoadedDesiredState } from "#/utils/config.js";

function loaded(overrides: Partial<LoadedDesiredState> = {}): LoadedDesiredState {
	return {
		dir: "/tmp",
		path: "/tmp/conform.json",
		source: { id: "o/r", ref: "main", source: "github" },
		...overrides,
	};
}

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: { name: "Primary Developer Machine", path: "./machines/main/" } },
	projects: { "cli-app": "./projects/cli-app.json" },
} as unknown as RegistryDocument;

describe("collectValidateTargets", () => {
	test("dedupes shared project/github blueprints across desired states", () => {
		const targets = collectValidateTargets([
			loaded({ project: { blueprint: "cli-app" } }),
			loaded({ github: { blueprint: "npm-package" }, project: { blueprint: "cli-app" } }),
		]);
		expect(targets.size).toBe(1);
		expect(targets.get("o/r@main")?.projects).toEqual(["cli-app"]);
		expect(targets.get("o/r@main")?.githubs).toEqual(["npm-package"]);
		expect(targets.get("o/r@main")?.machines).toEqual([]);
	});

	test("keeps machine blueprints separate from projects", () => {
		const targets = collectValidateTargets([
			loaded({ machine: { blueprint: "main" }, project: { blueprint: "cli-app" } }),
		]);
		expect(targets.get("o/r@main")?.machines).toEqual(["main"]);
		expect(targets.get("o/r@main")?.projects).toEqual(["cli-app"]);
	});
});

describe("validateTargets", () => {
	test("reports registry plus manifest results in order", async () => {
		const results = await validateTargets(
			collectValidateTargets([loaded({ project: { blueprint: "cli-app" } })]),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () =>
					Promise.resolve({
						blueprintRel: "projects/cli-app.json",
						files: [],
						structure: [],
					}),
				fetchRegistry: () => Promise.resolve(registry),
			},
		);
		expect(results.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"projects/cli-app.json (o/r@main)",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("reports registry plus github settings results in order", async () => {
		const results = await validateTargets(
			collectValidateTargets([loaded({ github: { blueprint: "npm-package" } })]),
			{
				fetchGithub: () =>
					Promise.resolve({
						githubRel: "github-configs/npm-package.json",
						golden: {} as never,
					}),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () => Promise.resolve(registry),
			},
		);
		expect(results.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"github-configs/npm-package.json (o/r@main)",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("registry fetch failure skips manifests for that ref", async () => {
		const results = await validateTargets(
			collectValidateTargets([loaded({ project: { blueprint: "cli-app" } })]),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () =>
					Promise.reject(new Error("registry.json fetch failed (boom): HTTP 404.")),
			},
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.error).toContain("HTTP 404");
	});

	test("missing machine blueprint is invalid", async () => {
		const results = await validateTargets(
			collectValidateTargets([loaded({ machine: { blueprint: "nope" } })]),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () => Promise.resolve(registry),
			},
		);
		expect(results).toHaveLength(2);
		expect(results[0]?.ok).toBe(true);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain('"nope"');
	});

	test("manifest schema failure is reported per blueprint", async () => {
		const results = await validateTargets(
			collectValidateTargets([loaded({ project: { blueprint: "cli-app" } })]),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("Invalid blueprint in x:\nfiles: Required")),
				fetchRegistry: () => Promise.resolve(registry),
			},
		);
		expect(results).toHaveLength(2);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("Invalid blueprint");
	});
});

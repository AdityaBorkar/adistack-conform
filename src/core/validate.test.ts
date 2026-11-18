import { describe, expect, test } from "bun:test";

import type { LoadedDesiredState } from "#/core/config.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { collectValidateTargets, validateTargets } from "#/core/validate.js";

function loaded(overrides: Partial<LoadedDesiredState> = {}): LoadedDesiredState {
	return {
		dir: "/tmp",
		path: "/tmp/conform.json",
		source: { id: "o/r", provider: "github", ref: "main" },
		...overrides,
	};
}

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: "./machines/main.json" },
	projects: { "cli-app": "./projects/cli-app.json" },
} as unknown as RegistryDocument;

describe("collectValidateTargets", () => {
	test("maps each configured scope to its blueprint", () => {
		expect(
			collectValidateTargets(
				loaded({ machine: { blueprint: "main" }, project: { blueprint: "cli-app" } }),
			),
		).toEqual({
			github: undefined,
			id: "o/r",
			machine: "main",
			project: "cli-app",
			ref: "main",
		});
	});
});

describe("validateTargets", () => {
	test("reports registry plus manifest results in order", async () => {
		const results = await validateTargets(
			collectValidateTargets(loaded({ project: { blueprint: "cli-app" } })),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchMachine: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () =>
					Promise.resolve({
						blueprintRel: "projects/cli-app.json",
						files: [],
						structure: [],
					}),
				fetchRegistry: () => Promise.resolve(registry),
				fetchText: () => Promise.reject(new Error("must not be called")),
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
			collectValidateTargets(loaded({ github: { blueprint: "npm-package" } })),
			{
				fetchGithub: () =>
					Promise.resolve({
						githubRel: "github-configs/npm-package.json",
						upstream: {} as never,
					}),
				fetchMachine: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () => Promise.resolve(registry),
				fetchText: () => Promise.reject(new Error("must not be called")),
			},
		);
		expect(results.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"github-configs/npm-package.json (o/r@main)",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("registry fetch error skips manifests for that ref", async () => {
		const results = await validateTargets(
			collectValidateTargets(loaded({ project: { blueprint: "cli-app" } })),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchMachine: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () =>
					Promise.reject(new Error("registry.json fetch failed (boom): HTTP 404.")),
				fetchText: () => Promise.reject(new Error("must not be called")),
			},
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.error).toContain("HTTP 404");
	});

	test("missing machine blueprint is invalid", async () => {
		const results = await validateTargets(
			collectValidateTargets(loaded({ machine: { blueprint: "nope" } })),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchMachine: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("must not be called")),
				fetchRegistry: () => Promise.resolve(registry),
				fetchText: () => Promise.reject(new Error("must not be called")),
			},
		);
		expect(results).toHaveLength(2);
		expect(results[0]?.ok).toBe(true);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain('"nope"');
	});

	test("manifest schema error is reported per blueprint", async () => {
		const results = await validateTargets(
			collectValidateTargets(loaded({ project: { blueprint: "cli-app" } })),
			{
				fetchGithub: () => Promise.reject(new Error("must not be called")),
				fetchMachine: () => Promise.reject(new Error("must not be called")),
				fetchManifest: () => Promise.reject(new Error("Invalid blueprint in x:\nfiles: Required")),
				fetchRegistry: () => Promise.resolve(registry),
				fetchText: () => Promise.reject(new Error("must not be called")),
			},
		);
		expect(results).toHaveLength(2);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("Invalid blueprint");
	});

	test("machine manifest sources must be fetchable", async () => {
		const deps = {
			fetchGithub: () => Promise.reject(new Error("must not be called")),
			fetchMachine: () =>
				Promise.resolve({
					manifest: {
						allowlist: {},
						files: [
							{
								name: "Zshrc",
								source: "machines/main/files/.zshrc",
								target: "~/.zshrc",
							},
						],
						packages: { bun: {}, pacman: {} },
					},
					manifestRel: "machines/main.json",
				}),
			fetchManifest: () => Promise.reject(new Error("must not be called")),
			fetchRegistry: () => Promise.resolve(registry),
			fetchText: () => Promise.resolve("content"),
		};
		const ok = await validateTargets(
			collectValidateTargets(loaded({ machine: { blueprint: "main" } })),
			deps,
		);
		expect(ok.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"machines/main.json (o/r@main)",
		]);
		expect(ok.every((item) => item.ok)).toBe(true);
		const failing = await validateTargets(
			collectValidateTargets(loaded({ machine: { blueprint: "main" } })),
			{
				...deps,
				fetchText: () => Promise.reject(new Error("HTTP 404.")),
			},
		);
		expect(failing[1]?.ok).toBe(false);
		expect(failing[1]?.error).toContain("Unfetchable machine sources");
	});

	test("machine manifest with secrets requires a fetchable secrets file", async () => {
		const withSecrets = {
			fetchGithub: () => Promise.reject(new Error("must not be called")),
			fetchMachine: () =>
				Promise.resolve({
					manifest: {
						allowlist: {},
						files: [
							{
								mode: "0600" as const,
								name: "Npmrc",
								secrets: ["npm_auth_token"],
								source: "machines/main/files/.npmrc",
								target: "~/.npmrc",
							},
						],
						packages: { bun: {}, pacman: {} },
					},
					manifestRel: "machines/main.json",
				}),
			fetchManifest: () => Promise.reject(new Error("must not be called")),
			fetchRegistry: () => Promise.resolve(registry),
			fetchText: (url: string) =>
				url.endsWith("secrets.yaml")
					? Promise.reject(new Error("HTTP 404."))
					: Promise.resolve("content"),
		};
		const results = await validateTargets(
			collectValidateTargets(loaded({ machine: { blueprint: "main" } })),
			withSecrets,
		);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("secrets");
	});
});

import { describe, expect, test } from "bun:test";

import type { LoadedDesiredState } from "#/core/config.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { fetchBlueprint } from "#/core/upstream/remote.js";
import type { FetchDeps } from "#/core/validate.js";
import { validateDesiredState } from "#/core/validate.js";

function loaded(overrides: Partial<LoadedDesiredState> = {}): LoadedDesiredState {
	return {
		dir: "/tmp",
		path: "/tmp/conform.json",
		source: { id: "o/r", ref: "main" },
		...overrides,
	};
}

const registry = {
	github_configs: { "npm-package": "./github-configs/npm-package.json" },
	machines: { main: "./machines/main.json" },
	projects: { "cli-app": "./projects/cli-app.json" },
} as unknown as RegistryDocument;

const mustNotCall = () => Promise.reject(new Error("must not be called"));

function blueprint(rel: string, data: unknown): FetchDeps["fetchBlueprint"] {
	return (() => Promise.resolve({ data, rel })) as unknown as FetchDeps["fetchBlueprint"];
}

function deps(overrides: Partial<FetchDeps>): FetchDeps {
	return {
		fetchBlueprint: mustNotCall as unknown as FetchDeps["fetchBlueprint"],
		fetchRegistry: () => Promise.resolve(registry),
		fetchText: mustNotCall,
		...overrides,
	};
}

const machineManifest = (files: unknown[]) => ({
	allowlist: {},
	files,
	packages: { bun: {}, pacman: {} },
});

describe("validateDesiredState", () => {
	test("reports registry plus project blueprint results in order", async () => {
		const results = await validateDesiredState(
			loaded({ project: { blueprint: "cli-app" } }),
			deps({
				fetchBlueprint: blueprint("projects/cli-app.json", { file_structure: [], files: [] }),
			}),
		);
		expect(results.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"projects/cli-app.json (o/r@main)",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("reports registry plus github settings results in order", async () => {
		const results = await validateDesiredState(
			loaded({ github: { blueprint: "npm-package" } }),
			deps({ fetchBlueprint: blueprint("github-configs/npm-package.json", {}) }),
		);
		expect(results.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"github-configs/npm-package.json (o/r@main)",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("registry fetch error skips blueprints for that ref", async () => {
		const results = await validateDesiredState(
			loaded({ project: { blueprint: "cli-app" } }),
			deps({
				fetchRegistry: () =>
					Promise.reject(new Error("registry.json fetch failed (boom): HTTP 404.")),
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.error).toContain("HTTP 404");
	});

	test("missing machine blueprint is invalid before any fetch", async () => {
		const results = await validateDesiredState(
			loaded({ machine: { blueprint: "nope" } }),
			deps({ fetchBlueprint }),
		);
		expect(results).toHaveLength(2);
		expect(results[0]?.ok).toBe(true);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain('"nope"');
		expect(results[1]?.error).toContain("Available machine blueprints: main");
	});

	test("blueprint schema error is reported per blueprint", async () => {
		const results = await validateDesiredState(
			loaded({ project: { blueprint: "cli-app" } }),
			deps({
				fetchBlueprint: (() =>
					Promise.reject(
						new Error("Invalid blueprint in x:\nfiles: Required"),
					)) as unknown as FetchDeps["fetchBlueprint"],
			}),
		);
		expect(results).toHaveLength(2);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("Invalid blueprint");
	});

	test("machine manifest sources must be fetchable", async () => {
		const machine = blueprint(
			"machines/main.json",
			machineManifest([
				{ name: "Zshrc", source: "machines/main/files/.zshrc", target: "~/.zshrc" },
			]),
		);
		const ok = await validateDesiredState(
			loaded({ machine: { blueprint: "main" } }),
			deps({ fetchBlueprint: machine, fetchText: () => Promise.resolve("content") }),
		);
		expect(ok.map((item) => item.file)).toEqual([
			"registry.json (o/r@main)",
			"machines/main.json (o/r@main)",
		]);
		expect(ok.every((item) => item.ok)).toBe(true);
		const failing = await validateDesiredState(
			loaded({ machine: { blueprint: "main" } }),
			deps({ fetchBlueprint: machine, fetchText: () => Promise.reject(new Error("HTTP 404.")) }),
		);
		expect(failing[1]?.ok).toBe(false);
		expect(failing[1]?.error).toContain("Unfetchable machine sources");
	});

	test("machine manifest with secrets requires a fetchable secrets file", async () => {
		const results = await validateDesiredState(
			loaded({ machine: { blueprint: "main" } }),
			deps({
				fetchBlueprint: blueprint(
					"machines/main.json",
					machineManifest([
						{
							name: "Npmrc",
							secrets: ["npm_auth_token"],
							source: "machines/main/files/.npmrc",
							target: "~/.npmrc",
						},
					]),
				),
				fetchText: (url: string) =>
					url.endsWith("secrets.yaml")
						? Promise.reject(new Error("HTTP 404."))
						: Promise.resolve("content"),
			}),
		);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("machines/secrets.yaml");
	});
});

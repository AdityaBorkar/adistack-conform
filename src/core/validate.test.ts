import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateTechStack } from "#/core/validate.js";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })));
	dirs = [];
});

async function scaffold(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "conform-validate-"));
	dirs.push(dir);
	await Promise.all(
		Object.entries(files).map(([rel, content]) => Bun.write(join(dir, rel), content)),
	);
	return dir;
}

const registry = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		github_configs: { "npm-package": "./github-configs/npm-package.json" },
		machines: { main: "./machines/main.json" },
		projects: { "cli-app": "./projects/cli-app.json" },
		...overrides,
	});

const projectManifest = (sources: string[] = ["projects/files/tool/config.json"]) =>
	JSON.stringify({
		files: sources.map((source, index) => ({
			name: `file-${index}`,
			source,
			target: `out-${index}`,
		})),
	});

const machineManifest = (files: unknown[] = []) =>
	JSON.stringify({ files, packages: { bun: {}, pacman: {} } });

function fullRepo(extra: Record<string, string> = {}): Promise<string> {
	return scaffold({
		"github-configs/npm-package.json": "{}",
		"machines/files/.zshrc": "content",
		"machines/main.json": machineManifest([
			{ name: "Zshrc", source: "machines/files/.zshrc", target: "~/.zshrc" },
		]),
		"projects/cli-app.json": projectManifest(),
		"projects/files/tool/config.json": "{}",
		"registry.json": registry(),
		...extra,
	});
}

describe("validateTechStack", () => {
	test("reports the registry plus every blueprint in order", async () => {
		const results = await validateTechStack(await fullRepo());
		expect(results.map((item) => item.file)).toEqual([
			"registry.json",
			"projects/cli-app.json",
			"machines/main.json",
			"github-configs/npm-package.json",
		]);
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("accepts an explicit registry.json file path", async () => {
		const dir = await fullRepo();
		const results = await validateTechStack(join(dir, "registry.json"));
		expect(results.every((item) => item.ok)).toBe(true);
	});

	test("throws when no registry exists", async () => {
		await expect(validateTechStack(join(tmpdir(), "conform-validate-missing"))).rejects.toThrow(
			"No tech-stack registry found",
		);
	});

	test("registry schema error is a single invalid result", async () => {
		const results = await validateTechStack(
			await scaffold({ "registry.json": JSON.stringify({ projects: {} }) }),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.error).toContain("Invalid tech-stack registry");
	});

	test("blueprint schema error is reported per blueprint", async () => {
		const results = await validateTechStack(
			await fullRepo({ "projects/cli-app.json": JSON.stringify({ files: "nope" }) }),
		);
		expect(results).toHaveLength(4);
		expect(results[0]?.ok).toBe(true);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("Invalid Project blueprint");
		expect(results[2]?.ok).toBe(true);
	});

	test("missing blueprint file is invalid", async () => {
		const dir = await fullRepo();
		await rm(join(dir, "github-configs/npm-package.json"));
		const results = await validateTechStack(dir);
		expect(results[3]?.ok).toBe(false);
		expect(results[3]?.error).toContain("not found");
	});

	test("missing project and machine sources are invalid", async () => {
		const dir = await fullRepo();
		await rm(join(dir, "projects/files/tool/config.json"));
		await rm(join(dir, "machines/files/.zshrc"));
		const results = await validateTechStack(dir);
		expect(results[1]?.ok).toBe(false);
		expect(results[1]?.error).toContain("Missing blueprint sources");
		expect(results[2]?.ok).toBe(false);
		expect(results[2]?.error).toContain("machines/files/.zshrc");
	});

	test("machine manifest with secrets requires the adjacent secrets file", async () => {
		const results = await validateTechStack(
			await fullRepo({
				"machines/files/.npmrc": "content",
				"machines/main.json": machineManifest([
					{
						name: "Npmrc",
						secrets: ["npm_auth_token"],
						source: "machines/files/.npmrc",
						target: "~/.npmrc",
					},
				]),
			}),
		);
		expect(results[2]?.ok).toBe(false);
		expect(results[2]?.error).toContain("machines/secrets.yaml");
	});

	test("JSONC blueprints and registry are valid, as check parses them", async () => {
		const dir = await fullRepo();
		const path = join(dir, "github-configs/npm-package.json");
		const text = await Bun.file(path).text();
		await Bun.write(path, `// comment\n${text.replace(/\}\s*$/u, ",}")}`);
		const registryPath = join(dir, "registry.json");
		await Bun.write(registryPath, `/* c */${await Bun.file(registryPath).text()}`);
		const results = await validateTechStack(dir);
		expect(results.every((result) => result.ok)).toBe(true);
	});

	test("directory registry entries are invalid", async () => {
		const results = await validateTechStack(
			await fullRepo({
				"registry.json": registry({ machines: { main: "./machines/main/" } }),
			}),
		);
		expect(results[2]?.ok).toBe(false);
		expect(results[2]?.error).toContain("must be a blueprint file");
	});
});

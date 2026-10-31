import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { TechStackSpec } from "#/config.js";
import { defaultHome } from "#/config.js";

export interface InitOptions {
	minimal: boolean;
	techStack?: TechStackSpec;
}

interface SnapshotFile {
	id?: string;
	mustExist?: boolean;
	path: string;
}

function tryCommand(command: string, cwd: string): string | undefined {
	try {
		const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", timeout: 10_000 });
		if (result.status !== 0) {
			return undefined;
		}
		const out = `${result.stdout ?? ""}`.trim();
		return out === "" ? undefined : out;
	} catch {
		return undefined;
	}
}

function exists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

export async function buildSnapshot(
	cwd: string,
	options: InitOptions,
): Promise<Record<string, unknown>> {
	const home = defaultHome();
	const files: SnapshotFile[] = [{ path: "package.json" }];
	if (await exists(join(cwd, "tsconfig.json"))) {
		files.push({ path: "tsconfig.json" });
	}
	if (await exists(join(cwd, ".gitignore"))) {
		files.push({ path: ".gitignore" });
	}
	if (await exists(join(cwd, ".nvmrc"))) {
		files.push({ path: ".nvmrc" });
	}
	if (await exists(join(cwd, "bun.lockb"))) {
		files.push({ path: "bun.lockb" });
	}

	const json: Record<string, unknown>[] = [];
	const packageJsonPath = join(cwd, "package.json");
	if (await exists(packageJsonPath)) {
		try {
			const pkg = (await Bun.file(packageJsonPath).json()) as Record<string, unknown>;
			const engines = pkg["engines"] as Record<string, unknown> | undefined;
			if (typeof engines?.["node"] === "string") {
				json.push({
					expect: engines["node"],
					fix: "set",
					path: "package.json",
					pointer: "/engines/node",
				});
			}
			if (typeof pkg["packageManager"] === "string") {
				json.push({
					expect: pkg["packageManager"],
					fix: "set",
					path: "package.json",
					pointer: "/packageManager",
				});
			}
		} catch {
			// Leave json empty when package.json is unreadable; check will surface it.
		}
		const nvmrcPath = join(cwd, ".nvmrc");
		if (await exists(nvmrcPath)) {
			const pinned = (await Bun.file(nvmrcPath).text()).trim();
			if (pinned !== "") {
				json.push({ expect: pinned, fix: "set", path: "package.json", pointer: "/engines/node" });
			}
		}
	}

	const commands: Record<string, unknown>[] = [];
	const bunVersion = tryCommand("bun --version", cwd);
	if (bunVersion) {
		commands.push({ expect: bunVersion, id: "bun-version", match: "exact", run: "bun --version" });
	}
	const nodeVersion = tryCommand("node --version", cwd);
	if (nodeVersion) {
		commands.push({
			expect: nodeVersion,
			id: "node-version",
			match: "exact",
			run: "node --version",
		});
	}

	if (options.minimal) {
		return { project: { commands, files, json }, version: 1 };
	}

	const binaries: Record<string, unknown>[] = [];
	for (const bin of ["bun", "docker", "gh", "git"]) {
		const out = tryCommand(`${bin} --version`, cwd);
		if (out) {
			binaries.push({ bin, expect: out, match: "contains" });
		}
	}
	const env: Record<string, unknown>[] = [];
	for (const name of ["ANDROID_HOME", "GOPATH", "JAVA_HOME"]) {
		const value = process.env[name];
		if (value) {
			env.push({ expect: value, match: "exact", name });
		}
	}
	const systemFiles: SnapshotFile[] = [];
	if (await exists(join(home, ".gitconfig"))) {
		systemFiles.push({ path: "~/.gitconfig" });
	}
	if (await exists(join(home, ".ssh", "config"))) {
		systemFiles.push({ path: "~/.ssh/config" });
	}

	const root: Record<string, unknown> = {
		project: { commands, files, json },
		system: { binaries, env, files: systemFiles },
	};
	if (options.techStack !== undefined) {
		const spec: Record<string, unknown> = { repo: options.techStack.repo };
		if (options.techStack.blueprint !== undefined) {
			spec["blueprint"] = options.techStack.blueprint;
		}
		if (options.techStack.presets.length > 0) {
			spec["presets"] = options.techStack.presets;
		}
		if (options.techStack.exclude.length > 0) {
			spec["exclude"] = options.techStack.exclude;
		}
		if (options.techStack.fix !== "overwrite") {
			spec["fix"] = options.techStack.fix;
		}
		root["techStack"] = spec;
	}
	root["version"] = 1;
	return root;
}

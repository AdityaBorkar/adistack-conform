import { basename, dirname, join } from "node:path";

import { ConformSchema } from "#/schemas/conform.js";
import { readJsonFile, resolveConfigPath } from "#/utils/fs.js";
import { parseOrThrow } from "#/utils/schema.js";

export interface ConformSource {
	id: string;
	ref: string;
	source: "github";
}

export interface ConformMachine {
	blueprint: string;
	configuration?: string;
}

export interface ConformProject {
	blueprint: string;
}

export interface LoadedConform {
	dir: string;
	machine?: ConformMachine;
	path: string;
	project?: ConformProject;
	source: ConformSource;
}

export interface ProjectRunSpec {
	blueprint: string;
	id: string;
	ref: string;
}

export interface MachineRunSpec {
	blueprint: string;
	configuration?: string;
	id: string;
	ref: string;
}

function toLoadedConfig(path: string, parsed: unknown): LoadedConform {
	const data = parseOrThrow(ConformSchema, path, parsed, "conform config");
	if (data.machine === undefined && data.project === undefined) {
		throw new Error(
			`Invalid conform config in ${path}: set at least one of "machine" or "project".`,
		);
	}
	return {
		dir: dirname(path),
		machine: data.machine,
		path,
		project: data.project,
		source: {
			id: data.source.repo,
			ref: data.source.ref,
			source: "github",
		},
	};
}

const CONFIG_FILENAME = "conform.json";

export async function loadConfig(configPath: string): Promise<LoadedConform> {
	const path = resolveConfigPath(configPath);
	const parsed = await readJsonFile(path, "Config");
	if (basename(path) !== CONFIG_FILENAME) {
		throw new Error(
			`Cannot load config from "${basename(path)}" in ${path} (expected ${CONFIG_FILENAME}).`,
		);
	}
	return toLoadedConfig(path, parsed);
}

export async function discoverConfigs(): Promise<LoadedConform[]> {
	const path = join(process.cwd(), CONFIG_FILENAME);
	if (!(await Bun.file(path).exists())) {
		throw new Error(`No config found in ${process.cwd()} (looked for ${CONFIG_FILENAME}).`);
	}
	return [await loadConfig(path)];
}

export function projectSpecOf(loaded: LoadedConform): ProjectRunSpec | undefined {
	if (loaded.project === undefined) {
		return undefined;
	}
	return { blueprint: loaded.project.blueprint, id: loaded.source.id, ref: loaded.source.ref };
}

export function machineSpecOf(loaded: LoadedConform): MachineRunSpec | undefined {
	if (loaded.machine === undefined) {
		return undefined;
	}
	return {
		blueprint: loaded.machine.blueprint,
		configuration: loaded.machine.configuration,
		id: loaded.source.id,
		ref: loaded.source.ref,
	};
}

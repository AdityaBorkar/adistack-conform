import { basename, dirname, join } from "node:path";

import { parseOrThrow } from "#/schemas/common.js";
import { MachineSchema } from "#/schemas/machine.js";
import { ProjectSchema } from "#/schemas/project.js";
import { readJsonFile, resolveConfigPath } from "#/utils/fs.js";

export interface TechStackSpec {
	blueprint?: string;
	exclude: string[];
	id: string;
	presets: string[];
	ref: string;
	source: "github";
}

export interface LoadedConfig {
	dir: string;
	kind: "machine" | "project";
	path: string;
	spec: TechStackSpec;
}

function presetSpecFrom(data: {
	blueprint: string;
	exclude: string[];
	presets: string[];
	source: { branch?: string; ref: string; repo: string };
}): TechStackSpec {
	return {
		blueprint: data.blueprint,
		exclude: data.exclude,
		id: data.source.repo,
		presets: data.presets,
		ref: data.source.branch ?? data.source.ref,
		source: "github",
	};
}

function toLoadedConfig(path: string, kind: LoadedConfig["kind"], parsed: unknown): LoadedConfig {
	const schema = kind === "machine" ? MachineSchema : ProjectSchema;
	return {
		dir: dirname(path),
		kind,
		path,
		spec: presetSpecFrom(parseOrThrow(schema, path, parsed, "conform config")),
	};
}

const CONFIG_FILENAMES = {
	"conform.machine.json": "machine",
	"conform.project.json": "project",
} as const satisfies Record<string, LoadedConfig["kind"]>;

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
	const path = resolveConfigPath(configPath);
	const parsed = await readJsonFile(path, "Config");
	const fileName = basename(path);
	const known = (CONFIG_FILENAMES as Record<string, LoadedConfig["kind"] | undefined>)[fileName];
	if (known === undefined) {
		// Project and machine configs share the same shape, so content-sniffing
		// cannot distinguish them. Require a canonical filename instead of
		// silently misclassifying machine configs as project.
		throw new Error(
			`Cannot infer config kind from filename "${fileName}" in ${path} (expected conform.project.json or conform.machine.json). Rename the file to declare its scope.`,
		);
	}
	return toLoadedConfig(path, known, parsed);
}

const DISCOVER_NAMES = Object.keys(CONFIG_FILENAMES);

export async function discoverConfigs(): Promise<LoadedConfig[]> {
	const cwd = process.cwd();
	const candidates = await Promise.all(
		DISCOVER_NAMES.map(async (name) => ({
			exists: await Bun.file(join(cwd, name)).exists(),
			name,
		})),
	);
	const found = await Promise.all(
		candidates
			.filter((candidate) => candidate.exists)
			.map((candidate) => loadConfig(join(cwd, candidate.name))),
	);
	if (found.length === 0) {
		throw new Error(`No config found in ${cwd} (looked for ${DISCOVER_NAMES.join(", ")}).`);
	}
	return found;
}

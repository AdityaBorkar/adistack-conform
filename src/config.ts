import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import untildify from "untildify";

import { errorMessage, readJsonFile } from "#/fs.js";
import { parseOrThrow } from "#/schemas/common.js";
import { MachineSchema } from "#/schemas/machine.js";
import { ProjectSchema } from "#/schemas/project.js";

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

function resolveAgainstBase(raw: string, base: string, expand: (value: string) => string): string {
	const expanded = expand(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(base, expanded);
}

export function resolveTargetPath(raw: string, baseDir: string, home: string): string {
	// Expand a leading ~ against the caller's home (respects $HOME overrides,
	// unlike untildify which caches os.homedir()). Anything else falls through
	// to untildify for ~user handling.
	return resolveAgainstBase(raw, baseDir, (value) =>
		/^~($|\/)/u.test(value) && home.length > 0
			? value === "~"
				? home
				: join(home, value.slice(2))
			: untildify(value),
	);
}

export function resolveConfigPath(raw: string): string {
	return resolveAgainstBase(raw, process.cwd(), (value) => untildify(value));
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

const BY_FILENAME = {
	"conform.machine.json": "machine",
	"conform.project.json": "project",
} as const;

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
	const path = resolveConfigPath(configPath);
	let parsed: unknown;
	try {
		parsed = await readJsonFile(path, "Config");
	} catch (error) {
		const detail = errorMessage(error);
		if (detail.includes("not found")) {
			throw new Error(`Config not found: ${path}`, { cause: error });
		}
		throw new Error(`Invalid JSON in ${path}: ${detail}`, { cause: error });
	}
	const fileName = basename(path);
	const known = (BY_FILENAME as Record<string, LoadedConfig["kind"] | undefined>)[fileName];
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

const DISCOVER_NAMES = ["conform.project.json", "conform.machine.json"];

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

// $HOME wins over /etc/passwd so machine targets follow the caller's env.
export function defaultHome(): string {
	return process.env["HOME"] ?? homedir();
}

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import untildify from "untildify";

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

export function resolveTargetPath(raw: string, baseDir: string, home: string): string {
	// Expand a leading ~ against the caller's home (respects $HOME overrides,
	// unlike untildify which caches os.homedir()). Anything else falls through
	// to untildify for ~user handling.
	const expanded =
		/^~($|\/)/u.test(raw) && home.length > 0
			? raw === "~"
				? home
				: join(home, raw.slice(2))
			: untildify(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(baseDir, expanded);
}

export function resolveConfigPath(raw: string): string {
	const expanded = untildify(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(process.cwd(), expanded);
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
		spec: presetSpecFrom(parseOrThrow(schema, path, parsed)),
	};
}

const BY_FILENAME = {
	"conform.machine.json": "machine",
	"conform.project.json": "project",
} as const;

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
	const path = resolveConfigPath(configPath);
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`Config not found: ${path}`);
	}
	let parsed: unknown;
	try {
		parsed = await file.json();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${path}: ${detail}`, { cause: error });
	}
	const fileName = basename(path);
	const known = (BY_FILENAME as Record<string, LoadedConfig["kind"] | undefined>)[fileName];
	if (known !== undefined) {
		return toLoadedConfig(path, known, parsed);
	}
	for (const kind of ["project", "machine"] as const) {
		const schema = kind === "machine" ? MachineSchema : ProjectSchema;
		if (schema.safeParse(parsed).success) {
			return toLoadedConfig(path, kind, parsed);
		}
	}
	return toLoadedConfig(path, "project", parsed);
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

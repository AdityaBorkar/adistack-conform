import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import untildify from "untildify";
import * as z from "zod";

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
	const expanded =
		raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : untildify(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(baseDir, expanded);
}

export function resolveConfigPath(raw: string): string {
	if (isAbsolute(raw)) {
		return raw;
	}
	return resolve(process.cwd(), raw);
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

function invalidConfigError(path: string, detail: string): Error {
	return new Error(
		`Invalid conform config in ${path} (expected conform.project.json or conform.machine.json format):\n${detail}`,
	);
}

function parseProjectConfig(path: string, parsed: unknown): z.infer<typeof ProjectSchema> {
	const project = ProjectSchema.safeParse(parsed);
	if (!project.success) {
		throw invalidConfigError(path, z.prettifyError(project.error));
	}
	return project.data;
}

function parseMachineConfig(path: string, parsed: unknown): z.infer<typeof MachineSchema> {
	const machine = MachineSchema.safeParse(parsed);
	if (!machine.success) {
		throw invalidConfigError(path, z.prettifyError(machine.error));
	}
	return machine.data;
}

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
	if (fileName === "conform.machine.json") {
		const machine = parseMachineConfig(path, parsed);
		return {
			dir: dirname(path),
			kind: "machine",
			path,
			spec: presetSpecFrom(machine),
		};
	}
	if (fileName === "conform.project.json") {
		return {
			dir: dirname(path),
			kind: "project",
			path,
			spec: presetSpecFrom(parseProjectConfig(path, parsed)),
		};
	}
	const project = ProjectSchema.safeParse(parsed);
	if (project.success) {
		return {
			dir: dirname(path),
			kind: "project",
			path,
			spec: presetSpecFrom(project.data),
		};
	}
	const machine = MachineSchema.safeParse(parsed);
	if (machine.success) {
		return {
			dir: dirname(path),
			kind: "machine",
			path,
			spec: presetSpecFrom(machine.data),
		};
	}
	throw invalidConfigError(path, z.prettifyError(project.error));
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

export function defaultHome(): string {
	return process.env["HOME"] ?? homedir();
}

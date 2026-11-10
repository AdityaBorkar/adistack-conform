import { dirname, join } from "node:path";

import { ConformSchema } from "#/schemas/conform.js";
import { readJsonFile, resolveDesiredStatePath } from "#/utils/fs.js";
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

export interface ConformGithub {
	blueprint: string;
	repo?: string;
}

export interface ConformProject {
	blueprint: string;
}

export interface LoadedDesiredState {
	dir: string;
	github?: ConformGithub;
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

export interface GithubRunSpec {
	blueprint: string;
	id: string;
	ref: string;
	repo?: string;
}

function toLoadedDesiredState(path: string, parsed: unknown): LoadedDesiredState {
	const data = parseOrThrow(ConformSchema, path, parsed, "desired state");
	if (data.github === undefined && data.machine === undefined && data.project === undefined) {
		throw new Error(
			`Invalid desired state in ${path}: set at least one of "github", "machine", or "project".`,
		);
	}
	return {
		dir: dirname(path),
		github: data.github,
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

export async function loadDesiredState(desiredStatePath: string): Promise<LoadedDesiredState> {
	const path = resolveDesiredStatePath(desiredStatePath);
	const parsed = await readJsonFile(path, "Desired state");
	return toLoadedDesiredState(path, parsed);
}

export async function discoverDesiredStates(): Promise<LoadedDesiredState[]> {
	let dir = process.cwd();
	while (true) {
		const path = join(dir, CONFIG_FILENAME);
		if (await Bun.file(path).exists()) {
			return [await loadDesiredState(path)];
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				`No desired state found from ${process.cwd()} up (looked for ${CONFIG_FILENAME}).`,
			);
		}
		dir = parent;
	}
}

export function projectSpecOf(loaded: LoadedDesiredState): ProjectRunSpec | undefined {
	if (loaded.project === undefined) {
		return undefined;
	}
	return { blueprint: loaded.project.blueprint, id: loaded.source.id, ref: loaded.source.ref };
}

export function machineSpecOf(loaded: LoadedDesiredState): MachineRunSpec | undefined {
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

export function githubSpecOf(loaded: LoadedDesiredState): GithubRunSpec | undefined {
	if (loaded.github === undefined) {
		return undefined;
	}
	return {
		blueprint: loaded.github.blueprint,
		id: loaded.source.id,
		ref: loaded.source.ref,
		repo: loaded.github.repo,
	};
}

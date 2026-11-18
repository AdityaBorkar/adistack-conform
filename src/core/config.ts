import { dirname, join } from "node:path";

import type * as z from "zod";

import type { CheckScope } from "#/core/result.js";
import { ConformSchema } from "#/schemas/config.js";
import { readJsonFile, resolveDesiredStatePath } from "#/utils/fs.js";
import { parseOrThrow } from "#/utils/schema.js";

type Conform = z.infer<typeof ConformSchema>;

export type LoadedDesiredState = Pick<Conform, CheckScope> & {
	dir: string;
	path: string;
	// `id` is the tech-stack owner/repo.
	source: { id: string; ref: string };
};

// One scope's slice of the desired state plus the tech-stack source it reads from.
export interface RunState {
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
		source: { id: data.source.repo, ref: data.source.ref },
	};
}

const DESIRED_STATE_FILENAME = "conform.json";

// The global `--desired-state <path>` flag every command accepts.
export type DesiredStateOption = { desiredState?: string };

async function discoverDesiredStatePath(): Promise<string> {
	let dir = process.cwd();
	while (true) {
		const path = join(dir, DESIRED_STATE_FILENAME);
		if (await Bun.file(path).exists()) {
			return path;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				`No desired state found from ${process.cwd()} up (looked for ${DESIRED_STATE_FILENAME}).`,
			);
		}
		dir = parent;
	}
}

// An explicit path loads that file; otherwise walk up from the cwd.
export async function loadDesiredState(path: string | undefined): Promise<LoadedDesiredState> {
	const resolved =
		path === undefined ? await discoverDesiredStatePath() : resolveDesiredStatePath(path);
	return toLoadedDesiredState(resolved, await readJsonFile(resolved, "Desired state"));
}

export function stateOf(loaded: LoadedDesiredState, scope: CheckScope): RunState | undefined {
	const section = loaded[scope];
	return section === undefined ? undefined : { ...section, ...loaded.source };
}

export type ScopeOptions = { githubOnly?: boolean; machineOnly?: boolean; projectOnly?: boolean };

export function scopeOf(options: ScopeOptions): CheckScope | undefined {
	const selected = [options.projectOnly, options.machineOnly, options.githubOnly].filter(
		(item) => item === true,
	).length;
	if (selected > 1) {
		throw new Error("Pass only one of --project-only / --machine-only / --github-only.");
	}
	if (options.projectOnly) {
		return "project";
	}
	if (options.machineOnly) {
		return "machine";
	}
	if (options.githubOnly) {
		return "github";
	}
	return undefined;
}

// Scopes this run checks: the configured ones, narrowed by a --*-only flag.
export function activeScopes(
	loaded: LoadedDesiredState,
	only: CheckScope | undefined,
): CheckScope[] {
	const configured = (["project", "machine", "github"] as const).filter(
		(scope) => loaded[scope] !== undefined,
	);
	if (only === undefined) {
		return configured;
	}
	if (!configured.includes(only)) {
		throw new Error(`Scope "${only}" is not configured in ${loaded.path}.`);
	}
	return [only];
}

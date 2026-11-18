import { dirname, join } from "node:path";

import type * as z from "zod";

import type { CheckResult, CheckScope } from "#/core/result.js";
import type { TechStack } from "#/core/upstream/tech-stack.js";
import { ConformSchema } from "#/schemas/config.js";
import { readJsonFile, resolveConfigPath } from "#/utils/fs.js";
import { parseOrThrow } from "#/utils/schema.js";

type Conform = z.infer<typeof ConformSchema>;

export type LoadedDesiredState = Pick<Conform, CheckScope> & {
	dir: string;
	path: string;
	// `id` is the tech-stack owner/repo.
	source: { id: string; ref: string };
};

// One scope's slice of the desired state; the pin it reads from is the run's tech-stack.
export interface RunState {
	blueprint: string;
	repo?: string;
}

// Everything one scope's check reads for one run.
interface ScopeContext {
	// The dir that owns conform.json: project targets resolve against it, not the cwd.
	baseDir: string;
	home: string;
	state: RunState;
	strict: boolean;
	// The pinned tech-stack repo, opened once for the whole run.
	techStack: TechStack;
}

// The one interface every scope implements. `onlyIds` holds a re-check's
// selected IDs for this scope; a scope that cannot narrow (machine, GitHub,
// see ADR 0011) ignores it and re-checks whole.
export type ScopeCheck = (
	ctx: ScopeContext,
	onlyIds?: ReadonlySet<string>,
) => Promise<CheckResult[]>;

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

// The per-command `--path <path>` flag: conform.json for check/fix,
// registry.json (or its directory) for validate.
export type ConfigPathOption = { path?: string };

async function discoverDesiredStatePath(): Promise<string> {
	const path = join(process.cwd(), DESIRED_STATE_FILENAME);
	if (await Bun.file(path).exists()) {
		return path;
	}
	throw new Error(
		`No desired state found in ${process.cwd()} (looked for ${DESIRED_STATE_FILENAME}).`,
	);
}

// An explicit path loads that file; otherwise ./conform.json in the cwd.
export async function loadDesiredState(path: string | undefined): Promise<LoadedDesiredState> {
	const resolved = path === undefined ? await discoverDesiredStatePath() : resolveConfigPath(path);
	return toLoadedDesiredState(resolved, await readJsonFile(resolved, "Desired state"));
}

export function stateOf(loaded: LoadedDesiredState, scope: CheckScope): RunState | undefined {
	const section = loaded[scope];
	return section;
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

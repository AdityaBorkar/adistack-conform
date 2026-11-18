import { chmod, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { errorMessage } from "#/utils/error.js";

export async function readJsonFile(path: string, label: string): Promise<unknown> {
	try {
		return (await Bun.file(path).json()) as unknown;
	} catch (error) {
		if (isMissingError(error)) {
			throw new Error(`${label} not found: ${path}`, { cause: error });
		}
		throw new Error(`${label} has invalid JSON in ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
}

export type FileRead =
	| { ok: false; reason: "missing" }
	| { error: string; ok: false; reason: "unreadable" }
	| { ok: true; text: string };

export async function readFileSafe(path: string): Promise<FileRead> {
	try {
		return { ok: true, text: await Bun.file(path).text() };
	} catch (error) {
		if (isMissingError(error)) {
			return { ok: false, reason: "missing" };
		}
		return { error: errorMessage(error), ok: false, reason: "unreadable" };
	}
}

export function isMissingError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	return (error as { code?: unknown }).code === "ENOENT";
}

// With `mode`, an existing file is narrowed before the new content lands and a
// new file is created with that mode, so secrets are never briefly world-readable.
export async function writeFileEnsuringDir(
	path: string,
	content: string | Uint8Array,
	mode?: number,
): Promise<void> {
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			throw new Error(`Refusing to write through symlink: ${path}`);
		}
	} catch (error) {
		if (!isMissingError(error)) {
			throw error;
		}
	}
	await mkdir(dirname(path), { recursive: true });
	if (mode === undefined) {
		await Bun.write(path, content);
		return;
	}
	try {
		await chmod(path, mode);
	} catch (error) {
		if (!isMissingError(error)) {
			throw error;
		}
	}
	await writeFile(path, content, { mode });
}

function expandHome(value: string, home: string): string {
	if (/^~($|\/)/u.test(value) && home.length > 0) {
		return value === "~" ? home : join(home, value.slice(2));
	}
	return value;
}

function resolveAgainstBase(raw: string, base: string, expand: (value: string) => string): string {
	const expanded = expand(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(base, expanded);
}

// $HOME wins over /etc/passwd so machine targets follow the caller's env.
export function defaultHome(): string {
	return process.env["HOME"] ?? homedir();
}

export function resolveTargetPath(raw: string, baseDir: string, home: string): string {
	// Expand a leading ~ against the caller's home (respects $HOME overrides).
	return resolveAgainstBase(raw, baseDir, (value) => expandHome(value, home));
}

export function resolveDesiredStatePath(raw: string): string {
	return resolveAgainstBase(raw, process.cwd(), (value) => expandHome(value, defaultHome()));
}

// Where a path really lives: symlinks in every existing ancestor resolved,
// the not-yet-existing tail appended as-is.
export async function realPathOf(path: string): Promise<string> {
	const abs = resolve(path);
	try {
		return await realpath(abs);
	} catch (error) {
		if (!isMissingError(error)) {
			throw error;
		}
	}
	const parent = dirname(abs);
	return parent === abs ? abs : join(await realPathOf(parent), basename(abs));
}

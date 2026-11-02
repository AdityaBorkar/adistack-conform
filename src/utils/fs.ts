import { mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import untildify from "untildify";

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

export function fileExists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

export function readText(path: string): Promise<string> {
	return Bun.file(path).text();
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

function isMissingError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

export async function removePath(path: string): Promise<void> {
	await rm(path, { force: true, recursive: true });
}

export async function moveOverwrite(source: string, dest: string): Promise<void> {
	await mkdir(dirname(dest), { recursive: true });
	await rm(dest, { force: true, recursive: true });
	await rename(source, dest);
}

export async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, content);
}

export function expandHome(value: string, home: string): string {
	if (/^~($|\/)/u.test(value) && home.length > 0) {
		return value === "~" ? home : join(home, value.slice(2));
	}
	return untildify(value);
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
	// Expand a leading ~ against the caller's home (respects $HOME overrides,
	// unlike untildify which caches os.homedir()). Anything else falls through
	// to untildify for ~user handling.
	return resolveAgainstBase(raw, baseDir, (value) => expandHome(value, home));
}

export function resolveConfigPath(raw: string): string {
	return resolveAgainstBase(raw, process.cwd(), (value) => untildify(value));
}

import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { copyFile, lstat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { fixGithubApiFix } from "#/core/github/api.js";
import type { CheckFix, CheckResult, OverwriteFileFix, RunCommandStep } from "#/core/result.js";
import { errorMessage } from "#/utils/error.js";
import { isMissingError, realPathOf, writeFileEnsuringDir } from "#/utils/fs.js";
import { runCommand } from "#/utils/process.js";

const FIX_TIMEOUT_MS = 10 * 60_000;

async function lstatOrMissing(path: string): Promise<Stats | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isMissingError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isMissingError(error)) {
			throw error;
		}
	}
}

// Backs up a regular file to the next free .conform.bak[.N]. A symlink is
// replaced without a backup (it holds no content; unlinking never copies its
// target). Directories and special files refuse. copyFile keeps the
// mode, so a 0600 file never gets a world-readable backup; COPYFILE_EXCL never
// overwrites an older backup. `single` keeps one backup (secrets files), so
// decrypted copies do not pile up.
async function backupExistingFile(filePath: string, single = false): Promise<string | undefined> {
	const info = await lstatOrMissing(filePath);
	if (info === undefined) {
		return undefined;
	}
	if (info.isSymbolicLink()) {
		await unlinkIfPresent(filePath);
		return undefined;
	}
	if (!info.isFile()) {
		throw new Error(`Refusing to replace ${filePath}: not a regular file.`);
	}
	if (single) {
		await unlinkIfPresent(`${filePath}.conform.bak`);
	}
	for (let suffix = 0; suffix < 100; suffix += 1) {
		const backupPath = `${filePath}.conform.bak${suffix === 0 ? "" : `.${suffix}`}`;
		try {
			await copyFile(filePath, backupPath, constants.COPYFILE_EXCL);
			return backupPath;
		} catch (error) {
			if ((error as { code?: unknown } | null)?.code !== "EEXIST") {
				throw error;
			}
		}
	}
	throw new Error(`Too many backups of ${filePath}; remove old .conform.bak files first.`);
}

// Applies an overwrite once per path: an identical second write is a no-op,
// a different one is a blueprint conflict the user must resolve.
async function overwriteFile(
	fix: OverwriteFileFix,
	written: Map<string, string>,
): Promise<string | undefined> {
	const prior = written.get(fix.filePath);
	if (prior !== undefined) {
		if (prior === fix.newContent) {
			return "already written";
		}
		throw new Error(
			`conflicting fixes write different content to ${fix.filePath}; resolve the blueprints manually.`,
		);
	}
	const backup = await backupExistingFile(fix.filePath, fix.secret === true);
	const mode = fix.mode === undefined ? undefined : Number.parseInt(fix.mode, 8);
	await writeFileEnsuringDir(fix.filePath, fix.newContent, mode);
	written.set(fix.filePath, fix.newContent);
	return backupNote(backup);
}

function backupNote(backup: string | undefined): string | undefined {
	return backup === undefined ? undefined : `backup: ${backup}`;
}

// What a fix would change, shown before selection. `lines` are untrusted
// plain text the report sanitizes; `expected` is rendered as a diff.
export type FixPreview = { lines: string[]; verb: string } | { expected: string; verb: "diff" };

type FixOf<K extends CheckFix["kind"]> = Extract<CheckFix, { kind: K }>;

// Setup steps first, main command last. A fix is itself a step, so it trails
// its own preCommands.
function runCommandSteps(fix: FixOf<"run-command">): RunCommandStep[] {
	return [...(fix.preCommands ?? []), fix];
}

// Everything one fix kind does, in one place. The mapped table below fails to
// compile until a new kind provides every member.
interface FixKind<F extends CheckFix> {
	// Applies the fix; returns a note for the "fixed" line (e.g. the backup path).
	apply: (fix: F, written: Map<string, string>) => Promise<string | void>;
	describe: (fix: F) => string;
	// JSON-safe form for --json: no secrets, no raw bytes.
	forJson: (fix: F) => unknown;
	preview: (fix: F) => FixPreview;
	// Refused under unattended --all: runs commands or edits GitHub (ADR 0010).
	risky: boolean;
	// The path the fix replaces, which unattended --all keeps inside the project.
	writes?: (fix: F) => string;
}

const FIX_KINDS: { [K in CheckFix["kind"]]: FixKind<FixOf<K>> } = {
	"github-api": {
		apply: async (fix) => {
			await fixGithubApiFix(fix);
		},
		describe: (fix) => `api ${fix.label}`,
		forJson: (fix) => fix,
		preview: (fix) => ({
			lines: fix.steps.map((step) => `${step.method} ${step.path}`),
			verb: "api",
		}),
		risky: true,
	},
	"overwrite-file": {
		apply: overwriteFile,
		describe: (fix) => `overwrite ${fix.filePath}`,
		forJson: (fix) => (fix.secret === true ? { ...fix, newContent: "<redacted>" } : fix),
		preview: (fix) =>
			fix.secret === true
				? { lines: ["<diff hidden: content holds secrets>"], verb: "write" }
				: { expected: fix.newContent, verb: "diff" },
		risky: false,
		writes: (fix) => fix.filePath,
	},
	"run-command": {
		apply: async (fix) => {
			for (const step of runCommandSteps(fix)) {
				await runCommand([step.command, ...step.args], step.label, FIX_TIMEOUT_MS);
			}
		},
		describe: (fix) =>
			`run ${runCommandSteps(fix)
				.map((step) => step.label)
				.join(" && ")}`,
		forJson: (fix) => fix,
		preview: (fix) => ({ lines: runCommandSteps(fix).map((step) => step.label), verb: "run" }),
		risky: true,
	},
};

function kindOf<F extends CheckFix>(fix: F): FixKind<F> {
	// The table is keyed by kind, so this entry handles exactly F.
	return FIX_KINDS[fix.kind] as unknown as FixKind<F>;
}

export function describeFix(result: CheckResult): string {
	return result.fix === undefined ? "manual" : kindOf(result.fix).describe(result.fix);
}

export function fixPreview(result: CheckResult): FixPreview {
	return result.fix === undefined
		? { expected: result.expected, verb: "diff" }
		: kindOf(result.fix).preview(result.fix);
}

export function fixForJson(result: CheckResult): CheckResult {
	return result.fix === undefined
		? result
		: { ...result, fix: kindOf(result.fix).forJson(result.fix) as CheckFix };
}

async function fixOnce(item: CheckResult, written: Map<string, string>): Promise<void> {
	const fix = item.fix;
	if (fix === undefined) {
		throw new Error(`Result ${item.id} is not fixable.`);
	}
	const note = await kindOf(fix).apply(fix, written);
	console.log(`✓ fixed ${item.id}${typeof note === "string" ? ` (${note})` : ""}`);
}

export async function fixSelected(selected: CheckResult[]): Promise<CheckResult[]> {
	// File writes first so conflicting same-path fixes are coalesced through
	// the `written` map before any command fix runs; order within each group
	// follows selection order.
	const files = selected.filter((item) => item.fix?.kind === "overwrite-file");
	const ordered = [...files, ...selected.filter((item) => item.fix?.kind !== "overwrite-file")];
	const written = new Map<string, string>();
	const fixed: CheckResult[] = [];
	for (const item of ordered) {
		try {
			await fixOnce(item, written);
			fixed.push(item);
		} catch (error) {
			console.error(`✗ not fixed ${item.id}: ${errorMessage(error)}`);
		}
	}
	return fixed;
}

// Compares real locations: a symlinked parent dir (e.g. `.github -> /elsewhere`)
// cannot smuggle a write out of the project. The last segment stays literal,
// since fixes replace it rather than write through it.
async function isInsideDir(filePath: string, realDir: string): Promise<boolean> {
	const real = join(await realPathOf(dirname(filePath)), basename(filePath));
	const rel = relative(realDir, real);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// `--all` without a TTY never runs commands, edits GitHub, or writes outside
// the project: returns why it refuses, or undefined when every fix is safe.
export async function unattendedRefusal(
	fixable: readonly CheckResult[],
	projectDir: string,
): Promise<string | undefined> {
	const risky = fixable.filter((item) => item.fix !== undefined && kindOf(item.fix).risky);
	if (risky.length > 0) {
		return `Refusing --all in non-TTY: ${risky.length} fix(es) run commands or edit GitHub (${risky.map((item) => item.id).join(", ")}). Run again in a terminal or select file-only fixes.`;
	}
	const realDir = await realPathOf(projectDir);
	const outside: CheckResult[] = [];
	for (const item of fixable) {
		const path = item.fix === undefined ? undefined : kindOf(item.fix).writes?.(item.fix);
		if (path !== undefined && !(await isInsideDir(path, realDir))) {
			outside.push(item);
		}
	}
	if (outside.length > 0) {
		return `Refusing --all in non-TTY: ${outside.length} fix(es) write outside the project dir (${outside.map((item) => item.id).join(", ")}). Run again in a terminal to confirm.`;
	}
	return undefined;
}

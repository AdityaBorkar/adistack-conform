import { lstat, mkdtemp, readlink, rmdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { LinkStat, TemplateTarget } from "#/stack/machine-files.js";
import { bunManager } from "#/stack/managers/bun.js";
import { pacmanManager } from "#/stack/managers/pacman.js";
import type { InstalledPackages } from "#/stack/managers/types.js";
import { fetchBytesOrThrow, fetchTextOrThrow, rawUrl } from "#/stack/remote.js";
import type { MachineRunState } from "#/utils/config.js";
import { errorMessage } from "#/utils/fs.js";

// Live reality behind the machine checks. Every member is a small injectable
// function so tests can fake the whole machine without network or disk.
// Failures reject with a cause; check code surfaces the message in hints.
export interface MachineLive {
	decryptSecrets: () => Promise<Record<string, string>>;
	fetchSource: (rel: string) => Promise<Uint8Array>;
	fetchText: (rel: string) => Promise<string>;
	listBun: () => Promise<InstalledPackages>;
	listPacman: () => Promise<InstalledPackages>;
	readTemplateTarget: (abs: string) => Promise<TemplateTarget>;
	statLink: (targetAbs: string) => Promise<LinkStat>;
}

export async function statLinkPath(targetAbs: string): Promise<LinkStat> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(targetAbs);
	} catch (error) {
		if ((error as { code?: unknown } | null)?.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
	}
	if (info.isSymbolicLink()) {
		const dest = await readlink(targetAbs);
		let bytes: Uint8Array | undefined;
		try {
			bytes = new Uint8Array(await Bun.file(targetAbs).arrayBuffer());
		} catch {
			// Dangling link: dest alone still classifies wrong-link/dangling.
			bytes = undefined;
		}
		return { bytes, dest, kind: "symlink" };
	}
	return { isFile: info.isFile(), kind: "other" };
}

export async function readTemplateTargetPath(abs: string): Promise<TemplateTarget> {
	let mode: string | undefined;
	let isFile = false;
	try {
		const info = await stat(abs);
		isFile = info.isFile();
		mode = (info.mode & 0o777).toString(8);
	} catch (error) {
		if ((error as { code?: unknown } | null)?.code === "ENOENT") {
			return { exists: false };
		}
		throw error;
	}
	if (!isFile) {
		return { exists: true, mode };
	}
	return { exists: true, mode, text: await Bun.file(abs).text() };
}

// Flat `KEY: value` lines only (values are strings); skips comments and
// document markers. Anything else (indented or nested lines) throws instead
// of silently dropping data, so a secrets file with unexpected structure
// fails loudly at decrypt time rather than rendering empty values.
export function parseSimpleMapping(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [index, raw] of text.split("\n").entries()) {
		if (raw === "" || raw.startsWith("#") || raw === "---" || raw === "...") {
			continue;
		}
		const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/u.exec(raw);
		if (match?.[1] === undefined) {
			throw new Error(
				`Unsupported secrets line ${index + 1}: ${JSON.stringify(raw)} (flat KEY: value only; nested blocks are not supported).`,
			);
		}
		let value = match[2] ?? "";
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		values[match[1]] = value;
	}
	return values;
}

// The sops-encrypted secrets file lives next to the machine manifest.
export function machineSecretsRel(manifestRel: string): string {
	const dir = dirname(manifestRel);
	return dir === "" || dir === "." ? "secrets.yaml" : `${dir}/secrets.yaml`;
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	// Private temp dir (0700) with a random suffix: the name cannot be
	// guessed for symlink hijacks, and the encrypted bytes are never
	// world-readable through the dir even if the file mode is 0644.
	const dir = await mkdtemp(join(tmpdir(), "conform-secrets-"));
	try {
		return await run(dir);
	} finally {
		try {
			await unlink(join(dir, "secrets.yaml"));
		} catch {
			// Best-effort temp cleanup; the run result does not depend on it.
		}
		try {
			await rmdir(dir);
		} catch {
			// Best-effort temp cleanup.
		}
	}
}

export async function decryptSecretsLive(
	id: string,
	ref: string,
	secretsRel: string,
): Promise<Record<string, string>> {
	let encrypted: string;
	try {
		encrypted = await fetchTextOrThrow(rawUrl(id, ref, secretsRel), `secrets file ${secretsRel}`);
	} catch (error) {
		throw new Error(`Cannot fetch secrets file ${secretsRel}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	return withTempDir(async (dir) => {
		const tmp = join(dir, "secrets.yaml");
		try {
			await Bun.write(tmp, encrypted);
		} catch (error) {
			throw new Error(`Cannot stage secrets file for sops: ${errorMessage(error)}`, {
				cause: error,
			});
		}
		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(["sops", "--decrypt", tmp], {
				stderr: "pipe",
				stdin: "ignore",
				stdout: "pipe",
			});
		} catch (error) {
			throw new Error(`Cannot run sops --decrypt (is sops installed?): ${errorMessage(error)}`, {
				cause: error,
			});
		}
		const { stderr, stdout } = proc;
		if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
			throw new TypeError("Cannot capture sops --decrypt output.");
		}
		const [text, errText, code] = await Promise.all([
			new Response(stdout).text(),
			new Response(stderr).text(),
			proc.exited,
		]);
		if (code !== 0) {
			const detail = errText.trim();
			throw new Error(
				`sops --decrypt failed (exit ${code})${detail === "" ? "" : `: ${detail}`}; fix decryption (age key?), then re-check.`,
			);
		}
		return parseSimpleMapping(text);
	});
}

export function defaultLive(state: MachineRunState, manifestRel: string): MachineLive {
	const secretsRel = machineSecretsRel(manifestRel);
	return {
		decryptSecrets: () => decryptSecretsLive(state.id, state.ref, secretsRel),
		fetchSource: (rel: string) =>
			fetchBytesOrThrow(rawUrl(state.id, state.ref, rel), `blueprint file ${rel}`),
		fetchText: (rel: string) =>
			fetchTextOrThrow(rawUrl(state.id, state.ref, rel), `blueprint file ${rel}`),
		listBun: () => bunManager.list(),
		listPacman: () => pacmanManager.list(),
		readTemplateTarget: readTemplateTargetPath,
		statLink: statLinkPath,
	};
}

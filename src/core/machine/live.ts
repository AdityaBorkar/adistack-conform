import { lstat, mkdtemp, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunState } from "#/core/config.js";
import type { LinkStat } from "#/core/machine/links.js";
import type { InstalledPackages, ManagerId } from "#/core/machine/managers/types.js";
import { MANAGERS } from "#/core/machine/packages.js";
import type { SecretsTemplateTarget } from "#/core/machine/templates.js";
import { machineSecretsRel } from "#/core/upstream/blueprint.js";
import { fetchBytesOrThrow, fetchTextOrThrow, rawUrl } from "#/core/upstream/remote.js";
import { errorMessage } from "#/utils/error.js";
import { isMissingError } from "#/utils/fs.js";
import { setOwn } from "#/utils/json.js";
import { captureCommand } from "#/utils/process.js";

// Live reality behind the machine checks. Every member is a small injectable
// function so tests can fake the whole machine without network or disk.
// Failures reject with a cause; check code surfaces the message in hints.
export interface MachineLive {
	decryptSecrets: () => Promise<Record<string, string>>;
	fetchSource: (rel: string) => Promise<Uint8Array>;
	fetchText: (rel: string) => Promise<string>;
	listPackages: (manager: ManagerId) => Promise<InstalledPackages>;
	readSecretsTemplateTarget: (abs: string) => Promise<SecretsTemplateTarget>;
	statLink: (targetAbs: string) => Promise<LinkStat>;
}

async function statLinkPath(targetAbs: string): Promise<LinkStat> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(targetAbs);
	} catch (error) {
		if (isMissingError(error)) {
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

async function readSecretsTemplateTarget(abs: string): Promise<SecretsTemplateTarget> {
	let mode: string | undefined;
	let isFile = false;
	try {
		const info = await stat(abs);
		isFile = info.isFile();
		mode = (info.mode & 0o777).toString(8);
	} catch (error) {
		if (isMissingError(error)) {
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
		const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*?)\s*$/u.exec(raw);
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
		setOwn(values, match[1], value);
	}
	return values;
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
			await rm(dir, { force: true, recursive: true });
		} catch {
			// Best-effort temp cleanup; the run result does not depend on it.
		}
	}
}

async function decryptSecretsLive(
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
		await Bun.write(tmp, encrypted);
		let text: string;
		try {
			text = await captureCommand(["sops", "--decrypt", tmp]);
		} catch (error) {
			throw new Error(
				`sops --decrypt failed (is sops installed, with the age key available?): ${errorMessage(error)}`,
				{ cause: error },
			);
		}
		return parseSimpleMapping(text);
	});
}

export function defaultLive(state: RunState, manifestRel: string): MachineLive {
	const secretsRel = machineSecretsRel(manifestRel);
	return {
		decryptSecrets: () => decryptSecretsLive(state.id, state.ref, secretsRel),
		fetchSource: (rel: string) =>
			fetchBytesOrThrow(rawUrl(state.id, state.ref, rel), `blueprint file ${rel}`),
		fetchText: (rel: string) =>
			fetchTextOrThrow(rawUrl(state.id, state.ref, rel), `blueprint file ${rel}`),
		listPackages: (manager) => MANAGERS[manager].list(),
		readSecretsTemplateTarget,
		statLink: statLinkPath,
	};
}

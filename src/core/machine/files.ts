import type { CheckBase, CheckResult, OverwriteFileFix } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass } from "#/core/result.js";
import { UPSTREAM_FETCH_CONCURRENCY } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

interface MachineFile {
	name: string;
	source: string;
	// Absolute (already resolved against $HOME).
	target: string;
}

export type FileStat =
	| { kind: "missing" }
	| { isFile: boolean; kind: "other" }
	| { kind: "symlink" }
	| { kind: "file"; text: string };

interface CheckFilesArgs {
	blueprint: string;
	fetch: (source: string) => Promise<string>;
	files: MachineFile[];
	stat: (target: string) => Promise<FileStat>;
}

function fileBase(blueprint: string, file: MachineFile): CheckBase {
	return checkBase("machine", blueprint, `file:${file.name}`, file.target);
}

async function checkFile(args: CheckFilesArgs, file: MachineFile): Promise<CheckResult> {
	const base = fileBase(args.blueprint, file);
	let current: FileStat;
	try {
		current = await args.stat(file.target);
	} catch (error) {
		return failManual(
			base,
			"<unreadable>",
			file.source,
			`Cannot stat ${file.target}: ${errorMessage(error)}`,
		);
	}
	let upstream: string;
	try {
		upstream = await args.fetch(file.source);
	} catch (error) {
		return failManual(
			base,
			"<blueprint fetch failed>",
			file.source,
			`Cannot fetch blueprint file ${file.source}: ${errorMessage(error)}; fix the network or blueprint, then re-check.`,
		);
	}
	const fix: OverwriteFileFix = {
		filePath: file.target,
		kind: "overwrite-file",
		newContent: upstream,
	};
	if (current.kind === "missing") {
		return failFixable(base, "<missing>", upstream, fix);
	}
	if (current.kind === "other") {
		return failManual(
			base,
			"<directory or special file>",
			upstream,
			`${file.target} is not a regular file; move it aside, then re-check.`,
		);
	}
	// Symlinks are drift from the previous symlink strategy: replace them with
	// a regular file carrying the upstream content. No backup is kept for the
	// link itself; a stale `<target>.conform-src` sibling can be deleted.
	if (current.kind === "symlink") {
		const outcome = failFixable(base, "<symlink>", upstream, fix);
		outcome.hint = `Fix replaces the symlink at ${file.target} with a regular file. Delete ${file.target}.conform-src when it is stale.`;
		return outcome;
	}
	if (current.text !== upstream) {
		return failFixable(base, current.text, upstream, fix);
	}
	return pass(base, "matches upstream", upstream);
}

// Files own paths, not dirs, so extras are never reported and strictness does not apply.
export function checkFiles(args: CheckFilesArgs): Promise<CheckResult[]> {
	return mapWithConcurrency(args.files, UPSTREAM_FETCH_CONCURRENCY, (file) =>
		checkFile(args, file),
	);
}

import type { CheckBase, CheckResult, SymlinkFix } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass } from "#/core/result.js";
import { UPSTREAM_FETCH_CONCURRENCY } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

interface MachineLink {
	name: string;
	source: string;
	// Absolute (already resolved against $HOME).
	target: string;
}

export type LinkStat =
	| { kind: "missing" }
	| { isFile: boolean; kind: "other" }
	| { bytes: Uint8Array | undefined; dest: string; kind: "symlink" };

interface CheckLinksArgs {
	blueprint: string;
	fetch: (source: string) => Promise<Uint8Array>;
	links: MachineLink[];
	stat: (target: string) => Promise<LinkStat>;
}

// The fix materializes the upstream bytes at this sibling path, then links
// target -> cache. Deriving it from the target alone keeps check pure (mirrors
// the .conform.bak sibling convention).
export function linkCachePath(targetPath: string): string {
	return `${targetPath}.conform-src`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function linkBase(blueprint: string, link: MachineLink): CheckBase {
	return checkBase("machine", blueprint, `link:${link.name}`, link.target);
}

async function checkLink(args: CheckLinksArgs, link: MachineLink): Promise<CheckResult> {
	const base = linkBase(args.blueprint, link);
	let current: LinkStat;
	try {
		current = await args.stat(link.target);
	} catch (error) {
		return failManual(
			base,
			"<unreadable>",
			link.source,
			`Cannot stat ${link.target}: ${errorMessage(error)}`,
		);
	}
	let upstream: Uint8Array;
	try {
		upstream = await args.fetch(link.source);
	} catch (error) {
		return failManual(
			base,
			"<blueprint fetch failed>",
			link.source,
			`Cannot fetch blueprint file ${link.source}: ${errorMessage(error)}; fix the network or blueprint, then re-check.`,
		);
	}
	const cachePath = linkCachePath(link.target);
	const expected = `symlink to ${cachePath}`;
	const fix: SymlinkFix = {
		cachePath,
		content: upstream,
		kind: "symlink",
		label: `link ${link.target} -> ${cachePath}`,
		targetAbs: link.target,
	};
	if (current.kind === "missing") {
		return failFixable(base, "<missing>", expected, fix);
	}
	if (current.kind === "other") {
		// The fix only ever replaces a regular file (after a backup).
		if (!current.isFile) {
			return failManual(
				base,
				"<directory or special file>",
				expected,
				`${link.target} is not a regular file; move it aside, then re-check.`,
			);
		}
		const outcome = failFixable(base, "<regular file>", expected, fix);
		outcome.hint = `Fix backs ${link.target} up to ${link.target}.conform.bak, then links it.`;
		return outcome;
	}
	// Dest equality comes first: a link pointing elsewhere is drift even when
	// the bytes behind it match.
	if (current.dest !== cachePath) {
		return failFixable(base, `symlink to ${current.dest}`, expected, fix);
	}
	if (current.bytes === undefined) {
		return failFixable(
			base,
			"<dangling symlink (cache missing)>",
			`${expected} with upstream content`,
			fix,
		);
	}
	if (!bytesEqual(current.bytes, upstream)) {
		return failFixable(
			base,
			"<content differs from upstream>",
			`${expected} with upstream content`,
			fix,
		);
	}
	return pass(base, expected, expected);
}

// Links own paths, not dirs, so extras are never reported and strictness does not apply.
export function checkLinks(args: CheckLinksArgs): Promise<CheckResult[]> {
	return mapWithConcurrency(args.links, UPSTREAM_FETCH_CONCURRENCY, (link) =>
		checkLink(args, link),
	);
}

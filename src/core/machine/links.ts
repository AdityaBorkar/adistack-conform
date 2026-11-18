import { linkCachePath } from "#/core/machine/paths.js";
import type { CheckBase, CheckResult, SymlinkFix } from "#/core/result.js";
import { failFixable, failManual, pass } from "#/core/result.js";
import { UPSTREAM_FETCH_CONCURRENCY } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

export type LinkStatus = "pass" | "missing" | "wrong-link" | "regular" | "fetch-error";

export interface MachineLink {
	name: string;
	source: string;
	target: string;
}

export type LinkStat =
	| { kind: "missing" }
	| { isFile: boolean; kind: "other" }
	| { bytes: Uint8Array | undefined; dest: string; kind: "symlink" };

export interface CheckLinksArgs {
	blueprint: string;
	fetch: (source: string) => Promise<Uint8Array>;
	links: MachineLink[];
	stat: (target: string) => Promise<LinkStat>;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((byte, index) => byte === right[index]);
}

// Symlink (not overwrite-file): the link must point at the fetched upstream
// materialized at linkCachePath, and only the fix step can write those bytes
// before linking, so the fix carries both paths as structured data. The
// fix step moves a regular file to .conform.bak first (same backup rule as
// the project fix flow).
function linkFix(cachePath: string, target: string): SymlinkFix {
	return {
		cachePath,
		kind: "symlink",
		label: `ln -sfn ${cachePath} ${target}`,
		targetAbs: target,
	};
}

function linkBase(blueprint: string, link: MachineLink): CheckBase {
	return {
		id: `machine:${blueprint}:link:${link.name}`,
		kind: "machine",
		scope: "machine",
		target: link.target,
		upstream: `tech-stack:${blueprint}`,
	};
}

// Links own paths, not dirs, so extras are never reported (no dir listing)
// and conform/drift coincide: no mode needed.
export function checkLinks(args: CheckLinksArgs): Promise<CheckResult[]> {
	return mapWithConcurrency(args.links, UPSTREAM_FETCH_CONCURRENCY, async (link) => {
		const base = linkBase(args.blueprint, link);
		let upstreamBytes: Uint8Array | null = null;
		let fetchError = "";
		try {
			upstreamBytes = await args.fetch(link.source);
		} catch (error) {
			fetchError = errorMessage(error);
		}
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
		const cachePath = linkCachePath(link.target);
		// Dest equality comes first: a link pointing elsewhere is drift even
		// when the bytes behind it match; byte comparison below only refines
		// a dest-correct link.
		let verdict: LinkStatus;
		if (upstreamBytes === null) {
			verdict = "fetch-error";
		} else if (current.kind === "other") {
			verdict = "regular";
		} else if (current.kind === "missing") {
			verdict = "missing";
		} else if (current.dest === cachePath) {
			verdict = "pass";
		} else {
			verdict = "wrong-link";
		}
		const fix = linkFix(cachePath, link.target);
		if (verdict === "fetch-error") {
			const detail = fetchError === "" ? "" : `: ${fetchError}`;
			return failManual(
				base,
				"<blueprint fetch failed>",
				link.source,
				`Cannot fetch blueprint file ${link.source}${detail}; fix the network or blueprint, then re-check.`,
			);
		}
		if (verdict === "missing") {
			return failFixable(base, "<missing>", `symlink to ${cachePath}`, fix);
		}
		if (verdict === "regular") {
			const outcome = failFixable(
				base,
				"<regular file or directory>",
				`symlink to ${cachePath}`,
				fix,
			);
			outcome.hint = `Move ${link.target} aside to ${link.target}.conform.bak, then run: ${fix.label}`;
			return outcome;
		}
		if (verdict === "wrong-link") {
			const actual = current.kind === "symlink" ? `symlink to ${current.dest}` : "<wrong link>";
			return failFixable(base, actual, `symlink to ${cachePath}`, fix);
		}
		// Dangling link: dest is right but the cache file is gone. Without this
		// the check would pass on an unreadable target.
		if (current.kind !== "symlink" || current.bytes === undefined) {
			return failFixable(
				base,
				"<dangling symlink (cache missing)>",
				`symlink to ${cachePath} with upstream content`,
				fix,
			);
		}
		if (upstreamBytes !== null && !bytesEqual(current.bytes, upstreamBytes)) {
			return failFixable(
				base,
				"<content differs from upstream>",
				`symlink to ${cachePath} with upstream content`,
				fix,
			);
		}
		return pass(base, `symlink to ${cachePath}`, `symlink to ${cachePath}`);
	});
}

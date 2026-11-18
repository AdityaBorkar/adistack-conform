import { isAbsolute, resolve } from "node:path";

import { UPSTREAM_FETCH_CONCURRENCY } from "#/stack/project.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage, expandHome } from "#/utils/fs.js";
import type { CheckBase, CheckResult, SymlinkFix } from "#/utils/result.js";
import { failFixable, failManual, pass } from "#/utils/result.js";

// Machine targets resolve against $HOME: a leading ~ expands, absolute
// paths pass through, anything else anchors at home (same expansion rules
// as project scope, with baseDir = home).
export function resolveTarget(target: string, home: string): string {
	const expanded = expandHome(target, home);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(home, expanded);
}

// The fix step materializes the fetched upstream bytes at this sibling path,
// then links target -> cache. Deriving it from the target alone keeps check
// pure: no home or repo checkout is needed to know where the link must
// point (mirrors the .conform.bak sibling convention of the project fix).
export function linkCachePath(targetPath: string): string {
	return `${targetPath}.conform-src`;
}

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

export interface RenderedTemplate {
	leftover: string[];
	text: string;
}

const LEFTOVER_PATTERN = /@@[^@\s]+@@/gu;

// Replaces @@NAME@@ slots with secret values (secret names are used as-is;
// the SPEC example secret `npm_auth_token` is lowercase). Slots without a
// matching secret stay in place; leftover reports any remaining @@...@@
// slot so unresolved placeholders never pass as clean.
export function renderTemplate(
	sourceText: string,
	secrets: Record<string, string>,
): RenderedTemplate {
	let text = sourceText;
	for (const [name, value] of Object.entries(secrets)) {
		if (name === "") {
			continue;
		}
		text = text.replaceAll(`@@${name}@@`, value);
	}
	return { leftover: [...new Set(text.match(LEFTOVER_PATTERN) ?? [])], text };
}

export interface MachineTemplate {
	mode?: string;
	name: string;
	secrets?: string[];
	source: string;
	target: string;
}

export interface TemplateTarget {
	exists: boolean;
	mode?: string;
	text?: string;
}

export interface CheckTemplatesArgs {
	blueprint: string;
	decryptSecrets: () => Promise<Record<string, string>>;
	fetchSource: (source: string) => Promise<string | null>;
	readTarget: (path: string) => Promise<TemplateTarget>;
	templates: MachineTemplate[];
}

interface TemplateObservation {
	error?: string;
	exists: boolean;
	mode?: string;
	text?: string;
}

function templateBase(blueprint: string, template: MachineTemplate): CheckBase {
	return {
		id: `machine:${blueprint}:template:${template.name}`,
		kind: "machine",
		scope: "machine",
		target: template.target,
		upstream: `tech-stack:${blueprint}`,
	};
}

// Live modes come from stat as "600", blueprints say "0600": compare the
// zero-stripped forms so identical modes do not flag.
function normalizeMode(mode: string): string {
	const stripped = mode.replace(/^0+/u, "");
	return stripped === "" ? "0" : stripped;
}

function templateResult(
	blueprint: string,
	template: MachineTemplate,
	sourceText: string | null,
	sourceError: string,
	live: TemplateObservation,
	secrets: Record<string, string> | null,
	secretsError: string,
): CheckResult {
	const base = templateBase(blueprint, template);
	if (live.error !== undefined) {
		return failManual(
			base,
			"<unreadable>",
			template.source,
			`Cannot read ${template.target}: ${live.error}`,
		);
	}
	if (sourceText === null) {
		const detail = sourceError === "" ? "" : `: ${sourceError}`;
		return failManual(
			base,
			"<blueprint fetch failed>",
			template.source,
			`Cannot fetch blueprint file ${template.source}${detail}; fix the network or blueprint, then re-check.`,
		);
	}
	if ((template.secrets?.length ?? 0) > 0 && secrets === null) {
		const detail = secretsError === "" ? "" : `: ${secretsError}`;
		return failManual(
			base,
			"<secrets unavailable>",
			`rendered ${template.source}`,
			`Cannot decrypt secrets${detail}; make sops --decrypt work (missing sops or age key?), then re-check.`,
		);
	}
	const rendered = renderTemplate(sourceText, secrets ?? {});
	if (rendered.leftover.length > 0) {
		return failManual(
			base,
			`contains placeholders: ${rendered.leftover.join(", ")}`,
			"rendered template (no @@PLACEHOLDER@@ slots)",
			`Provide values for ${rendered.leftover.join(", ")} via sops secrets, then re-check.`,
		);
	}
	if (!live.exists) {
		return failFixable(base, "<missing>", "rendered template", {
			filePath: template.target,
			kind: "overwrite-file",
			newContent: rendered.text,
		});
	}
	if (live.text === undefined) {
		return failManual(
			base,
			"<not a regular file>",
			"rendered template",
			`${template.target} is not a regular file; move it aside, then re-check.`,
		);
	}
	const modeMismatch =
		template.mode !== undefined &&
		live.mode !== undefined &&
		normalizeMode(live.mode) !== normalizeMode(template.mode);
	if (live.text !== rendered.text || modeMismatch) {
		const outcome = failFixable(base, live.text ?? "<missing>", rendered.text, {
			filePath: template.target,
			kind: "overwrite-file",
			newContent: rendered.text,
		});
		if (modeMismatch) {
			outcome.hint = `Enforce mode ${template.mode} after writing: chmod ${template.mode} ${template.target} (overwrite-file fixes do not set modes).`;
		}
		return outcome;
	}
	return pass(base, "matches rendered template", `rendered ${template.source}`);
}

export async function checkTemplates(args: CheckTemplatesArgs): Promise<CheckResult[]> {
	const needsSecrets = args.templates.some((template) => (template.secrets?.length ?? 0) > 0);
	// One decrypt per run, shared by every template. Failures keep their
	// cause so the manual hint says why instead of a generic nudge.
	const secretsTask = needsSecrets
		? args.decryptSecrets().then(
				(secrets) => ({ secrets, secretsError: "" }),
				(error: unknown) => ({
					secrets: null as Record<string, string> | null,
					secretsError: errorMessage(error),
				}),
			)
		: Promise.resolve({ secrets: {} as Record<string, string>, secretsError: "" });
	const rows = await mapWithConcurrency(
		args.templates,
		UPSTREAM_FETCH_CONCURRENCY,
		async (template) => {
			let sourceText: string | null = null;
			let sourceError = "";
			try {
				sourceText = await args.fetchSource(template.source);
			} catch (error) {
				sourceError = errorMessage(error);
			}
			let live: TemplateObservation;
			try {
				live = await args.readTarget(template.target);
			} catch (error) {
				live = { error: errorMessage(error), exists: false };
			}
			return { live, sourceError, sourceText, template };
		},
	);
	const { secrets, secretsError } = await secretsTask;
	return rows.map((row) =>
		templateResult(
			args.blueprint,
			row.template,
			row.sourceText,
			row.sourceError,
			row.live,
			secrets,
			secretsError,
		),
	);
}

import { stat } from "node:fs/promises";

import type { CheckBase, CheckResult, CheckScope } from "#/checks.js";
import { failFixable, failManual, pass, skipped } from "#/checks.js";
import type { ManifestCompare } from "#/stack/registry.js";
import { readFileSafe } from "#/utils/fs.js";

export type ClassifiedTarget = { reason: string; type: "skip" } | { path: string; type: "path" };

const WINDOWS_ENV_PATTERN = /%[A-Za-z_][A-Za-z0-9_]*%/u;

export function classifyTarget(target: string, scope: CheckScope): ClassifiedTarget {
	if (target.startsWith("docs:")) {
		return { reason: "docs-only, nothing to enforce", type: "skip" };
	}
	const [token = ""] = target.split(/\s+/u);
	if (token === "~" || token.startsWith("~/") || token.startsWith("/")) {
		return { path: token, type: "path" };
	}
	if (WINDOWS_ENV_PATTERN.test(token)) {
		return { reason: "Windows-only target", type: "skip" };
	}
	if (scope === "project" && token !== "") {
		return { path: token, type: "path" };
	}
	return { reason: `no concrete target ("${target}")`, type: "skip" };
}

function isBlankGolden(golden: string): boolean {
	return golden.trim() === "";
}

function baseFor(
	blueprint: string,
	fileName: string,
	fileTarget: string,
	scope: CheckScope,
): CheckBase {
	return {
		id: `project:${blueprint}:${fileName}`,
		kind: "preset",
		scope,
		source: `tech-stack:${blueprint}`,
		target: fileTarget,
	};
}

const EMPTY_COMPARE: ManifestCompare = { ignore: [], pinned: [], strip: [], versioned: [] };

function isTemplateCompare(compare: ManifestCompare): boolean {
	return compare.pinned.length > 0 || compare.versioned.length > 0;
}

function hasCompareRules(compare: ManifestCompare): boolean {
	return (
		compare.ignore.length > 0 ||
		compare.pinned.length > 0 ||
		compare.strip.length > 0 ||
		compare.versioned.length > 0
	);
}

function omitKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!keys.includes(key)) {
			out[key] = entry;
		}
	}
	return out;
}

function detectIndent(golden: string): string {
	if (golden.includes("\t")) {
		return "\t";
	}
	const match = /^( +)/mu.exec(golden);
	return match?.[1] ?? "\t";
}

function serializeJson(value: unknown, golden: string): string {
	return `${JSON.stringify(value, null, detectIndent(golden))}\n`;
}

function stripJsonc(text: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let i = 0;
	while (i < text.length) {
		const char = text[i] as string;
		const next = (text[i + 1] ?? "") as string;
		if (inString) {
			out += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			i += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") {
				i += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
				i += 1;
			}
			i += 2;
			continue;
		}
		if (char === ",") {
			let look = i + 1;
			while (look < text.length && /\s/u.test(text[look] as string)) {
				look += 1;
			}
			const peek = text[look] as string | undefined;
			if (peek === "}" || peek === "]") {
				i += 1;
				continue;
			}
		}
		out += char;
		i += 1;
	}
	return out;
}

function parseJsonc(text: string): unknown {
	return JSON.parse(stripJsonc(text)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
		);
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
		);
	}
	return false;
}

function missingCompareFix(
	base: CheckBase,
	golden: string,
	targetPath: string,
	compare: ManifestCompare,
): CheckResult | undefined {
	try {
		const parsed = parseJsonc(golden);
		if (!isRecord(parsed)) {
			return undefined;
		}
		const newContent = serializeJson(omitKeys(parsed, compare.strip), golden);
		return failFixable(base, "<missing>", newContent, {
			filePath: targetPath,
			kind: "overwrite-file",
			newContent,
		});
	} catch {
		return undefined;
	}
}

interface SemanticArgs {
	base: CheckBase;
	compare: ManifestCompare;
	fileName: string;
	golden: string;
	localText: string;
	targetPath: string;
}

function overlayResult(
	args: SemanticArgs & { goldenRest: Record<string, unknown>; localRest: Record<string, unknown> },
): CheckResult | undefined {
	const goldenKept = omitKeys(args.goldenRest, args.compare.ignore);
	const localKept = omitKeys(args.localRest, args.compare.ignore);
	if (deepEqual(localKept, goldenKept)) {
		const kept =
			args.compare.ignore.length > 0 ? ` (local ${args.compare.ignore.join("/")} kept)` : "";
		return pass(args.base, `matches preset${kept}`, args.golden);
	}
	if (args.compare.ignore.length > 0 && !args.compare.ignore.some((key) => key in args.localRest)) {
		return undefined;
	}
	const merged: Record<string, unknown> = { ...args.goldenRest };
	for (const [key, value] of Object.entries(args.localRest)) {
		if (!(key in merged) || args.compare.ignore.includes(key)) {
			merged[key] = value;
		}
	}
	const newContent = serializeJson(merged, args.golden);
	return failFixable(args.base, args.localText, newContent, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent,
	});
}

function templateResult(
	args: SemanticArgs & { goldenRest: Record<string, unknown>; localRest: Record<string, unknown> },
): CheckResult {
	const { base, compare, golden, goldenRest, localRest, localText, targetPath } = args;
	const drifted = compare.pinned.filter((key) => {
		if (!(key in goldenRest)) {
			return false;
		}
		const goldenValue = goldenRest[key];
		const localValue = localRest[key];
		if (isRecord(goldenValue) && isRecord(localValue)) {
			return Object.entries(goldenValue).some(
				([entryKey, entryValue]) => !deepEqual(localValue[entryKey], entryValue),
			);
		}
		return !deepEqual(localValue, goldenValue);
	});
	for (const section of compare.versioned) {
		const goldenDeps = goldenRest[section];
		const localDeps = localRest[section];
		if (!isRecord(goldenDeps) || !isRecord(localDeps)) {
			continue;
		}
		for (const [pkg, version] of Object.entries(goldenDeps)) {
			if (pkg in localDeps && !deepEqual(localDeps[pkg], version)) {
				drifted.push(`${section}.${pkg}`);
			}
		}
	}
	if (drifted.length === 0) {
		return pass(base, "matches preset template", golden);
	}
	const merged: Record<string, unknown> = { ...(localRest as Record<string, unknown>) };
	for (const key of compare.pinned) {
		const goldenValue = goldenRest[key];
		const localValue = localRest[key];
		if (!(key in goldenRest)) {
			continue;
		}
		if (isRecord(goldenValue) && isRecord(localValue)) {
			merged[key] = {
				...(localValue as Record<string, unknown>),
				...(goldenValue as Record<string, unknown>),
			};
		} else {
			merged[key] = goldenValue;
		}
	}
	for (const section of compare.versioned) {
		const goldenDeps = goldenRest[section];
		const localDeps = localRest[section];
		if (!isRecord(goldenDeps) || !isRecord(localDeps)) {
			continue;
		}
		const next: Record<string, unknown> = { ...(localDeps as Record<string, unknown>) };
		for (const [pkg, version] of Object.entries(goldenDeps)) {
			if (pkg in next) {
				next[pkg] = version;
			}
		}
		merged[section] = next;
	}
	const newContent = serializeJson(merged, golden);
	return failFixable(base, localText, newContent, {
		filePath: targetPath,
		kind: "overwrite-file",
		newContent,
	});
}

function semanticResult(args: SemanticArgs): CheckResult | undefined {
	const template = isTemplateCompare(args.compare);
	let goldenParsed: unknown;
	try {
		goldenParsed = parseJsonc(args.golden);
	} catch {
		return template
			? failManual(
					args.base,
					args.localText,
					args.golden,
					`Preset ${args.fileName} is not valid JSON; cannot compare.`,
				)
			: undefined;
	}
	if (!isRecord(goldenParsed)) {
		return template
			? failManual(
					args.base,
					args.localText,
					args.golden,
					`Preset ${args.fileName} is not an object; cannot compare.`,
				)
			: undefined;
	}
	let localParsed: unknown;
	try {
		localParsed = parseJsonc(args.localText);
	} catch {
		return template
			? failManual(
					args.base,
					"<unparsable>",
					args.golden,
					`Cannot parse ${args.targetPath} as JSON; fix the syntax manually.`,
				)
			: undefined;
	}
	if (!isRecord(localParsed)) {
		return template
			? failManual(
					args.base,
					"<unparsable>",
					args.golden,
					`Expected ${args.targetPath} to be a JSON object; fix it manually.`,
				)
			: undefined;
	}
	const goldenRest = omitKeys(goldenParsed, args.compare.strip);
	const localRest = omitKeys(localParsed, args.compare.strip);
	if (template) {
		return templateResult({ ...args, goldenRest, localRest });
	}
	return overlayResult({ ...args, goldenRest, localRest });
}

function unreadableTarget(base: CheckBase, golden: string, targetPath: string, error: string) {
	return failManual(
		base,
		"<unreadable>",
		golden,
		`Cannot read ${targetPath} (may need sudo): ${error}`,
	);
}

export async function checkPresetFileWithGolden(args: {
	blueprint: string;
	compare?: ManifestCompare;
	fileName: string;
	fileTarget: string;
	golden: string;
	scope: CheckScope;
	sourceLabel: string;
	targetPath: string;
}): Promise<CheckResult> {
	const base = baseFor(args.blueprint, args.fileName, args.fileTarget, args.scope);
	const compare = args.compare ?? EMPTY_COMPARE;
	const targetRead = await readFileSafe(args.targetPath);
	if (isBlankGolden(args.golden) && !targetRead.ok && targetRead.reason === "missing") {
		return pass(base, "defaults (empty preset)", "absent (empty preset = defaults)");
	}
	if (!targetRead.ok) {
		if (targetRead.reason !== "missing") {
			return unreadableTarget(base, args.golden, args.targetPath, targetRead.error);
		}
		if (isTemplateCompare(compare)) {
			return failManual(
				base,
				"<missing>",
				"exists (templated from preset)",
				`Copy ${args.sourceLabel} to ${args.targetPath}, adapt per-project fields, then re-run check.`,
			);
		}
		const stripped = missingCompareFix(base, args.golden, args.targetPath, compare);
		if (stripped !== undefined) {
			return stripped;
		}
		return failFixable(base, "<missing>", args.golden, {
			filePath: args.targetPath,
			kind: "overwrite-file",
			newContent: args.golden,
		});
	}
	if (targetRead.text === args.golden) {
		return pass(base, "matches preset", args.golden);
	}
	if (hasCompareRules(compare)) {
		const semantic = semanticResult({
			base,
			compare,
			fileName: args.fileName,
			golden: args.golden,
			localText: targetRead.text,
			targetPath: args.targetPath,
		});
		if (semantic !== undefined) {
			return semantic;
		}
	}
	return failFixable(base, targetRead.text, args.golden, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent: args.golden,
	});
}

export async function checkRequiredFileExists(args: {
	blueprint: string;
	fileName: string;
	scope: CheckScope;
	targetPath: string;
}): Promise<CheckResult> {
	const base: CheckBase = {
		id: `project:${args.blueprint}:${args.fileName}`,
		kind: "preset",
		scope: args.scope,
		source: `tech-stack:${args.blueprint}`,
		target: args.fileName,
	};
	const outcome = await readFileSafe(args.targetPath);
	if (outcome.ok) {
		return pass(base, "exists", "exists (generate per-project content)");
	}
	if (outcome.reason === "missing") {
		return failManual(
			base,
			"<missing>",
			"exists (generate per-project content)",
			`${args.fileName} is missing. Generate one for this project, then re-run check.`,
		);
	}
	return failManual(
		base,
		"<unreadable>",
		"exists (generate per-project content)",
		`Cannot read ${args.targetPath} (may need sudo): ${outcome.error}`,
	);
}

export async function checkRequiredDir(args: {
	blueprint: string;
	dirName: string;
	scope: CheckScope;
	targetPath: string;
}): Promise<CheckResult> {
	const base: CheckBase = {
		id: `project:${args.blueprint}:${args.dirName}`,
		kind: "preset",
		scope: args.scope,
		source: `tech-stack:${args.blueprint}`,
		target: args.dirName,
	};
	try {
		const info = await stat(args.targetPath);
		if (info.isDirectory()) {
			return pass(base, "exists", "directory exists");
		}
		return failManual(
			base,
			"<not-a-directory>",
			"directory exists",
			`${args.targetPath} exists but is not a directory; move it aside and run mkdir -p ${args.targetPath}.`,
		);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			// shortcut: manual for now; upgrade to ensure-dir fix if dir auto-creation is wanted.
			return failManual(
				base,
				"<missing>",
				"directory exists",
				`Directory ${args.targetPath} is missing; create it with mkdir -p ${args.targetPath}.`,
			);
		}
		const message = error instanceof Error ? error.message : String(error);
		return failManual(
			base,
			"<unreadable>",
			"directory exists",
			`Cannot stat ${args.targetPath}: ${message}`,
		);
	}
}

export function skippedForTarget(
	blueprint: string,
	fileName: string,
	sourceLabel: string,
	fileTarget: string,
	reason: string,
	scope: CheckScope,
): CheckResult {
	return skipped(baseFor(blueprint, fileName, fileTarget, scope), sourceLabel, reason);
}

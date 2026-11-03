import { stat } from "node:fs/promises";

import type { CheckBase, CheckResult, CheckScope } from "#/checks.js";
import { failFixable, failManual, pass, skipped } from "#/checks.js";
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

function isExampleFile(sourceLabel: string): boolean {
	return sourceLabel.endsWith(".example");
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

const OVERRIDES_TOLERANT_BASENAMES = new Set([
	".oxlintrc.json",
	".oxlintrc.jsonc",
	".oxfmtrc.json",
	"biome.json",
]);

const PACKAGE_JSON_BASENAME = "package.json";

function basenameOf(value: string): string {
	const [token = ""] = value.split(/\s+/u);
	const parts = token.split("/");
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index] as string;
		if (part !== "") {
			return part;
		}
	}
	return value;
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

function withoutOverrides(value: Record<string, unknown>): Record<string, unknown> {
	const { overrides: _ignored, ...rest } = value;
	return rest;
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

function missingPackageJsonFix(
	base: CheckBase,
	golden: string,
	targetPath: string,
): CheckResult | undefined {
	try {
		const goldenParsed = parseJsonc(golden);
		if (!isRecord(goldenParsed)) {
			return undefined;
		}
		const { _template: _ignored, ...rest } = goldenParsed;
		const newContent = serializeJson(rest, golden);
		return failFixable(base, "<missing>", newContent, {
			filePath: targetPath,
			kind: "overwrite-file",
			newContent,
		});
	} catch {
		return undefined;
	}
}
function overridesTolerantResult(
	base: CheckBase,
	golden: string,
	localText: string,
	targetPath: string,
): CheckResult | undefined {
	try {
		const goldenParsed = parseJsonc(golden);
		const localParsed = parseJsonc(localText);
		if (!isRecord(goldenParsed) || !isRecord(localParsed)) {
			return undefined;
		}
		if (deepEqual(withoutOverrides(localParsed), withoutOverrides(goldenParsed))) {
			return pass(base, "matches preset (local overrides kept)", golden);
		}
		const localOverrides = (localParsed as Record<string, unknown>)["overrides"];
		if (localOverrides === undefined) {
			return undefined;
		}
		const goldenRecord = goldenParsed as Record<string, unknown>;
		const localRecord = localParsed as Record<string, unknown>;
		const merged: Record<string, unknown> = { ...goldenRecord };
		for (const [key, value] of Object.entries(localRecord)) {
			if (!(key in merged)) {
				merged[key] = value;
			}
		}
		merged["overrides"] = localOverrides;
		const newContent = serializeJson(merged, golden);
		return failFixable(base, localText, newContent, {
			filePath: targetPath,
			kind: "overwrite-file",
			newContent,
		});
	} catch {
		return undefined;
	}
}

function packageJsonResult(
	base: CheckBase,
	golden: string,
	localText: string,
	targetPath: string,
): CheckResult {
	let goldenParsed: unknown;
	try {
		goldenParsed = parseJsonc(golden);
	} catch {
		return failManual(
			base,
			localText,
			golden,
			`Preset package.json is not valid JSON; cannot compare.`,
		);
	}
	if (!isRecord(goldenParsed)) {
		return failManual(
			base,
			localText,
			golden,
			`Preset package.json is not an object; cannot compare.`,
		);
	}
	const { _template: _presetTemplate, ...goldenRest } = goldenParsed as Record<string, unknown>;
	let localParsed: unknown;
	try {
		localParsed = parseJsonc(localText);
	} catch {
		return failManual(
			base,
			"<unparsable>",
			golden,
			`Cannot parse ${targetPath} as JSON; fix the syntax manually.`,
		);
	}
	if (!isRecord(localParsed)) {
		return failManual(
			base,
			"<unparsable>",
			golden,
			`Expected ${targetPath} to be a JSON object; fix it manually.`,
		);
	}
	const { _template: _localTemplate, ...localRest } = localParsed as Record<string, unknown>;
	const enforcedTopKeys = ["imports", "scripts", "type"];
	const driftedTop = enforcedTopKeys.filter((key) => {
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
	const depSections = ["dependencies", "devDependencies"] as const;
	const versionDrift: string[] = [];
	for (const section of depSections) {
		const goldenDeps = goldenRest[section];
		const localDeps = localRest[section];
		if (!isRecord(goldenDeps) || !isRecord(localDeps)) {
			continue;
		}
		for (const [pkg, version] of Object.entries(goldenDeps)) {
			if (pkg in localDeps && !deepEqual(localDeps[pkg], version)) {
				versionDrift.push(`${section}.${pkg}`);
			}
		}
	}
	if (driftedTop.length === 0 && versionDrift.length === 0) {
		return pass(base, "matches preset template", golden);
	}
	const merged: Record<string, unknown> = { ...(localRest as Record<string, unknown>) };
	for (const key of enforcedTopKeys) {
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
	for (const section of depSections) {
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

function checkExampleOutcome(
	base: CheckBase,
	sourceLabel: string,
	targetPath: string,
	outcome: Awaited<ReturnType<typeof readFileSafe>>,
): CheckResult {
	if (outcome.ok) {
		return pass(base, "exists", "exists (values stay secret)");
	}
	if (outcome.reason === "missing") {
		return failManual(
			base,
			"<missing>",
			"exists (values stay secret)",
			`Copy ${sourceLabel} to ${targetPath} and fill in secret values (never commit).`,
		);
	}
	return failManual(
		base,
		"<unreadable>",
		"exists (values stay secret)",
		`Cannot read ${targetPath} (may need sudo): ${outcome.error}`,
	);
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
	fileName: string;
	fileTarget: string;
	golden: string;
	scope: CheckScope;
	sourceLabel: string;
	targetPath: string;
}): Promise<CheckResult> {
	const base = baseFor(args.blueprint, args.fileName, args.fileTarget, args.scope);
	if (isExampleFile(args.sourceLabel)) {
		return checkExampleOutcome(
			base,
			args.sourceLabel,
			args.targetPath,
			await readFileSafe(args.targetPath),
		);
	}
	const targetRead = await readFileSafe(args.targetPath);
	if (isBlankGolden(args.golden) && !targetRead.ok && targetRead.reason === "missing") {
		return pass(base, "defaults (empty preset)", "absent (empty preset = defaults)");
	}
	if (!targetRead.ok) {
		if (targetRead.reason !== "missing") {
			return unreadableTarget(base, args.golden, args.targetPath, targetRead.error);
		}
		if (basenameOf(args.fileTarget) === PACKAGE_JSON_BASENAME) {
			const templated = missingPackageJsonFix(base, args.golden, args.targetPath);
			if (templated !== undefined) {
				return templated;
			}
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
	if (basenameOf(args.fileTarget) === PACKAGE_JSON_BASENAME) {
		return packageJsonResult(base, args.golden, targetRead.text, args.targetPath);
	}
	if (OVERRIDES_TOLERANT_BASENAMES.has(basenameOf(args.fileTarget))) {
		const tolerant = overridesTolerantResult(base, args.golden, targetRead.text, args.targetPath);
		if (tolerant !== undefined) {
			return tolerant;
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

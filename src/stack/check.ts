import { stat } from "node:fs/promises";

import type { CheckBase, CheckResult, CheckScope } from "#/checks.js";
import { failFixable, failManual, pass } from "#/checks.js";
import type { ManifestCompare } from "#/stack/registry.js";
import { readFileSafe } from "#/utils/fs.js";

// Template slots in goldens (e.g. package.json `<package-name>`). A golden
// that parses as a JSON object and holds `<...>` placeholders is a template:
// every slot accepts any per-project value, all other fields must match.
const PLACEHOLDER_PATTERN = /<[^<>\r\n]+>/gu;

function goldenPlaceholders(golden: string): string[] {
	return [...new Set(golden.match(PLACEHOLDER_PATTERN) ?? [])];
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

const EMPTY_COMPARE: ManifestCompare = {
	ignore: [],
};

// Placeholders in non-JSON goldens (HTML comments, TS generics) never count:
// only a JSON-object golden holding `<...>` slots is a template.
function goldenHasPlaceholders(golden: string): boolean {
	let parsed: unknown;
	try {
		parsed = parseJsonc(golden);
	} catch {
		return false;
	}
	if (!isRecord(parsed)) {
		return false;
	}
	PLACEHOLDER_PATTERN.lastIndex = 0;
	const found = PLACEHOLDER_PATTERN.test(stripJsonc(golden));
	PLACEHOLDER_PATTERN.lastIndex = 0;
	return found;
}

function isTemplateGolden(golden: string): boolean {
	return goldenHasPlaceholders(golden);
}

function hasCompareRules(compare: ManifestCompare): boolean {
	return compare.ignore.length > 0;
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
			let closed = false;
			while (i < text.length) {
				if (text[i] === "*" && text[i + 1] === "/") {
					closed = true;
					break;
				}
				i += 1;
			}
			i += closed ? 2 : 0;
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
			leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
		);
	}
	return false;
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
	const merged: Record<string, unknown> = { ...args.goldenRest };
	for (const [key, value] of Object.entries(args.localRest)) {
		if (!Object.hasOwn(merged, key) || args.compare.ignore.includes(key)) {
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

function escapeRegExp(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// A golden string with `<...>` slots matches any local string holding real
// values in those slots (each slot needs at least one char).
function templateStringMatches(golden: string, local: string): boolean {
	const pattern = golden
		.split(/<[^<>\r\n]+>/u)
		.map((part) => escapeRegExp(part))
		.join("[\\s\\S]+?");
	return new RegExp(`^${pattern}$`, "u").test(local);
}

function containsPlaceholderText(text: string): boolean {
	PLACEHOLDER_PATTERN.lastIndex = 0;
	const found = PLACEHOLDER_PATTERN.test(text);
	PLACEHOLDER_PATTERN.lastIndex = 0;
	return found;
}

function containsPlaceholder(value: unknown): boolean {
	if (typeof value === "string") {
		return containsPlaceholderText(value);
	}
	if (Array.isArray(value)) {
		return value.some((entry) => containsPlaceholder(entry));
	}
	if (isRecord(value)) {
		return (
			Object.keys(value).some((key) => containsPlaceholderText(key)) ||
			Object.values(value).some((entry) => containsPlaceholder(entry))
		);
	}
	return false;
}

function placeholderValueMatches(goldenValue: unknown, localValue: unknown): boolean {
	if (typeof goldenValue === "string" && containsPlaceholderText(goldenValue)) {
		return (
			typeof localValue === "string" &&
			localValue.trim() !== "" &&
			!containsPlaceholder(localValue) &&
			templateStringMatches(goldenValue, localValue)
		);
	}
	if (isRecord(goldenValue) || Array.isArray(goldenValue)) {
		const nested: string[] = [];
		collectTemplateIssues(goldenValue, localValue, "", nested);
		return nested.length === 0;
	}
	return deepEqual(goldenValue, localValue);
}

// Every golden field must hold in local: `<...>` slots accept any real value,
// all other fields must match exactly. Extra local fields are allowed.
function collectTemplateIssues(
	goldenNode: unknown,
	localNode: unknown,
	path: string,
	issues: string[],
): void {
	if (typeof goldenNode === "string" && containsPlaceholderText(goldenNode)) {
		const label = path === "" ? "value" : path;
		if (typeof localNode !== "string" || localNode.trim() === "") {
			issues.push(`${label} needs a per-project value`);
			return;
		}
		if (containsPlaceholder(localNode)) {
			issues.push(`${label} still holds placeholders`);
			return;
		}
		if (!templateStringMatches(goldenNode, localNode)) {
			issues.push(`${label} does not match the preset template`);
		}
		return;
	}
	if (isRecord(goldenNode)) {
		if (!isRecord(localNode)) {
			issues.push(`${path === "" ? "value" : path} should be an object`);
			return;
		}
		const unmatched = new Set(Object.keys(localNode));
		for (const [key, goldenValue] of Object.entries(goldenNode)) {
			const child = path === "" ? key : `${path}.${key}`;
			if (containsPlaceholderText(key)) {
				const match = [...unmatched].find(
					(candidate) =>
						!containsPlaceholderText(candidate) &&
						!Object.hasOwn(goldenNode, candidate) &&
						placeholderValueMatches(goldenValue, localNode[candidate]),
				);
				if (match === undefined) {
					issues.push(`${child} needs a per-project value`);
				} else {
					unmatched.delete(match);
				}
				continue;
			}
			unmatched.delete(key);
			if (!Object.hasOwn(localNode, key)) {
				issues.push(`${child} is missing`);
				continue;
			}
			collectTemplateIssues(goldenValue, localNode[key], child, issues);
		}
		return;
	}
	if (Array.isArray(goldenNode)) {
		const label = path === "" ? "value" : path;
		if (!Array.isArray(localNode)) {
			issues.push(`${label} should be an array`);
			return;
		}
		if (localNode.length < goldenNode.length) {
			issues.push(`${label} is missing entries`);
		}
		const shared = Math.min(goldenNode.length, localNode.length);
		for (let index = 0; index < shared; index += 1) {
			collectTemplateIssues(goldenNode[index], localNode[index], `${label}[${index}]`, issues);
		}
		for (let index = shared; index < localNode.length; index += 1) {
			if (containsPlaceholder(localNode[index])) {
				issues.push(`${label}[${index}] still holds placeholders`);
			}
		}
		return;
	}
	if (!deepEqual(goldenNode, localNode)) {
		issues.push(`${path === "" ? "value" : path} differs from the preset`);
	}
}

function templateResult(
	args: SemanticArgs & { goldenRest: Record<string, unknown>; localRest: Record<string, unknown> },
): CheckResult {
	const { base, golden } = args;
	const mismatched: string[] = [];
	collectTemplateIssues(args.goldenRest, args.localRest, "", mismatched);
	if (mismatched.length > 0) {
		return failManual(
			base,
			`fields differ from the preset template: ${mismatched.join(", ")}`,
			"preset template with per-project values (no <...> placeholders)",
			`Reconcile ${args.targetPath} with the ${args.fileName} preset (keeping per-project values where the golden uses <...> placeholders), then re-run check.`,
		);
	}
	return pass(base, "matches preset template", golden);
}

function semanticResult(args: SemanticArgs): CheckResult | undefined {
	const template = isTemplateGolden(args.golden);
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
	if (template) {
		return templateResult({ ...args, goldenRest: goldenParsed, localRest: localParsed });
	}
	return overlayResult({ ...args, goldenRest: goldenParsed, localRest: localParsed });
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
	const compare = { ...EMPTY_COMPARE, ...args.compare };
	const template = isTemplateGolden(args.golden);
	const targetRead = await readFileSafe(args.targetPath);
	if (!targetRead.ok) {
		if (targetRead.reason !== "missing") {
			return unreadableTarget(base, args.golden, args.targetPath, targetRead.error);
		}
		if (template) {
			return failManual(
				base,
				"<missing>",
				"exists (templated from preset)",
				`Copy ${args.sourceLabel} to ${args.targetPath}, adapt per-project fields, then re-run check.`,
			);
		}
		return failFixable(base, "<missing>", args.golden, {
			filePath: args.targetPath,
			kind: "overwrite-file",
			newContent: args.golden,
		});
	}
	// Templates never pass on byte equality: a verbatim copy still holds
	// placeholders, so it must go through the semantic path and fail manual
	// until every golden `<...>` slot is replaced with per-project values.
	if (template) {
		const unadapted = goldenPlaceholders(args.golden).filter((token) =>
			targetRead.text.includes(token),
		);
		if (unadapted.length > 0) {
			return failManual(
				base,
				`contains placeholders: ${unadapted.join(", ")}`,
				"adapted template (no <...> placeholders)",
				`Replace ${unadapted.join(", ")} in ${args.targetPath} with per-project values (copied from ${args.sourceLabel}), then re-run check.`,
			);
		}
	} else if (targetRead.text === args.golden) {
		return pass(base, "matches preset", args.golden);
	}
	if (template || hasCompareRules(compare)) {
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

export async function checkFileStructureEntry(args: {
	blueprint: string;
	entryName: string;
	kind: "dir" | "file";
	scope: CheckScope;
	targetPath: string;
}): Promise<CheckResult> {
	const base: CheckBase = {
		id: `project:${args.blueprint}:${args.entryName}`,
		kind: "preset",
		scope: args.scope,
		source: `tech-stack:${args.blueprint}`,
		target: args.entryName,
	};
	if (args.kind === "dir") {
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
	const outcome = await readFileSafe(args.targetPath);
	if (outcome.ok) {
		return pass(base, "exists", "exists (generate per-project content)");
	}
	if (outcome.reason === "missing") {
		return failManual(
			base,
			"<missing>",
			"exists (generate per-project content)",
			`${args.entryName} is missing. Generate one for this project, then re-run check.`,
		);
	}
	return failManual(
		base,
		"<unreadable>",
		"exists (generate per-project content)",
		`Cannot read ${args.targetPath} (may need sudo): ${outcome.error}`,
	);
}

import { stat } from "node:fs/promises";

import type { ManifestCompare } from "#/stack/registry.js";
import { readFileSafe } from "#/utils/fs.js";
import { parseJsonc, stripJsonc } from "#/utils/jsonc.js";
import type { CheckBase, CheckResult, CheckScope } from "#/utils/result.js";
import { failFixable, failManual, pass } from "#/utils/result.js";

// Template slots in goldens (e.g. package.json `<package-name>`). A golden
// that parses as a JSON object and holds `<...>` placeholders is a template:
// every slot accepts any per-project value, all other fields must match.
const PLACEHOLDER = /<[^<>\r\n]+>/u;
const PLACEHOLDER_ALL = /<[^<>\r\n]+>/gu;

function goldenPlaceholders(golden: string): string[] {
	return [...new Set(golden.match(PLACEHOLDER_ALL) ?? [])];
}

function baseFor(
	blueprint: string,
	fileName: string,
	fileTarget: string,
	scope: CheckScope,
): CheckBase {
	return {
		id: `project:${blueprint}:${fileName}`,
		kind: "project",
		scope,
		source: `tech-stack:${blueprint}`,
		target: fileTarget,
	};
}

const EMPTY_COMPARE: ManifestCompare = {
	ignore: [],
};

// Placeholders in non-JSON goldens (HTML comments, TS generics) never count:
// only a golden that parses as JSON and holds `<...>` slots is a template.
function goldenHasPlaceholders(golden: string): boolean {
	let parsed: unknown;
	try {
		parsed = parseJsonc(golden);
	} catch {
		return false;
	}
	if (!isRecord(parsed) && !Array.isArray(parsed)) {
		return false;
	}
	return PLACEHOLDER.test(stripJsonc(golden));
}

function isTemplateGolden(golden: string): boolean {
	return goldenHasPlaceholders(golden);
}

function hasCompareRules(compare: ManifestCompare): boolean {
	return compare.ignore.length > 0;
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	// "__proto__" assignment would mutate the prototype instead of creating an
	// own property, so define it explicitly.
	if (key === "__proto__") {
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: true,
			value,
			writable: true,
		});
		return;
	}
	target[key] = value;
}

function omitKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!keys.includes(key)) {
			setOwn(out, key, entry);
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
	// Extra local keys are preserved by fix, so they pass here too: only
	// golden keys must match. Otherwise fix would never converge.
	const matches = Object.entries(goldenKept).every(
		([key, value]) => Object.hasOwn(localKept, key) && deepEqual(localKept[key], value),
	);
	if (matches) {
		const kept =
			args.compare.ignore.length > 0 ? ` (local ${args.compare.ignore.join("/")} kept)` : "";
		return pass(args.base, `matches golden${kept}`, args.golden);
	}
	const merged: Record<string, unknown> = { ...args.goldenRest };
	for (const [key, value] of Object.entries(args.localRest)) {
		if (!Object.hasOwn(merged, key) || args.compare.ignore.includes(key)) {
			setOwn(merged, key, value);
		}
	}
	const newContent = serializeJson(merged, args.golden);
	return failFixable(args.base, args.localText, newContent, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent,
	});
}

// A golden string with `<...>` slots matches any local string holding real
// values in those slots (each slot needs at least one char). Segment-wise
// scan: memoized backtracking bounds the blow-up. Each
// literal is tried at every occurrence (backtracking) so repeated suffixes
// still match (e.g. `a<x>aa` accepts `aaaaa`).
function templateStringMatches(golden: string, local: string): boolean {
	const parts = golden.split(/<[^<>\r\n]+>/u);
	if (parts.length === 1) {
		return golden === local;
	}
	const first = parts[0] as string;
	if (!local.startsWith(first)) {
		return false;
	}
	const rest = parts.slice(1);
	const failed = new Set<string>();
	function matchFrom(segment: number, pos: number): boolean {
		const key = `${segment}:${pos}`;
		if (failed.has(key)) {
			return false;
		}
		if (segment === rest.length) {
			const ok = pos === local.length;
			if (!ok) {
				failed.add(key);
			}
			return ok;
		}
		const part = rest[segment] as string;
		if (part === "") {
			if (segment === rest.length - 1) {
				const ok = local.length - pos >= 1;
				if (!ok) {
					failed.add(key);
				}
				return ok;
			}
			if (pos >= local.length) {
				failed.add(key);
				return false;
			}
			const ok = matchFrom(segment + 1, pos + 1);
			if (!ok) {
				failed.add(key);
			}
			return ok;
		}
		let found = local.indexOf(part, pos + 1);
		while (found !== -1) {
			if (matchFrom(segment + 1, found + part.length)) {
				return true;
			}
			found = local.indexOf(part, found + 1);
		}
		failed.add(key);
		return false;
	}
	return matchFrom(0, first.length);
}

function containsPlaceholderText(text: string): boolean {
	return PLACEHOLDER.test(text);
}

// A local value that is itself a `<...>` token is an unadapted leftover, not a
// per-project value. Angle brackets embedded in a larger value (e.g. `Array<T>`)
// are fine and match template slots by surrounding text.
function isLeftoverPlaceholder(value: string): boolean {
	return /^<[^<>\r\n]+>$/u.test(value.trim());
}

function placeholderValueMatches(goldenValue: unknown, localValue: unknown): boolean {
	if (typeof goldenValue === "string" && containsPlaceholderText(goldenValue)) {
		return (
			typeof localValue === "string" &&
			localValue.trim() !== "" &&
			!isLeftoverPlaceholder(localValue) &&
			templateStringMatches(goldenValue, localValue)
		);
	}
	if (isRecord(goldenValue) || Array.isArray(goldenValue)) {
		const nested: string[] = [];
		collectTemplateIssues(goldenValue, localValue, "", nested, 0);
		return nested.length === 0;
	}
	return deepEqual(goldenValue, localValue);
}

const MAX_TEMPLATE_DEPTH = 50;

// Every golden field must hold in local: `<...>` slots accept any real value,
// all other fields must match exactly. Extra local fields are allowed.
function collectTemplateIssues(
	goldenNode: unknown,
	localNode: unknown,
	path: string,
	issues: string[],
	depth: number,
): void {
	if (depth > MAX_TEMPLATE_DEPTH) {
		issues.push(`${path === "" ? "value" : path} is nested too deeply to compare`);
		return;
	}
	if (typeof goldenNode === "string" && containsPlaceholderText(goldenNode)) {
		const label = path === "" ? "value" : path;
		if (typeof localNode !== "string" || localNode.trim() === "") {
			issues.push(`${label} needs a per-project value`);
			return;
		}
		if (isLeftoverPlaceholder(localNode)) {
			issues.push(`${label} still holds placeholders`);
			return;
		}
		if (!templateStringMatches(goldenNode, localNode)) {
			issues.push(`${label} does not match the template`);
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
			collectTemplateIssues(goldenValue, localNode[key], child, issues, depth + 1);
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
			collectTemplateIssues(
				goldenNode[index],
				localNode[index],
				`${label}[${index}]`,
				issues,
				depth + 1,
			);
		}
		for (let index = shared; index < localNode.length; index += 1) {
			const extra = localNode[index];
			if (typeof extra === "string" && isLeftoverPlaceholder(extra)) {
				issues.push(`${label}[${index}] still holds placeholders`);
			}
		}
		return;
	}
	if (!deepEqual(goldenNode, localNode)) {
		issues.push(`${path === "" ? "value" : path} differs from the golden`);
	}
}

function semanticResult(args: SemanticArgs): CheckResult | undefined {
	const template = isTemplateGolden(args.golden);
	const needsJson = template || hasCompareRules(args.compare);
	let goldenParsed: unknown;
	try {
		goldenParsed = parseJsonc(args.golden);
	} catch {
		if (template) {
			return failManual(
				args.base,
				args.localText,
				args.golden,
				`Blueprint ${args.fileName} is not valid JSON; cannot compare.`,
			);
		}
		if (hasCompareRules(args.compare)) {
			return failManual(
				args.base,
				args.localText,
				args.golden,
				`Cannot apply compare rules for ${args.fileName}: the golden is not a JSON object; fix the blueprint manually.`,
			);
		}
		return undefined;
	}
	if (!isRecord(goldenParsed) && !Array.isArray(goldenParsed)) {
		if (template) {
			return failManual(
				args.base,
				args.localText,
				args.golden,
				`Blueprint ${args.fileName} is not an object; cannot compare.`,
			);
		}
		if (hasCompareRules(args.compare)) {
			return failManual(
				args.base,
				args.localText,
				args.golden,
				`Cannot apply compare rules for ${args.fileName}: the golden is not a JSON object; fix the blueprint manually.`,
			);
		}
		return undefined;
	}
	let localParsed: unknown;
	try {
		localParsed = parseJsonc(args.localText);
	} catch {
		if (needsJson) {
			return failManual(
				args.base,
				"<unparsable>",
				args.golden,
				`Cannot parse ${args.targetPath} as JSON; fix the syntax manually.`,
			);
		}
		return undefined;
	}
	if (template) {
		const differing: string[] = [];
		if (isRecord(goldenParsed) && isRecord(localParsed) && hasCompareRules(args.compare)) {
			collectTemplateIssues(
				omitKeys(goldenParsed, args.compare.ignore),
				omitKeys(localParsed, args.compare.ignore),
				"",
				differing,
				0,
			);
		} else {
			collectTemplateIssues(goldenParsed, localParsed, "", differing, 0);
		}
		if (differing.length > 0) {
			return failManual(
				args.base,
				`fields differ from the template: ${differing.join(", ")}`,
				"template with per-project values (no <...> placeholders)",
				`Reconcile ${args.targetPath} with the ${args.fileName} blueprint (keeping per-project values where the golden uses <...> placeholders), then re-run check.`,
			);
		}
		return pass(args.base, "matches template", args.golden);
	}
	if (!isRecord(goldenParsed) || !isRecord(localParsed)) {
		return failManual(
			args.base,
			args.localText,
			args.golden,
			`Cannot apply compare rules for ${args.fileName}: both files must be JSON objects; reconcile manually.`,
		);
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

export async function checkProjectFileWithGolden(args: {
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
				"exists (templated from blueprint)",
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
		return pass(base, "matches golden", args.golden);
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
	const trimmedGolden = args.golden.trimStart();
	if (
		(trimmedGolden.startsWith("{") || trimmedGolden.startsWith("[")) &&
		goldenPlaceholders(args.golden).length === 0 &&
		containsPlaceholderText(args.golden)
	) {
		return failManual(
			base,
			targetRead.text,
			args.golden,
			`Blueprint ${args.fileName} is not valid JSON; cannot compare.`,
		);
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
		kind: "project",
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

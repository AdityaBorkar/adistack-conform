import {
	collectTemplateIssues,
	containsPlaceholderText,
	isTemplateUpstream,
	upstreamPlaceholders,
} from "#/core/project/template.js";
import type { CheckBase, CheckResult } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass } from "#/core/result.js";
import type { ManifestCompare } from "#/core/upstream/registry.js";
import { readFileSafe } from "#/utils/fs.js";
import { isRecord, omitKeys, serializeJson, deepEqual, setOwn } from "#/utils/json.js";
import { parseJsonc } from "#/utils/jsonc.js";

const EMPTY_COMPARE: ManifestCompare = {
	ignore: [],
};

function hasCompareRules(compare: ManifestCompare): boolean {
	return compare.ignore.length > 0;
}

interface SemanticArgs {
	base: CheckBase;
	compare: ManifestCompare;
	fileName: string;
	upstream: string;
	localText: string;
	targetPath: string;
}

function overlayResult(
	args: SemanticArgs & {
		upstreamRest: Record<string, unknown>;
		localRest: Record<string, unknown>;
	},
): CheckResult | undefined {
	const upstreamKept = omitKeys(args.upstreamRest, args.compare.ignore);
	const localKept = omitKeys(args.localRest, args.compare.ignore);
	// Extra local keys are preserved by fix, so they pass here too: only
	// upstream keys must match. Otherwise fix would never converge.
	const matches = Object.entries(upstreamKept).every(
		([key, value]) => Object.hasOwn(localKept, key) && deepEqual(localKept[key], value),
	);
	if (matches) {
		const kept =
			args.compare.ignore.length > 0 ? ` (local ${args.compare.ignore.join("/")} kept)` : "";
		return pass(args.base, `matches upstream${kept}`, args.upstream);
	}
	const merged: Record<string, unknown> = { ...args.upstreamRest };
	for (const [key, value] of Object.entries(args.localRest)) {
		if (!Object.hasOwn(merged, key) || args.compare.ignore.includes(key)) {
			setOwn(merged, key, value);
		}
	}
	const newContent = serializeJson(merged, args.upstream);
	return failFixable(args.base, args.localText, newContent, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent,
	});
}

function semanticResult(args: SemanticArgs): CheckResult | undefined {
	const template = isTemplateUpstream(args.upstream);
	const needsJson = template || hasCompareRules(args.compare);
	// Upstream that is not a JSON object/array: templates and compare rules cannot apply.
	const invalidUpstream = (): CheckResult | undefined => {
		if (template) {
			return failManual(
				args.base,
				args.localText,
				args.upstream,
				`Blueprint ${args.fileName} is not a valid JSON object; cannot compare.`,
			);
		}
		if (hasCompareRules(args.compare)) {
			return failManual(
				args.base,
				args.localText,
				args.upstream,
				`Cannot use compare rules for ${args.fileName}: the upstream is not a JSON object; fix the blueprint manually.`,
			);
		}
		return undefined;
	};
	let upstreamParsed: unknown;
	try {
		upstreamParsed = parseJsonc(args.upstream);
	} catch {
		return invalidUpstream();
	}
	if (!isRecord(upstreamParsed) && !Array.isArray(upstreamParsed)) {
		return invalidUpstream();
	}
	let localParsed: unknown;
	try {
		localParsed = parseJsonc(args.localText);
	} catch {
		if (needsJson) {
			return failManual(
				args.base,
				"<unparsable>",
				args.upstream,
				`Cannot parse ${args.targetPath} as JSON; fix the syntax manually.`,
			);
		}
		return undefined;
	}
	if (template) {
		const differing: string[] = [];
		if (isRecord(upstreamParsed) && isRecord(localParsed) && hasCompareRules(args.compare)) {
			collectTemplateIssues(
				omitKeys(upstreamParsed, args.compare.ignore),
				omitKeys(localParsed, args.compare.ignore),
				"",
				differing,
				0,
			);
		} else {
			collectTemplateIssues(upstreamParsed, localParsed, "", differing, 0);
		}
		if (differing.length > 0) {
			return failManual(
				args.base,
				`fields differ from the template: ${differing.join(", ")}`,
				"template with per-project values (no <...> placeholders)",
				`Reconcile ${args.targetPath} with the ${args.fileName} blueprint (keeping per-project values where the upstream uses <...> placeholders), then re-check.`,
			);
		}
		return pass(args.base, "matches template", args.upstream);
	}
	if (!isRecord(upstreamParsed) || !isRecord(localParsed)) {
		return failManual(
			args.base,
			args.localText,
			args.upstream,
			`Cannot use compare rules for ${args.fileName}: both files must be JSON objects; reconcile manually.`,
		);
	}
	return overlayResult({ ...args, localRest: localParsed, upstreamRest: upstreamParsed });
}

function unreadableTarget(base: CheckBase, upstream: string, targetPath: string, error: string) {
	return failManual(
		base,
		"<unreadable>",
		upstream,
		`Cannot read ${targetPath} (may need sudo): ${error}`,
	);
}

export async function checkProjectFileWithUpstream(args: {
	blueprint: string;
	compare?: ManifestCompare;
	fileName: string;
	fileTarget: string;
	upstream: string;
	sourceLabel: string;
	targetPath: string;
}): Promise<CheckResult> {
	const base = checkBase("project", args.blueprint, args.fileName, args.fileTarget);
	const compare = { ...EMPTY_COMPARE, ...args.compare };
	const template = isTemplateUpstream(args.upstream);
	const targetRead = await readFileSafe(args.targetPath);
	if (!targetRead.ok) {
		if (targetRead.reason !== "missing") {
			return unreadableTarget(base, args.upstream, args.targetPath, targetRead.error);
		}
		if (template) {
			return failManual(
				base,
				"<missing>",
				"exists (templated from blueprint)",
				`Copy ${args.sourceLabel} to ${args.targetPath}, adapt per-project fields, then re-check.`,
			);
		}
		return failFixable(base, "<missing>", args.upstream, {
			filePath: args.targetPath,
			kind: "overwrite-file",
			newContent: args.upstream,
		});
	}
	// Templates never pass on byte equality: a verbatim copy still holds
	// placeholders, so it must go through the semantic path and fail manual
	// until every upstream `<...>` slot is replaced with per-project values.
	if (template) {
		const unadapted = upstreamPlaceholders(args.upstream).filter((token) =>
			targetRead.text.includes(token),
		);
		if (unadapted.length > 0) {
			return failManual(
				base,
				`contains placeholders: ${unadapted.join(", ")}`,
				"adapted template (no <...> placeholders)",
				`Replace ${unadapted.join(", ")} in ${args.targetPath} with per-project values (copied from ${args.sourceLabel}), then re-check.`,
			);
		}
	} else if (targetRead.text === args.upstream) {
		return pass(base, "matches upstream", args.upstream);
	}
	if (template || hasCompareRules(compare)) {
		const semantic = semanticResult({
			base,
			compare,
			fileName: args.fileName,
			localText: targetRead.text,
			targetPath: args.targetPath,
			upstream: args.upstream,
		});
		if (semantic !== undefined) {
			return semantic;
		}
	}
	const trimmedUpstream = args.upstream.trimStart();
	if (
		(trimmedUpstream.startsWith("{") || trimmedUpstream.startsWith("[")) &&
		upstreamPlaceholders(args.upstream).length === 0 &&
		containsPlaceholderText(args.upstream)
	) {
		return failManual(
			base,
			targetRead.text,
			args.upstream,
			`Blueprint ${args.fileName} is not valid JSON; cannot compare.`,
		);
	}
	return failFixable(base, targetRead.text, args.upstream, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent: args.upstream,
	});
}

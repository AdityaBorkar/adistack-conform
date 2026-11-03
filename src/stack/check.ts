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
		if (targetRead.reason === "missing") {
			return failFixable(base, "<missing>", args.golden, {
				filePath: args.targetPath,
				kind: "overwrite-file",
				newContent: args.golden,
			});
		}
		return unreadableTarget(base, args.golden, args.targetPath, targetRead.error);
	}
	if (targetRead.text === args.golden) {
		return pass(base, "matches preset", args.golden);
	}
	return failFixable(base, targetRead.text, args.golden, {
		filePath: args.targetPath,
		kind: "overwrite-file",
		newContent: args.golden,
	});
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

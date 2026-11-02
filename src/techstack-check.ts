import { join } from "node:path";

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
	if (scope === "project" && (token.startsWith("./") || token.startsWith("../"))) {
		return { path: token, type: "path" };
	}
	return { reason: `no concrete target ("${target}")`, type: "skip" };
}

function isExampleFile(presetRelPath: string): boolean {
	return presetRelPath.endsWith(".example");
}

function isBlankGolden(golden: string): boolean {
	if (golden.length === 0) {
		return true;
	}
	return /^\s*$/u.test(golden);
}

function baseFor(
	packageName: string,
	presetFileName: string,
	presetTarget: string,
	scope: CheckScope,
): CheckBase {
	return {
		id: `preset:${packageName}:${presetFileName}`,
		kind: "preset",
		scope,
		source: `tech-stack:${packageName}`,
		target: presetTarget,
	};
}

function checkExampleOutcome(
	base: CheckBase,
	presetRelPath: string,
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
			`Copy ${presetRelPath} to ${targetPath} and fill in secret values (never commit).`,
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

export interface CheckFileArgs {
	packageName: string;
	presetFileName: string;
	presetRelPath: string;
	presetTarget: string;
	repoRoot: string;
	scope: CheckScope;
	targetPath: string;
}

export async function checkPresetFile(args: CheckFileArgs): Promise<CheckResult> {
	const { packageName, presetFileName, presetRelPath, presetTarget, repoRoot, scope, targetPath } =
		args;
	const base = baseFor(packageName, presetFileName, presetTarget, scope);
	const presetPath = join(repoRoot, presetRelPath);
	const [presetRead, targetRead] = await Promise.all([
		readFileSafe(presetPath),
		readFileSafe(targetPath),
	]);
	if (!presetRead.ok) {
		if (presetRead.reason === "missing") {
			return failManual(
				base,
				"<preset file missing>",
				presetRelPath,
				`Preset file missing in tech-stack repo: ${presetPath}`,
			);
		}
		return failManual(base, "<unreadable preset>", presetRelPath, presetRead.error);
	}
	const golden = presetRead.text;
	if (isExampleFile(presetRelPath)) {
		return checkExampleOutcome(base, presetRelPath, targetPath, targetRead);
	}
	if (isBlankGolden(golden) && !targetRead.ok && targetRead.reason === "missing") {
		return pass(base, "defaults (empty preset)", "absent (empty preset = defaults)");
	}
	if (!targetRead.ok) {
		if (targetRead.reason === "missing") {
			return failFixable(base, "<missing>", golden, {
				filePath: targetPath,
				kind: "overwrite-file",
				newContent: golden,
			});
		}
		return unreadableTarget(base, golden, targetPath, targetRead.error);
	}
	if (targetRead.text === golden) {
		return pass(base, "matches preset", golden);
	}
	return failFixable(base, targetRead.text, golden, {
		filePath: targetPath,
		kind: "overwrite-file",
		newContent: golden,
	});
}

export async function checkPresetFileWithGolden(args: {
	golden: string;
	packageName: string;
	presetFileName: string;
	presetRelPath: string;
	presetTarget: string;
	scope: CheckScope;
	targetPath: string;
}): Promise<CheckResult> {
	const base = baseFor(args.packageName, args.presetFileName, args.presetTarget, args.scope);
	if (isExampleFile(args.presetRelPath)) {
		return checkExampleOutcome(
			base,
			args.presetRelPath,
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
	packageName: string,
	presetFileName: string,
	presetRelPath: string,
	presetTarget: string,
	reason: string,
	scope: CheckScope,
): CheckResult {
	return skipped(baseFor(packageName, presetFileName, presetTarget, scope), presetRelPath, reason);
}

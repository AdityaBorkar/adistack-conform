import { join } from "node:path";

import type { CheckBase, CheckResult, CheckScope } from "#/checks.js";
import { failFixable, failManual, pass, skipped } from "#/checks.js";
import { errorMessage } from "#/fs.js";

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

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isExampleFile(presetRelPath: string): boolean {
	return presetRelPath.endsWith(".example");
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

async function checkExample(
	base: CheckBase,
	presetRelPath: string,
	targetPath: string,
): Promise<CheckResult> {
	const targetFile = Bun.file(targetPath);
	if (await targetFile.exists()) {
		return pass(base, "exists", "exists (values stay secret)");
	}
	return failManual(
		base,
		"<missing>",
		"exists (values stay secret)",
		`Copy ${presetRelPath} to ${targetPath} and fill in secret values (never commit).`,
	);
}

async function readGolden(presetPath: string): Promise<{ golden?: string; error?: string }> {
	try {
		return { golden: await Bun.file(presetPath).text() };
	} catch (error) {
		return { error: errorMessage(error) };
	}
}

async function readActual(targetPath: string): Promise<{ actual: string; error?: string }> {
	try {
		const targetFile = Bun.file(targetPath);
		if (await targetFile.exists()) {
			return { actual: await targetFile.text() };
		}
		return { actual: "<missing>" };
	} catch (error) {
		return {
			actual: "<unreadable>",
			error: `Cannot read ${targetPath} (may need sudo): ${errorMessage(error)}`,
		};
	}
}

export async function checkPresetFile(
	packageName: string,
	presetRelPath: string,
	presetFileName: string,
	presetTarget: string,
	repoRoot: string,
	targetPath: string,
	scope: CheckScope,
): Promise<CheckResult> {
	const base = baseFor(packageName, presetFileName, presetTarget, scope);
	const presetPath = join(repoRoot, presetRelPath);
	if (!(await Bun.file(presetPath).exists())) {
		return failManual(
			base,
			"<preset file missing>",
			presetRelPath,
			`Preset file missing in tech-stack repo: ${presetPath}`,
		);
	}
	if (isExampleFile(presetRelPath)) {
		return checkExample(base, presetRelPath, targetPath);
	}
	const { golden, error: goldenError } = await readGolden(presetPath);
	if (golden === undefined) {
		return failManual(base, "<unreadable preset>", presetRelPath, goldenError ?? "<unreadable>");
	}
	if (golden.trim() === "" && !(await Bun.file(targetPath).exists())) {
		return pass(base, "defaults (empty preset)", "absent (empty preset = defaults)");
	}
	const { actual, error: actualError } = await readActual(targetPath);
	if (actualError !== undefined) {
		return failManual(base, actual, short(golden), actualError);
	}
	if (actual === golden) {
		return pass(base, "matches preset", short(golden));
	}
	return failFixable(base, short(actual), short(golden), {
		filePath: targetPath,
		kind: "overwrite-file",
		newContent: golden,
	});
}

export function skippedForTarget(
	packageName: string,
	presetFileName: string,
	presetPath: string,
	presetTarget: string,
	reason: string,
	scope: CheckScope,
): CheckResult {
	return skipped(baseFor(packageName, presetFileName, presetTarget, scope), presetPath, reason);
}

import { join } from "node:path";

import type { CheckResult, CheckScope } from "#/checks.js";
import { failFixable, failManual, pass, skipped } from "#/checks.js";

export type ClassifiedTarget = { reason: string; type: "skip" } | { path: string; type: "path" };

export function classifyTarget(target: string, scope: CheckScope): ClassifiedTarget {
	if (target.startsWith("docs:")) {
		return { reason: "docs-only, nothing to enforce", type: "skip" };
	}
	const [token = ""] = target.split(/\s/u);
	if (token === "~" || token.startsWith("~/") || token.startsWith("/")) {
		return { path: token, type: "path" };
	}
	if (token.includes("%")) {
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

function isExampleFile(presetRelPath: string, presetFileName: string): boolean {
	return presetRelPath.endsWith(".example") || presetFileName.endsWith(".example");
}

type PresetBase = {
	id: string;
	kind: "preset";
	scope: CheckScope;
	source: string;
	target: string;
};

function baseFor(
	packageName: string,
	presetFileName: string,
	presetTarget: string,
	scope: CheckScope,
): PresetBase {
	return {
		id: `preset:${packageName}:${presetFileName}`,
		kind: "preset",
		scope,
		source: `tech-stack:${packageName}`,
		target: presetTarget,
	};
}

async function checkExample(
	base: PresetBase,
	presetRelPath: string,
	targetPath: string,
): Promise<CheckResult | undefined> {
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
	const presetFile = Bun.file(presetPath);
	if (!(await presetFile.exists())) {
		return failManual(
			base,
			"<preset file missing>",
			presetRelPath,
			`Preset file missing in tech-stack repo: ${presetPath}`,
		);
	}
	if (isExampleFile(presetRelPath, presetFileName)) {
		const outcome = await checkExample(base, presetRelPath, targetPath);
		if (outcome !== undefined) {
			return outcome;
		}
	}
	let golden: string;
	try {
		golden = await presetFile.text();
	} catch (error) {
		return failManual(
			base,
			"<unreadable preset>",
			presetRelPath,
			error instanceof Error ? error.message : String(error),
		);
	}
	const targetFile = Bun.file(targetPath);
	if (golden.trim() === "" && !(await targetFile.exists())) {
		return pass(base, "defaults (empty preset)", "absent (empty preset = defaults)");
	}
	let actual: string;
	try {
		actual = (await targetFile.exists()) ? await targetFile.text() : "<missing>";
	} catch (error) {
		return failManual(
			base,
			"<unreadable>",
			short(golden),
			`Cannot read ${targetPath} (may need sudo): ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (actual === golden) {
		return { ...base, actual: "matches preset", expected: short(golden), fixable: false, ok: true };
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
	return skipped(
		{
			id: `preset:${packageName}:${presetFileName}`,
			kind: "preset",
			scope,
			source: `tech-stack:${packageName}`,
			target: presetTarget,
		},
		presetPath,
		reason,
	);
}

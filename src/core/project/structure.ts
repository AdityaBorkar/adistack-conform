import { stat } from "node:fs/promises";

import { projectBase, projectId } from "#/core/project/compare.js";
import type { ProjectCheckOptions } from "#/core/project/index.js";
import type { CheckResult } from "#/core/result.js";
import { failManual, pass, skipped } from "#/core/result.js";
import type { ManifestFile, ManifestFileStructure } from "#/core/upstream/registry.js";
import { isMissingError, readFileSafe, resolveTargetPath } from "#/utils/fs.js";

async function checkFileStructureEntry(args: {
	blueprint: string;
	entryName: string;
	kind: "dir" | "file";
	targetPath: string;
}): Promise<CheckResult> {
	const base = projectBase(args.blueprint, args.entryName, args.entryName);
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
			if (isMissingError(error)) {
				// shortcut: manual for now; extend to an ensure-dir fix if dir auto-creation is wanted.
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
			`${args.entryName} is missing. Generate one for this project, then re-check.`,
		);
	}
	return failManual(
		base,
		"<unreadable>",
		"exists (generate per-project content)",
		`Cannot read ${args.targetPath} (may need sudo): ${outcome.error}`,
	);
}

// Blueprint `file_structure[]` entries assert existence only; see ADR 0007.
export async function checkFileStructure(
	blueprint: string,
	files: ManifestFile[],
	structure: ManifestFileStructure[],
	options: ProjectCheckOptions,
	onlyIds?: ReadonlySet<string>,
): Promise<CheckResult[]> {
	const enforcedTargets = new Set(
		files.map((file) => resolveTargetPath(file.target, options.baseDir, options.home)),
	);
	const tasks: Promise<CheckResult>[] = [];
	const notes: CheckResult[] = [];
	const seenTargets = new Map<string, string>();
	for (const entry of structure) {
		const targetPath = resolveTargetPath(entry.target, options.baseDir, options.home);
		if (enforcedTargets.has(targetPath)) {
			continue;
		}
		if (onlyIds !== undefined && !onlyIds.has(projectId(blueprint, entry.name))) {
			continue;
		}
		if (seenTargets.has(targetPath)) {
			notes.push(
				skipped(
					projectBase(blueprint, entry.name, entry.target),
					"duplicate file-structure target",
					`same target as "${seenTargets.get(targetPath)}"; keeping the first entry`,
				),
			);
			continue;
		}
		seenTargets.set(targetPath, entry.name);
		tasks.push(
			checkFileStructureEntry({
				blueprint,
				entryName: entry.name,
				kind: entry.kind,
				targetPath,
			}),
		);
	}
	const results = await Promise.all(tasks);
	return [...results, ...notes];
}

import type { CheckResult, CheckScope } from "#/checks.js";
import { failManual, pass } from "#/checks.js";
import type { ManifestFile } from "#/stack/registry.js";

// Allowed sections mirror ManifestPackageSchema in #/schemas/manifest.js.
type DepSection = "dependencies" | "devDependencies" | "peerDependencies";

const SECTIONS: readonly DepSection[] = ["dependencies", "devDependencies", "peerDependencies"];

function installFlag(section: DepSection): string {
	return section === "devDependencies" ? "-d " : "";
}

// General target rule: docs-only and Windows-only targets are never enforced,
// so they never imply package requirements either.
function isEnforcedTarget(target: string): boolean {
	const [token = ""] = target.split(/\s+/u);
	if (token.startsWith("docs:")) {
		return false;
	}
	return !/%[A-Za-z_][A-Za-z0-9_]*%/u.test(token);
}

function requiredDepsForFiles(
	files: ManifestFile[],
): Map<string, { config: string; section: DepSection }> {
	const needed = new Map<string, { config: string; section: DepSection }>();
	for (const file of files) {
		if (!isEnforcedTarget(file.target)) {
			continue;
		}
		for (const pkg of file.packages ?? []) {
			const name = typeof pkg === "string" ? pkg : pkg.name;
			if (!needed.has(name)) {
				needed.set(name, {
					config: file.name,
					section: typeof pkg === "string" ? "devDependencies" : pkg.section,
				});
			}
		}
	}
	return needed;
}

function readSection(pkg: Record<string, unknown>, section: string): Record<string, string> {
	const value = pkg[section];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, version] of Object.entries(value as Record<string, unknown>)) {
		if (typeof version === "string") {
			out[key] = version;
		}
	}
	return out;
}

export function checkToolchainDeps(args: {
	blueprint: string;
	files: ManifestFile[];
	localPkg: Record<string, unknown> | undefined;
	presetVersions: Record<string, string>;
	scope: CheckScope;
	onlyIds?: ReadonlySet<string>;
}): CheckResult[] {
	const needed = requiredDepsForFiles(args.files);
	const results: CheckResult[] = [];
	for (const [pkg, need] of needed) {
		const id = `project:${args.blueprint}:deps:${pkg}`;
		if (args.onlyIds !== undefined && !args.onlyIds.has(id)) {
			continue;
		}
		const base = {
			id,
			kind: "package",
			scope: args.scope,
			source: `tech-stack:${args.blueprint}`,
			target: "package.json",
		} as const;
		if (args.localPkg === undefined) {
			results.push(
				failManual(
					base,
					"<missing>",
					pkg,
					`package.json is missing or unparsable; add ${pkg} to ${need.section} (needed by ${need.config}).`,
				),
			);
			continue;
		}
		if (pkg in readSection(args.localPkg, need.section)) {
			const version = readSection(args.localPkg, need.section)[pkg] as string;
			results.push(pass(base, version, `installed in ${need.section}`));
			continue;
		}
		const version = args.presetVersions[pkg];
		const versionHint = version === undefined ? "" : `@${version}`;
		const flag = installFlag(need.section);
		const found = SECTIONS.filter(
			(section) =>
				section !== need.section &&
				pkg in readSection(args.localPkg as Record<string, unknown>, section),
		);
		if (found.length > 0) {
			const [actual = ""] = found;
			results.push(
				failManual(
					base,
					actual,
					need.section,
					`Move ${pkg} from ${actual} to ${need.section} (needed by ${need.config}): bun remove ${pkg} && bun add ${flag}${pkg}${versionHint}.`,
				),
			);
			continue;
		}
		results.push(
			failManual(
				base,
				"<missing>",
				`${need.section} has ${pkg}${versionHint}`,
				`Install ${pkg} in ${need.section} (needed by ${need.config}): bun add ${flag}${pkg}${versionHint}.`,
			),
		);
	}
	return results;
}

export function presetDepVersions(presetPkgText: string | undefined): Record<string, string> {
	if (presetPkgText === undefined) {
		return {};
	}
	try {
		const parsed = JSON.parse(presetPkgText) as Record<string, unknown>;
		return {
			...readSection(parsed, "peerDependencies"),
			...readSection(parsed, "dependencies"),
			...readSection(parsed, "devDependencies"),
		};
	} catch {
		return {};
	}
}

export function parseLocalPackageJson(
	text: string | undefined,
): Record<string, unknown> | undefined {
	if (text === undefined) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

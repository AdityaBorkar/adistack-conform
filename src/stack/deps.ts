import type { CheckResult, CheckScope } from "#/checks.js";
import { failManual, pass } from "#/checks.js";
import type { ManifestJs } from "#/stack/registry.js";

// Package managers are platform knowledge (like npm section names): the table
// only maps each binary to its install/remove verbs. Unknown binaries fall
// back to bun-style verbs. Which packages are required comes from the
// manifest `js` field, never from this table.
type DepSection = "dependencies" | "devDependencies" | "peerDependencies";

const SECTIONS: readonly DepSection[] = ["dependencies", "devDependencies", "peerDependencies"];

const PM_COMMANDS: Record<string, { add: string; dev: string; remove: string }> = {
	bun: { add: "add", dev: "-d", remove: "remove" },
	npm: { add: "install", dev: "-D", remove: "uninstall" },
	pnpm: { add: "add", dev: "-D", remove: "remove" },
	yarn: { add: "add", dev: "-D", remove: "remove" },
};

const GENERIC_PM_COMMANDS = { add: "add", dev: "-d", remove: "remove" };

function pmCommands(pm: string): { add: string; dev: string; remove: string } {
	return PM_COMMANDS[pm] ?? GENERIC_PM_COMMANDS;
}

function isAnyVersion(version: string): boolean {
	return version === "" || version === "any";
}

function installCommand(pm: string, section: DepSection, pkg: string, versionHint: string): string {
	const cmd = pmCommands(pm);
	const flag = section === "devDependencies" ? `${cmd.dev} ` : "";
	return `${pm} ${cmd.add} ${flag}${pkg}${versionHint}`;
}

function removeCommand(pm: string, pkg: string): string {
	return `${pm} ${pmCommands(pm).remove} ${pkg}`;
}

function requiredDeps(js: ManifestJs): Map<string, { section: DepSection; version: string }> {
	const needed = new Map<string, { section: DepSection; version: string }>();
	for (const section of SECTIONS) {
		for (const [pkg, version] of Object.entries(js[section])) {
			if (!needed.has(pkg)) {
				needed.set(pkg, { section, version });
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
	js: ManifestJs | undefined;
	localPkg: Record<string, unknown> | undefined;
	scope: CheckScope;
	onlyIds?: ReadonlySet<string>;
}): CheckResult[] {
	if (args.js === undefined) {
		return [];
	}
	const pm = args.js.pm;
	const needed = requiredDeps(args.js);
	const results: CheckResult[] = [];
	for (const [pkg, req] of needed) {
		const section = req.section;
		const expected = req.version;
		const versionHint = isAnyVersion(expected) ? "" : `@${expected}`;
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
					`package.json is missing or unparsable; add ${pkg} to ${section} (declared in manifest js.${section}).`,
				),
			);
			continue;
		}
		const sections: Record<DepSection, Record<string, string>> = {
			dependencies: readSection(args.localPkg, "dependencies"),
			devDependencies: readSection(args.localPkg, "devDependencies"),
			peerDependencies: readSection(args.localPkg, "peerDependencies"),
		};
		if (Object.hasOwn(sections[section], pkg)) {
			const version = sections[section][pkg] as string;
			if (!isAnyVersion(expected) && version !== expected) {
				results.push(
					failManual(
						base,
						version,
						`${section} has ${pkg}@${expected}`,
						`Update ${pkg} in ${section} from ${version} to ${expected} (declared in manifest js.${section}): ${installCommand(pm, section, pkg, versionHint)}.`,
					),
				);
				continue;
			}
			results.push(pass(base, version, `installed in ${section}`));
			continue;
		}
		const found = SECTIONS.filter(
			(other) => other !== section && Object.hasOwn(sections[other], pkg),
		);
		if (found.length > 0) {
			const [actual = ""] = found;
			results.push(
				failManual(
					base,
					actual,
					section,
					`Move ${pkg} from ${actual} to ${section} (declared in manifest js.${section}): ${removeCommand(pm, pkg)} && ${installCommand(pm, section, pkg, versionHint)}.`,
				),
			);
			continue;
		}
		results.push(
			failManual(
				base,
				"<missing>",
				`${section} has ${pkg}${versionHint}`,
				`Install ${pkg} in ${section} (declared in manifest js.${section}): ${installCommand(pm, section, pkg, versionHint)}.`,
			),
		);
	}
	return results;
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

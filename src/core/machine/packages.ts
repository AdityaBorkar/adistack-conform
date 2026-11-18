import type { InstalledPackages, ManagerId, PackageRef } from "#/core/machine/managers/types.js";
import type { CheckBase, CheckResult, RunCommandFix } from "#/core/result.js";
import { failFixable, pass, skipped } from "#/core/result.js";

export interface DeclaredPackage {
	manager: ManagerId;
	name: string;
	version: string;
}

export interface ManifestPackages {
	bun: Record<string, string>;
	pacman: Record<string, string>;
}

export interface EvaluatePackagesArgs {
	allowlist: Record<ManagerId, Set<string>>;
	blueprint: string;
	declared: DeclaredPackage[];
	installed: Record<ManagerId, InstalledPackages>;
	// Strict runs treat extras as drift (fixable removal) instead of skipping them.
	strict: boolean;
}

const MANAGERS: ManagerId[] = ["bun", "pacman"];

// Declared maps (name -> version) flatten to one entry per manager+name.
// Record keys are unique by construction, so no dedupe pass is needed.
export function declaredFromManifest(packages: ManifestPackages): DeclaredPackage[] {
	const declared: DeclaredPackage[] = [];
	for (const [name, version] of Object.entries(packages.pacman)) {
		declared.push({ manager: "pacman", name, version });
	}
	for (const [name, version] of Object.entries(packages.bun)) {
		declared.push({ manager: "bun", name, version });
	}
	return declared;
}

function installFix(manager: ManagerId, entry: PackageRef): RunCommandFix {
	if (manager === "pacman") {
		const spec = entry.version === "latest" ? entry.name : `${entry.name}=${entry.version}`;
		return {
			args: ["pacman", "-S", "--needed", "--noconfirm", spec],
			command: "sudo",
			kind: "run-command",
			label: `sudo pacman -S --needed --noconfirm ${spec}`,
		};
	}
	return {
		args: ["add", "-g", `${entry.name}@${entry.version}`],
		command: "bun",
		kind: "run-command",
		label: `bun add -g ${entry.name}@${entry.version}`,
	};
}

function removeFix(manager: ManagerId, name: string): RunCommandFix {
	if (manager === "pacman") {
		return {
			args: ["pacman", "-Rs", "--noconfirm", name],
			command: "sudo",
			kind: "run-command",
			label: `sudo pacman -Rs --noconfirm ${name}`,
		};
	}
	return {
		args: ["remove", "-g", name],
		command: "bun",
		kind: "run-command",
		label: `bun remove -g ${name}`,
	};
}

// One result per declared package plus one per extra. Missing and version
// drift are always fixable; extras are skipped unless the run is strict.
export function evaluatePackages(args: EvaluatePackagesArgs): CheckResult[] {
	const upstream = `tech-stack:${args.blueprint}`;
	const results: CheckResult[] = [];
	for (const manager of MANAGERS) {
		const wanted = new Map<string, string>();
		for (const entry of args.declared) {
			if (entry.manager === manager) {
				wanted.set(entry.name, entry.version);
			}
		}
		const declaredNames = [...wanted.keys()].toSorted();
		const installed = args.installed[manager] ?? {
			explicit: new Set<string>(),
			versions: new Map<string, string>(),
		};
		const { versions } = installed;
		const allow = args.allowlist[manager] ?? new Set<string>();
		const { extra, missing } = splitDeclared(declaredNames, installed, allow);
		const missingSet = new Set(missing);
		for (const name of declaredNames) {
			const version = wanted.get(name) ?? "latest";
			const base: CheckBase = {
				id: `machine:${args.blueprint}:${manager}:${name}`,
				kind: "machine",
				scope: "machine",
				target: `${manager}:${name}`,
				upstream,
			};
			if (missingSet.has(name)) {
				results.push(
					failFixable(
						base,
						`missing: ${name} is not installed`,
						`package ${name} installed`,
						installFix(manager, { name, version }),
					),
				);
			} else if (version !== "latest" && versions.get(name) !== version) {
				results.push(
					failFixable(
						base,
						`version drift: ${name} is ${versions.get(name) ?? "<unknown>"}, want ${version}`,
						`package ${name}@${version} installed`,
						installFix(manager, { name, version }),
					),
				);
			} else {
				results.push(pass(base, `package ${name} installed`, `package ${name} installed`));
			}
		}
		const expectedExtras = `only declared ${manager} packages installed`;
		for (const name of extra) {
			const base: CheckBase = {
				id: `machine:${args.blueprint}:${manager}:${name}`,
				kind: "machine",
				scope: "machine",
				target: `${manager}:${name}`,
				upstream,
			};
			if (args.strict) {
				results.push(
					failFixable(
						base,
						`extra: ${name} is installed but not declared`,
						expectedExtras,
						removeFix(manager, name),
					),
				);
			} else {
				results.push(skipped(base, expectedExtras, `extra: ${name} is installed but not declared`));
			}
		}
	}
	return results;
}

// Missing = declared but not installed at all (a package pulled in as a
// dependency counts: `pacman -S --needed` would skip it, so it can never be
// "fixed"). Extras = explicitly installed but neither declared nor allowed.
export function splitDeclared(
	declared: string[],
	installed: InstalledPackages,
	allow: Set<string>,
): { extra: string[]; missing: string[] } {
	const declaredSet = new Set(declared);
	return {
		extra: [...installed.explicit]
			.filter((name) => !declaredSet.has(name) && !allow.has(name))
			.toSorted(),
		missing: [...declaredSet].filter((name) => !installed.versions.has(name)).toSorted(),
	};
}

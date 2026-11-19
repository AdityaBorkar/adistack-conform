import { aptManager } from "#/core/machine/managers/apt.js";
import { bunManager } from "#/core/machine/managers/bun.js";
import { pacmanManager } from "#/core/machine/managers/pacman.js";
import type {
	InstalledPackages,
	ManagerId,
	PackageManager,
} from "#/core/machine/managers/types.js";
import type { SystemManager } from "#/core/machine/os.js";
import type { CheckBase, CheckResult } from "#/core/result.js";
import { checkBase, failFixable, pass, skipped } from "#/core/result.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { errorMessage } from "#/utils/error.js";

export const MANAGERS: Record<ManagerId, PackageManager> = {
	apt: aptManager,
	bun: bunManager,
	pacman: pacmanManager,
};

// Report order.
const MANAGER_IDS: ManagerId[] = ["apt", "bun", "pacman"];

function emptyInstalled(): InstalledPackages {
	return { explicit: new Set<string>(), versions: new Map<string, string>() };
}

export const SYSTEM_WARNING =
	"It seems you have not defined any system packages OR your OS Distro is not supported.";

// Auto-OS selection: the distro's system manager runs alongside bun's
// distro-agnostic globals; the other system's packages are ignored so an
// Arch host never flags declared apt packages as missing (and vice versa).
// Unsupported distros check bun globals only and surface SYSTEM_WARNING.
export function activeManagers(system: SystemManager | undefined): ManagerId[] {
	if (system === undefined) {
		return ["bun"];
	}
	return MANAGER_IDS.filter((manager) => manager === "bun" || manager === system);
}

// Unsupported distros cannot enforce system packages: a skip keeps `check`
// green while telling the user why no system packages ran.
export function systemWarning(blueprint: string): CheckResult {
	return skipped(
		checkBase("machine", blueprint, "packages:system", "system packages"),
		"system packages checked",
		SYSTEM_WARNING,
	);
}

export interface EvaluatePackagesArgs {
	allowlist: MachineManifest["allowlist"];
	blueprint: string;
	declared: MachineManifest["packages"];
	installed: Record<ManagerId, InstalledPackages>;
	// The distro's system manager (undefined when unsupported): only it and
	// bun are evaluated, the other system's packages are ignored.
	systemManager: SystemManager | undefined;
	// Strict runs treat extras as drift (fixable removal) instead of skipping them.
	strict: boolean;
}

// Every active manager's installed list, read concurrently. Managers that
// were not queried (the inactive distro) stay empty so cross-distro declared
// packages are never flagged. A manager whose tools are absent contributes
// nothing instead of failing the domain; anything else still rejects into
// the packages guard.
export async function listInstalled(
	list: (manager: ManagerId) => Promise<InstalledPackages>,
	managers: readonly ManagerId[] = MANAGER_IDS,
): Promise<Record<ManagerId, InstalledPackages>> {
	const full: Record<ManagerId, InstalledPackages> = {
		apt: emptyInstalled(),
		bun: emptyInstalled(),
		pacman: emptyInstalled(),
	};
	const entries = await Promise.all(
		managers.map(async (manager) => {
			try {
				return [manager, await list(manager)] as const;
			} catch (error) {
				if (!errorMessage(error).startsWith("Cannot run ")) {
					throw error;
				}
				return [manager, emptyInstalled()] as const;
			}
		}),
	);
	for (const [manager, installed] of entries) {
		full[manager] = installed;
	}
	return full;
}

function extraActual(name: string): string {
	return `extra: ${name} is installed but not declared`;
}

// One result per declared package plus one per extra. Missing and version
// drift are always fixable; extras are skipped unless the run is strict.
// Only the active managers (distro system manager + bun) are evaluated.
export function evaluatePackages(args: EvaluatePackagesArgs): CheckResult[] {
	const results: CheckResult[] = [];
	for (const manager of activeManagers(args.systemManager)) {
		const wanted = args.declared[manager];
		const installed = args.installed[manager];
		const allow = new Set(args.allowlist[manager] ?? []);
		const { extra, missing } = splitDeclared(Object.keys(wanted), installed, allow);
		const missingSet = new Set(missing);
		const base = (name: string): CheckBase =>
			checkBase("machine", args.blueprint, `${manager}:${name}`, `${manager}:${name}`);
		for (const name of Object.keys(wanted).toSorted()) {
			const version = wanted[name] as string;
			const have = installed.versions.get(name);
			const install = MANAGERS[manager].install({ name, version });
			if (missingSet.has(name)) {
				results.push(
					failFixable(
						base(name),
						`missing: ${name} is not installed`,
						`package ${name} installed`,
						install,
					),
				);
			} else if (version !== "latest" && have !== version) {
				results.push(
					failFixable(
						base(name),
						`version drift: ${name} is ${have ?? "<unknown>"}, want ${version}`,
						`package ${name}@${version} installed`,
						install,
					),
				);
			} else {
				results.push(pass(base(name), `package ${name} installed`, `package ${name} installed`));
			}
		}
		const expectedExtras = `only declared ${manager} packages installed`;
		for (const name of extra) {
			results.push(
				args.strict
					? failFixable(
							base(name),
							extraActual(name),
							expectedExtras,
							MANAGERS[manager].remove(name),
						)
					: skipped(base(name), expectedExtras, extraActual(name)),
			);
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

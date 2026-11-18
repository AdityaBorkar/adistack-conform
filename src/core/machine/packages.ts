import { bunManager } from "#/core/machine/managers/bun.js";
import { pacmanManager } from "#/core/machine/managers/pacman.js";
import type {
	InstalledPackages,
	ManagerId,
	PackageManager,
} from "#/core/machine/managers/types.js";
import type { CheckBase, CheckResult } from "#/core/result.js";
import { checkBase, failFixable, pass, skipped } from "#/core/result.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";

export const MANAGERS: Record<ManagerId, PackageManager> = {
	bun: bunManager,
	pacman: pacmanManager,
};

// Report order.
const MANAGER_IDS: ManagerId[] = ["bun", "pacman"];

export interface EvaluatePackagesArgs {
	allowlist: MachineManifest["allowlist"];
	blueprint: string;
	declared: MachineManifest["packages"];
	installed: Record<ManagerId, InstalledPackages>;
	// Strict runs treat extras as drift (fixable removal) instead of skipping them.
	strict: boolean;
}

// Every manager's installed list, read concurrently.
export async function listInstalled(
	list: (manager: ManagerId) => Promise<InstalledPackages>,
): Promise<Record<ManagerId, InstalledPackages>> {
	const [pacman, bun] = await Promise.all([list("pacman"), list("bun")]);
	return { bun, pacman };
}

function extraActual(name: string): string {
	return `extra: ${name} is installed but not declared`;
}

// One result per declared package plus one per extra. Missing and version
// drift are always fixable; extras are skipped unless the run is strict.
export function evaluatePackages(args: EvaluatePackagesArgs): CheckResult[] {
	const results: CheckResult[] = [];
	for (const manager of MANAGER_IDS) {
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

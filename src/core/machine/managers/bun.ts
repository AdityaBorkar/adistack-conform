import { defaultRunner } from "#/core/machine/managers/types.js";
import type {
	InstalledPackages,
	PackageManager,
	PackageRef,
	Runner,
} from "#/core/machine/managers/types.js";

export function createBunManager(runner: Runner = defaultRunner): PackageManager {
	return {
		id: "bun",
		async install(entries: PackageRef[]): Promise<void> {
			if (entries.length === 0) {
				return;
			}
			await runner.run([
				"bun",
				"add",
				"-g",
				...entries.map((entry) => `${entry.name}@${entry.version}`),
			]);
		},
		async list(): Promise<InstalledPackages> {
			const versions = parseBunGlobalVersions(await runner.capture(["bun", "pm", "-g", "ls"]));
			return { explicit: new Set(versions.keys()), versions };
		},
		async remove(names: string[]): Promise<void> {
			if (names.length === 0) {
				return;
			}
			await runner.run(["bun", "remove", "-g", ...names]);
		},
	};
}

export const bunManager: PackageManager = createBunManager();

// `bun pm -g ls` prints tree lines ending in `<name>@<version>`; scoped
// names (`@scope/name@version`) split on the last `@`. Header lines without
// a version are skipped, as before.
export function parseBunGlobalVersions(stdout: string): Map<string, string> {
	const versions = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const stripped = line.trim().replace(/^[│├└─\s]+/u, "");
		const lastToken = stripped.split(/\s+/u).at(-1) ?? "";
		const match = /^(?<name>@?[^\s@]+(?:\/[^\s@]+)?)@(?<version>\S+)$/u.exec(lastToken);
		const name = match?.groups?.["name"];
		if (name !== undefined && name !== "") {
			versions.set(name, match?.groups?.["version"] ?? "");
		}
	}
	return versions;
}

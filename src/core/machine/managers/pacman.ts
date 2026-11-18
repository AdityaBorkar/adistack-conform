import { defaultRunner } from "#/core/machine/managers/types.js";
import type {
	InstalledPackages,
	PackageManager,
	PackageRef,
	Runner,
} from "#/core/machine/managers/types.js";

export function createPacmanManager(runner: Runner = defaultRunner): PackageManager {
	return {
		id: "pacman",
		async install(entries: PackageRef[]): Promise<void> {
			if (entries.length === 0) {
				return;
			}
			const specs = entries.map((entry) =>
				entry.version === "latest" ? entry.name : `${entry.name}=${entry.version}`,
			);
			await runner.run(["sudo", "pacman", "-S", "--needed", "--noconfirm", ...specs]);
		},
		async list(): Promise<InstalledPackages> {
			const [explicitOut, versionsOut] = await Promise.all([
				runner.capture(["pacman", "-Qqe"]),
				runner.capture(["pacman", "-Q"]),
			]);
			return {
				explicit: new Set(parsePacmanExplicit(explicitOut)),
				versions: parsePacmanVersions(versionsOut),
			};
		},
		async remove(names: string[]): Promise<void> {
			if (names.length === 0) {
				return;
			}
			await runner.run(["sudo", "pacman", "-Rs", "--noconfirm", ...names]);
		},
	};
}

export const pacmanManager: PackageManager = createPacmanManager();

export function parsePacmanExplicit(stdout: string): string[] {
	return stdout.split(/\s+/u).filter((name) => name !== "");
}

// `pacman -Q` prints `<name> <version>` per line (names and versions hold no
// whitespace, so the first token is the name and the rest is the version).
export function parsePacmanVersions(stdout: string): Map<string, string> {
	const versions = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const parts = line.split(/\s+/u).filter((part) => part !== "");
		const name = parts[0];
		if (name === undefined) {
			continue;
		}
		versions.set(name, parts.slice(1).join(" "));
	}
	return versions;
}

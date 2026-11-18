import { parsePacmanExplicit, parsePacmanVersions } from "#/stack/managers/parse.js";
import { defaultRunner } from "#/stack/managers/types.js";
import type {
	InstalledPackages,
	PackageManager,
	PackageRef,
	Runner,
} from "#/stack/managers/types.js";

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

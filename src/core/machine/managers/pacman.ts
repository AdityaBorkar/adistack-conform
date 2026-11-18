import { captureCommand } from "#/core/machine/managers/types.js";
import type { InstalledPackages } from "#/core/machine/managers/types.js";

export async function listPacmanPackages(): Promise<InstalledPackages> {
	const [explicitOut, versionsOut] = await Promise.all([
		captureCommand(["pacman", "-Qqe"]),
		captureCommand(["pacman", "-Q"]),
	]);
	return {
		explicit: new Set(parsePacmanExplicit(explicitOut)),
		versions: parsePacmanVersions(versionsOut),
	};
}

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

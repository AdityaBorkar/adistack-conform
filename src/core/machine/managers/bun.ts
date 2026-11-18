import { captureCommand } from "#/core/machine/managers/types.js";
import type { InstalledPackages } from "#/core/machine/managers/types.js";

export async function listBunPackages(): Promise<InstalledPackages> {
	const versions = parseBunGlobalVersions(await captureCommand(["bun", "pm", "-g", "ls"]));
	return { explicit: new Set(versions.keys()), versions };
}

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

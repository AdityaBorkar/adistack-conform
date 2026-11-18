import type { PackageManager } from "#/core/machine/managers/types.js";
import { captureCommand } from "#/utils/process.js";

// `bun pm -g ls` prints tree lines ending in `<name>@<version>`; scoped
// names (`@scope/name@version`) split on the last `@`. Header lines without
// a version are skipped.
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

// Names reaching argv are schema-validated (no leading "-") or read from bun itself.
export const bunManager: PackageManager = {
	install: ({ name, version }) => ({
		args: ["add", "-g", `${name}@${version}`],
		command: "bun",
		kind: "run-command",
		label: `bun add -g ${name}@${version}`,
	}),
	list: async () => {
		const versions = parseBunGlobalVersions(await captureCommand(["bun", "pm", "-g", "ls"]));
		return { explicit: new Set(versions.keys()), versions };
	},
	remove: (name) => ({
		args: ["remove", "-g", name],
		command: "bun",
		kind: "run-command",
		label: `bun remove -g ${name}`,
	}),
};

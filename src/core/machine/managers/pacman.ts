import type { PackageManager } from "#/core/machine/managers/types.js";
import { captureCommand } from "#/utils/process.js";

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

// `--` ends option parsing, so a package name can never act as a pacman flag under sudo.
export const pacmanManager: PackageManager = {
	install: ({ name, version }) => {
		const spec = version === "latest" ? name : `${name}=${version}`;
		return {
			args: ["pacman", "-S", "--needed", "--noconfirm", "--", spec],
			command: "sudo",
			kind: "run-command",
			label: `sudo pacman -S --needed --noconfirm -- ${spec}`,
			preCommands: [
				// -Syu refreshes and upgrades in one step (pacman has no separate update).
				{
					args: ["pacman", "-Syu", "--noconfirm"],
					command: "sudo",
					label: "sudo pacman -Syu --noconfirm",
				},
				// Orphan names come from pacman itself at runtime, never from upstream
				// data, so no package name can act as a flag here.
				{
					args: [
						"sh",
						"-c",
						'[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -',
					],
					command: "sudo",
					label: `sudo sh -c '[ -z "$(pacman -Qtdq)" ] || pacman -Qtdq | pacman -Rns --noconfirm -'`,
				},
			],
		};
	},
	list: async () => {
		const [explicitOut, versionsOut] = await Promise.all([
			captureCommand(["pacman", "-Qqe"]),
			captureCommand(["pacman", "-Q"]),
		]);
		return {
			explicit: new Set(parsePacmanExplicit(explicitOut)),
			versions: parsePacmanVersions(versionsOut),
		};
	},
	remove: (name) => ({
		args: ["pacman", "-Rs", "--noconfirm", "--", name],
		command: "sudo",
		kind: "run-command",
		label: `sudo pacman -Rs --noconfirm -- ${name}`,
	}),
};

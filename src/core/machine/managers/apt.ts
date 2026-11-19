import type { PackageManager } from "#/core/machine/managers/types.js";
import { captureCommand } from "#/utils/process.js";

// `apt-mark showmanual` prints one name per line, arch-qualified (`foo:amd64`)
// on multiarch systems. Strip the `:arch` suffix so names match the declared
// alphabet (which bans `:`) and the `${binary:Package}` versions below.
export function parseAptExplicit(stdout: string): string[] {
	return stdout
		.split(/\s+/u)
		.filter((name) => name !== "")
		.map((name) => name.split(":")[0] ?? "")
		.filter((name) => name !== "");
}

// `dpkg-query -W -f='${db:Status-Abbrev} ${binary:Package} ${Version}\n'`
// prints one row per known package; only `ii` rows are installed (the rest
// are leftover config/data). `${binary:Package}` omits the `:arch` qualifier
// so names match the declared alphabet (which bans `:`).
export function parseAptVersions(stdout: string): Map<string, string> {
	const versions = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const parts = line.split(/\s+/u).filter((part) => part !== "");
		if (parts[0] !== "ii" || parts[1] === undefined) {
			continue;
		}
		versions.set(parts[1], parts.slice(2).join(" "));
	}
	return versions;
}

// `--` ends option parsing, so a package name can never act as an apt-get flag under sudo.
export const aptManager: PackageManager = {
	install: ({ name, version }) => {
		const spec = version === "latest" ? name : `${name}=${version}`;
		return {
			args: ["apt-get", "install", "-y", "--", spec],
			command: "sudo",
			kind: "run-command",
			label: `sudo apt-get install -y -- ${spec}`,
			preCommands: [
				{ args: ["apt-get", "update"], command: "sudo", label: "sudo apt-get update" },
				{ args: ["apt-get", "upgrade", "-y"], command: "sudo", label: "sudo apt-get upgrade -y" },
				{
					args: ["apt-get", "autoremove", "-y"],
					command: "sudo",
					label: "sudo apt-get autoremove -y",
				},
			],
		};
	},
	list: async () => {
		const [explicitOut, versionsOut] = await Promise.all([
			captureCommand(["apt-mark", "showmanual"]),
			captureCommand([
				"dpkg-query",
				"-W",
				"-f",
				"${db:Status-Abbrev} ${binary:Package} ${Version}\\n",
			]),
		]);
		const versions = parseAptVersions(versionsOut);
		const explicit = new Set(parseAptExplicit(explicitOut).filter((name) => versions.has(name)));
		return { explicit, versions };
	},
	remove: (name) => ({
		args: ["apt-get", "remove", "-y", "--", name],
		command: "sudo",
		kind: "run-command",
		label: `sudo apt-get remove -y -- ${name}`,
	}),
};

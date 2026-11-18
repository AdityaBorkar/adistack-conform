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

export function splitDeclared(
	declared: string[],
	installed: Set<string>,
	allow: Set<string>,
): { extra: string[]; missing: string[] } {
	const declaredSet = new Set(declared);
	return {
		extra: [...installed].filter((name) => !declaredSet.has(name) && !allow.has(name)).toSorted(),
		missing: [...declaredSet].filter((name) => !installed.has(name)).toSorted(),
	};
}

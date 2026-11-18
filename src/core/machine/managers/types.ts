import type { RunCommandFix } from "#/core/result.js";

export type ManagerId = "bun" | "pacman";

// A declared requirement: version is an exact version or "latest" (unpinned).
interface PackageRef {
	name: string;
	version: string;
}

// `explicit`: user-installed names (extras are judged against these);
// `versions`: every installed package, dependencies included.
export interface InstalledPackages {
	explicit: Set<string>;
	versions: Map<string, string>;
}

// One per manager file: how to read what is installed and how to change it.
export interface PackageManager {
	install: (entry: PackageRef) => RunCommandFix;
	list: () => Promise<InstalledPackages>;
	remove: (name: string) => RunCommandFix;
}

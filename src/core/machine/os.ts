// OS detection for machine system packages: `pacman` runs only on
// Arch-based distros, `apt` only on Ubuntu/Debian-based ones. Bun globals
// are distro-agnostic and always run alongside the active system manager.

export type OsFamily = "arch" | "debian" | "unknown";

export type SystemManager = "apt" | "pacman";

// IDs that imply the family even when ID_LIKE is absent or unusual.
const ARCH_IDS = new Set([
	"arch",
	"archarm",
	"artix",
	"blackarch",
	"cachyos",
	"endeavouros",
	"garuda",
	"hyperbola",
	"manjaro",
	"parabola",
]);

const DEBIAN_IDS = new Set([
	"debian",
	"elementary",
	"kali",
	"kde-neon",
	"linuxmint",
	"mx",
	"neon",
	"pop",
	"raspbian",
	"tuxedo",
	"ubuntu",
	"zorin",
]);

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		trimmed.length >= 2 &&
		((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'")))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

// Minimal /etc/os-release parser: only ID and ID_LIKE matter here.
export function parseOsRelease(text: string): { id: string; idLike: string[] } {
	let id = "";
	let idLike: string[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) {
			continue;
		}
		const equals = trimmed.indexOf("=");
		if (equals === -1) {
			continue;
		}
		const key = trimmed.slice(0, equals).trim();
		const value = unquote(trimmed.slice(equals + 1)).toLowerCase();
		if (key === "ID") {
			id = value;
		} else if (key === "ID_LIKE") {
			idLike = value.split(/\s+/u).filter((part) => part !== "");
		}
	}
	return { id, idLike };
}

export function detectOsFamily(osReleaseText: string): OsFamily {
	const { id, idLike } = parseOsRelease(osReleaseText);
	if (ARCH_IDS.has(id) || idLike.includes("arch")) {
		return "arch";
	}
	if (DEBIAN_IDS.has(id) || idLike.includes("ubuntu") || idLike.includes("debian")) {
		return "debian";
	}
	return "unknown";
}

export function systemManagerForFamily(family: OsFamily): SystemManager | undefined {
	if (family === "arch") {
		return "pacman";
	}
	if (family === "debian") {
		return "apt";
	}
	return undefined;
}

export function systemManagerForOsRelease(osReleaseText: string): SystemManager | undefined {
	return systemManagerForFamily(detectOsFamily(osReleaseText));
}

const OS_RELEASE_PATH = "/etc/os-release";

// Reads the host's /etc/os-release; missing or unreadable means unsupported
// (non-Linux, minimal container) rather than an error.
export async function detectSystemManager(
	readFile: (path: string) => Promise<string> = (path) => Bun.file(path).text(),
): Promise<{ family: OsFamily; manager: SystemManager | undefined }> {
	let text: string;
	try {
		text = await readFile(OS_RELEASE_PATH);
	} catch {
		return { family: "unknown", manager: undefined };
	}
	const family = detectOsFamily(text);
	return { family, manager: systemManagerForFamily(family) };
}

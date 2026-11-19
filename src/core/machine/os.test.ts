import { describe, expect, test } from "bun:test";

import {
	detectOsFamily,
	detectSystemManager,
	systemManagerForFamily,
	systemManagerForOsRelease,
} from "#/core/machine/os.js";

const ARCH = `NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
`;

const MANJARO = `NAME="Manjaro Linux"
ID=manjaro
ID_LIKE=arch
`;

const UBUNTU = `PRETTY_NAME="Ubuntu 24.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
ID=ubuntu
ID_LIKE=debian
`;

const MINT = `NAME="Linux Mint"
ID=linuxmint
ID_LIKE=ubuntu
`;

const DEBIAN = `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
ID=debian
`;

const FEDORA = `NAME="Fedora Linux"
ID=fedora
ID_LIKE="rhel centos fedora"
`;

describe("detectOsFamily", () => {
	test("arch and derivatives are arch", () => {
		expect(detectOsFamily(ARCH)).toBe("arch");
		expect(detectOsFamily(MANJARO)).toBe("arch");
		expect(detectOsFamily('ID=endeavouros\nID_LIKE="arch"\n')).toBe("arch");
	});

	test("ubuntu, debian and derivatives are debian", () => {
		expect(detectOsFamily(UBUNTU)).toBe("debian");
		expect(detectOsFamily(DEBIAN)).toBe("debian");
		expect(detectOsFamily(MINT)).toBe("debian");
		expect(detectOsFamily('ID=pop\nID_LIKE="ubuntu debian"\n')).toBe("debian");
	});

	test("other distros and empty input are unknown", () => {
		expect(detectOsFamily(FEDORA)).toBe("unknown");
		expect(detectOsFamily("")).toBe("unknown");
		expect(detectOsFamily('NAME="NixOS"\nID=nixos\n')).toBe("unknown");
	});

	test("quoted and cased values parse", () => {
		expect(detectOsFamily('ID="Ubuntu"\nID_LIKE="Debian"\n')).toBe("debian");
	});
});

describe("systemManagerForFamily", () => {
	test("maps families to managers", () => {
		expect(systemManagerForFamily("arch")).toBe("pacman");
		expect(systemManagerForFamily("debian")).toBe("apt");
		expect(systemManagerForFamily("unknown")).toBeUndefined();
	});
});

describe("systemManagerForOsRelease", () => {
	test("maps release text to a manager", () => {
		expect(systemManagerForOsRelease(ARCH)).toBe("pacman");
		expect(systemManagerForOsRelease(UBUNTU)).toBe("apt");
		expect(systemManagerForOsRelease(FEDORA)).toBeUndefined();
	});
});

describe("detectSystemManager", () => {
	test("reads os-release through the injected reader", async () => {
		await expect(detectSystemManager(() => Promise.resolve(ARCH))).resolves.toEqual({
			family: "arch",
			manager: "pacman",
		});
		await expect(detectSystemManager(() => Promise.resolve(UBUNTU))).resolves.toEqual({
			family: "debian",
			manager: "apt",
		});
	});

	test("unreadable os-release means unsupported, not an error", async () => {
		const result = await detectSystemManager(() => Promise.reject(new Error("ENOENT")));
		expect(result.family).toBe("unknown");
		expect(result.manager).toBeUndefined();
	});
});

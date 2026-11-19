import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeFix, fixPreview, fixSelected, unattendedRefusal } from "#/core/fix.js";
import type { CheckResult } from "#/core/result.js";

const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
	console.log = () => {};
	console.error = () => {};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
});

function overwrite(id: string, filePath: string, newContent: string): CheckResult {
	return {
		actual: "<missing>",
		expected: newContent,
		fix: { filePath, kind: "overwrite-file", newContent },
		id,
		kind: "project",
		ok: false,
		scope: "project",
		target: "f.json",
		upstream: "tech-stack:b",
	};
}

describe("fixSelected", () => {
	test("writes a backup and dedupes identical same-file fixes", async () => {
		const filePath = join(tmpdir(), `conform-fix-${process.pid}-${Date.now()}`, "sub", "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		const fixed = await fixSelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":2}\n'),
		]);
		expect(fixed).toHaveLength(2);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
	});

	test("reports conflicting same-file fixes instead of last-wins", async () => {
		const filePath = join(tmpdir(), `conform-fix-conflict-${process.pid}-${Date.now()}`, "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		const fixed = await fixSelected([
			overwrite("project:b:one", filePath, '{"a":2}\n'),
			overwrite("project:b:two", filePath, '{"a":3}\n'),
		]);
		expect(fixed).toHaveLength(1);
		expect(await Bun.file(filePath).text()).toBe('{"a":2}\n');
	});

	test("direct file fix backs up a regular file and writes the upstream", async () => {
		const dir = join(tmpdir(), `conform-fix-file-${process.pid}-${Date.now()}`);
		const target = join(dir, ".zshrc");
		await Bun.write(target, "mine\n");
		const fix = {
			...overwrite("machine:main:file:Zshrc", target, "upstream\n"),
			target,
		};
		expect(await fixSelected([fix])).toHaveLength(1);
		expect(await Bun.file(`${target}.conform.bak`).text()).toBe("mine\n");
		expect(await Bun.file(target).text()).toBe("upstream\n");
	});

	test("direct file fix replaces a symlink without a backup", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-fix-relink-"));
		const target = join(dir, ".zshrc");
		await Bun.write(join(dir, "elsewhere"), "x\n");
		await symlink(join(dir, "elsewhere"), target);
		const fix = {
			...overwrite("machine:main:file:Zshrc", target, "up\n"),
			target,
		};
		expect(await fixSelected([fix])).toHaveLength(1);
		expect((await stat(target)).isFile()).toBe(true);
		expect(await Bun.file(target).text()).toBe("up\n");
		expect(await Bun.file(`${target}.conform.bak`).exists()).toBe(false);
	});

	test("direct file fix refuses a directory target", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-fix-filedir-"));
		const target = join(dir, "conf");
		await mkdir(target);
		const fix = { ...overwrite("machine:main:file:Conf", target, "up\n"), target };
		expect(await fixSelected([fix])).toHaveLength(0);
		expect((await stat(target)).isDirectory()).toBe(true);
	});

	test("a symlinked target is replaced without copying its target into a backup", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-fix-planted-"));
		const secret = join(dir, "id_ed25519");
		await Bun.write(secret, "SECRET\n");
		const planted = join(dir, "AGENTS.md");
		await symlink(secret, planted);
		expect(await fixSelected([overwrite("project:b:agents", planted, "# agents\n")])).toHaveLength(
			1,
		);
		expect(await Bun.file(`${planted}.conform.bak`).exists()).toBe(false);
		expect(await Bun.file(secret).text()).toBe("SECRET\n");
		expect(await Bun.file(planted).text()).toBe("# agents\n");
	});

	test("secret fixes keep a single backup instead of piling up decrypted copies", async () => {
		const filePath = join(await mkdtemp(join(tmpdir(), "conform-fix-secret-")), ".npmrc");
		const secretFix = (content: string): CheckResult => ({
			...overwrite("machine:main:secrets-template:Npmrc", filePath, content),
			fix: { filePath, kind: "overwrite-file", mode: "0600", newContent: content, secret: true },
		});
		await Bun.write(filePath, "token=1\n");
		expect(await fixSelected([secretFix("token=2\n")])).toHaveLength(1);
		expect(await fixSelected([secretFix("token=3\n")])).toHaveLength(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe("token=2\n");
		expect(await Bun.file(`${filePath}.conform.bak.1`).exists()).toBe(false);
	});

	test("second run never overwrites the first backup", async () => {
		const filePath = join(tmpdir(), `conform-fix-backup-${process.pid}-${Date.now()}`, "f.json");
		await Bun.write(filePath, '{"a":1}\n');
		expect(await fixSelected([overwrite("project:b:one", filePath, '{"a":2}\n')])).toHaveLength(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await fixSelected([overwrite("project:b:two", filePath, '{"a":3}\n')])).toHaveLength(1);
		expect(await Bun.file(`${filePath}.conform.bak`).text()).toBe('{"a":1}\n');
		expect(await Bun.file(`${filePath}.conform.bak.1`).text()).toBe('{"a":2}\n');
		expect(await Bun.file(filePath).text()).toBe('{"a":3}\n');
	});

	test("a 0600 file keeps 0600 on its backup and its rewrite", async () => {
		const filePath = join(tmpdir(), `conform-fix-mode-${process.pid}-${Date.now()}`, ".npmrc");
		await Bun.write(filePath, "token=old\n");
		await chmod(filePath, 0o600);
		const fix: CheckResult = {
			...overwrite("machine:main:secrets-template:Npmrc", filePath, "token=new\n"),
			fix: { filePath, kind: "overwrite-file", mode: "0600", newContent: "token=new\n" },
		};
		expect(await fixSelected([fix])).toHaveLength(1);
		expect((await stat(`${filePath}.conform.bak`)).mode & 0o777).toBe(0o600);
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
		expect(await Bun.file(filePath).text()).toBe("token=new\n");
	});

	test("a new file with a mode is created with that mode", async () => {
		const filePath = join(tmpdir(), `conform-fix-newmode-${process.pid}-${Date.now()}`, "f");
		const fix: CheckResult = {
			...overwrite("machine:main:secrets-template:New", filePath, "x\n"),
			fix: { filePath, kind: "overwrite-file", mode: "0600", newContent: "x\n" },
		};
		expect(await fixSelected([fix])).toHaveLength(1);
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
	});
});

function commandFix(id: string, pre: string): CheckResult {
	return {
		actual: "missing",
		expected: "installed",
		fix: {
			args: [],
			command: "true",
			kind: "run-command",
			label: "true",
			preCommands: [{ args: [], command: pre, label: pre }],
		},
		id,
		kind: "machine",
		ok: false,
		scope: "machine",
		target: "true",
	};
}

describe("run-command with preCommands", () => {
	test("setup steps run before the main command", async () => {
		expect(await fixSelected([commandFix("machine:main:apt:x", "true")])).toHaveLength(1);
	});

	test("a failing setup step aborts the main command", async () => {
		expect(await fixSelected([commandFix("machine:main:apt:x", "false")])).toHaveLength(0);
	});

	test("preview and description list every step", () => {
		const item = commandFix("machine:main:apt:x", "sudo apt-get update");
		expect(fixPreview(item)).toEqual({
			lines: ["sudo apt-get update", "true"],
			verb: "run",
		});
		expect(describeFix(item)).toBe("run sudo apt-get update && true");
	});
});

describe("unattendedRefusal", () => {
	const command: CheckResult = {
		actual: "missing",
		expected: "installed",
		fix: {
			args: ["add", "-g", "x@1"],
			command: "bun",
			kind: "run-command",
			label: "bun add -g x@1",
		},
		id: "machine:main:bun:x",
		kind: "machine",
		ok: false,
		scope: "machine",
		target: "bun:x",
	};

	test("allows file fixes inside the project", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-refuse-in-"));
		expect(
			await unattendedRefusal([overwrite("project:b:f", join(dir, "a", "f.json"), "{}")], dir),
		).toBeUndefined();
	});

	test("refuses commands and GitHub edits", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-refuse-cmd-"));
		expect(await unattendedRefusal([command], dir)).toContain("run commands");
	});

	test("refuses writes outside the project", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-refuse-out-"));
		const outside = join(tmpdir(), "elsewhere.json");
		expect(await unattendedRefusal([overwrite("project:b:f", outside, "{}")], dir)).toContain(
			"outside the project",
		);
		const outsideFile = overwrite("machine:main:file:X", join(dir, "..", "x"), "y");
		expect(await unattendedRefusal([outsideFile], dir)).toContain("outside the project");
	});

	test("refuses a write through a symlinked parent dir that leaves the project", async () => {
		const dir = await mkdtemp(join(tmpdir(), "conform-refuse-parent-"));
		const elsewhere = await mkdtemp(join(tmpdir(), "conform-refuse-elsewhere-"));
		await symlink(elsewhere, join(dir, ".github"));
		const item = overwrite("project:b:wf", join(dir, ".github", "x.yml"), "on: push\n");
		expect(await unattendedRefusal([item], dir)).toContain("outside the project");
	});
});

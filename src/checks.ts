import { execaSync } from "execa";
import equal from "fast-deep-equal";
import { outputFile } from "fs-extra";
import pointer from "json-pointer";

import type { ConformConfig } from "#/config.js";
import { resolveTargetPath } from "#/config.js";

export type CheckScope = "project" | "system";
export type FixKind = "overwrite-file" | "set-json-field";

export interface CheckFix {
	filePath: string;
	kind: FixKind;
	newContent: string;
	pointer?: string;
}

export interface CheckResult {
	actual: string;
	expected: string;
	fix?: CheckFix;
	fixable: boolean;
	hint?: string;
	id: string;
	kind: string;
	ok: boolean;
	scope: CheckScope;
	skipped?: boolean;
	source?: string;
	target: string;
}

export interface RunOptions {
	baseDir: string;
	configDir: string;
	cwd: string;
	home: string;
	only?: CheckScope;
}

function short(value: string, max = 160): string {
	const flat = value.replaceAll("\n", "\\n");
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function matchValue(
	actual: string,
	expect: string,
	match: "contains" | "exact" | "regex",
): boolean {
	if (match === "exact") {
		return actual.trim() === expect.trim();
	}
	if (match === "contains") {
		return actual.includes(expect);
	}
	try {
		return new RegExp(expect, "u").test(actual);
	} catch {
		return false;
	}
}

export function getPointer(doc: unknown, pointerStr: string): { found: boolean; value: unknown } {
	if (pointerStr === "" || pointerStr === "/") {
		return { found: true, value: doc };
	}
	try {
		if (typeof doc !== "object" || doc === null) {
			return { found: false, value: undefined };
		}
		const obj = doc as Record<string, unknown>;
		if (!pointer.has(obj, pointerStr)) {
			return { found: false, value: undefined };
		}
		return { found: true, value: pointer.get(obj, pointerStr) };
	} catch {
		return { found: false, value: undefined };
	}
}

export function setPointer(doc: unknown, pointerStr: string, value: unknown): unknown {
	if (pointerStr === "" || pointerStr === "/") {
		return value;
	}
	const root = (typeof doc === "object" && doc !== null ? doc : {}) as Record<string, unknown>;
	pointer.set(root, pointerStr, value);
	return root;
}

function runShell(command: string, cwd: string): { code: number; output: string } {
	try {
		const result = execaSync("sh", ["-c", command], { cwd, reject: false, timeout: 30_000 });
		const output = [result.stdout, result.stderr]
			.filter((part) => part !== "")
			.join("\n")
			.trim();
		return { code: result.exitCode ?? 1, output };
	} catch (error) {
		return { code: 1, output: error instanceof Error ? error.message : String(error) };
	}
}

async function checkFile(
	raw: {
		contains?: string[];
		expected?: string;
		expectedFile?: string;
		id?: string;
		mustExist?: boolean;
		path: string;
	},
	scope: CheckScope,
	options: RunOptions,
): Promise<CheckResult[]> {
	const baseDir = scope === "project" ? options.cwd : options.baseDir;
	const filePath = resolveTargetPath(raw.path, baseDir, options.home);
	const id = raw.id ?? `file:${raw.path}`;
	const mustExist = raw.mustExist ?? true;

	let golden: string | undefined;
	if (raw.expected !== undefined) {
		golden = raw.expected;
	} else if (raw.expectedFile !== undefined) {
		const goldenPath = resolveTargetPath(raw.expectedFile, options.configDir, options.home);
		const goldenFile = Bun.file(goldenPath);
		if (!(await goldenFile.exists())) {
			return [
				{
					actual: "missing golden file",
					expected: goldenPath,
					fixable: false,
					hint: `Golden file not found: ${goldenPath}`,
					id,
					kind: "file",
					ok: false,
					scope,
					target: raw.path,
				},
			];
		}
		golden = await goldenFile.text();
	}

	const file = Bun.file(filePath);
	const exists = await file.exists();
	if (!exists) {
		if (!mustExist && golden === undefined && (raw.contains ?? []).length === 0) {
			return [
				{
					actual: "missing",
					expected: "absent",
					fixable: false,
					id,
					kind: "file",
					ok: true,
					scope,
					target: raw.path,
				},
			];
		}
		if (golden !== undefined) {
			return [
				{
					actual: "<missing>",
					expected: short(golden),
					fix: { filePath, kind: "overwrite-file", newContent: golden },
					fixable: true,
					id,
					kind: "file",
					ok: false,
					scope,
					target: raw.path,
				},
			];
		}
		return [
			{
				actual: "<missing>",
				expected: mustExist ? "file exists" : "absent",
				fixable: false,
				hint: `Create ${filePath}`,
				id,
				kind: "file",
				ok: !mustExist,
				scope,
				target: raw.path,
			},
		];
	}

	const actual = await file.text();
	if (golden !== undefined && actual !== golden) {
		return [
			{
				actual: short(actual),
				expected: short(golden),
				fix: { filePath, kind: "overwrite-file", newContent: golden },
				fixable: true,
				id,
				kind: "file",
				ok: false,
				scope,
				target: raw.path,
			},
		];
	}

	const missing = (raw.contains ?? []).filter((needle) => !actual.includes(needle));
	if (missing.length > 0) {
		return [
			{
				actual: `missing ${missing.length} snippet(s): ${short(missing.join(" | "))}`,
				expected: short(missing.join(" | ")),
				fixable: false,
				hint: golden === undefined ? `Add the snippet(s) to ${filePath}` : undefined,
				id,
				kind: "file",
				ok: false,
				scope,
				target: raw.path,
			},
		];
	}

	return [
		{
			actual: "ok",
			expected: golden === undefined ? "file exists" : short(golden),
			fixable: false,
			id,
			kind: "file",
			ok: true,
			scope,
			target: raw.path,
		},
	];
}

async function checkJsonField(
	raw: { expect: unknown; fix: "report" | "set"; id?: string; path: string; pointer: string },
	scope: CheckScope,
	options: RunOptions,
): Promise<CheckResult[]> {
	const baseDir = scope === "project" ? options.cwd : options.baseDir;
	const filePath = resolveTargetPath(raw.path, baseDir, options.home);
	const id = raw.id ?? `json:${raw.path}#${raw.pointer}`;
	const expected = JSON.stringify(raw.expect) ?? "undefined";
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		if (raw.fix === "set") {
			const fresh = setPointer({}, raw.pointer, raw.expect);
			const newContent = `${JSON.stringify(fresh, null, 2)}\n`;
			return [
				{
					actual: "<missing file>",
					expected,
					fix: { filePath, kind: "set-json-field", newContent, pointer: raw.pointer },
					fixable: true,
					id,
					kind: "json",
					ok: false,
					scope,
					target: `${raw.path}#${raw.pointer}`,
				},
			];
		}
		return [
			{
				actual: "<missing file>",
				expected,
				fixable: false,
				hint: `Create ${filePath}`,
				id,
				kind: "json",
				ok: false,
				scope,
				target: `${raw.path}#${raw.pointer}`,
			},
		];
	}
	let doc: unknown;
	try {
		doc = await file.json();
	} catch {
		return [
			{
				actual: "<invalid json>",
				expected,
				fixable: false,
				hint: `Fix JSON syntax in ${filePath}`,
				id,
				kind: "json",
				ok: false,
				scope,
				target: `${raw.path}#${raw.pointer}`,
			},
		];
	}
	const found = getPointer(doc, raw.pointer);
	const actual = JSON.stringify(found.value) ?? "undefined";
	if (!found.found || !equal(found.value, raw.expect)) {
		if (raw.fix === "set") {
			const next = setPointer(structuredClone(doc), raw.pointer, raw.expect);
			const newContent = `${JSON.stringify(next, null, 2)}\n`;
			return [
				{
					actual: found.found ? actual : "<missing>",
					expected,
					fix: { filePath, kind: "set-json-field", newContent, pointer: raw.pointer },
					fixable: true,
					id,
					kind: "json",
					ok: false,
					scope,
					target: `${raw.path}#${raw.pointer}`,
				},
			];
		}
		return [
			{
				actual: found.found ? actual : "<missing>",
				expected,
				fixable: false,
				id,
				kind: "json",
				ok: false,
				scope,
				target: `${raw.path}#${raw.pointer}`,
			},
		];
	}
	return [
		{
			actual,
			expected,
			fixable: false,
			id,
			kind: "json",
			ok: true,
			scope,
			target: `${raw.path}#${raw.pointer}`,
		},
	];
}

export async function runChecks(
	config: ConformConfig,
	options: RunOptions,
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	const scopes: CheckScope[] = options.only === undefined ? ["project", "system"] : [options.only];

	if (scopes.includes("project")) {
		const fileGroups = await Promise.all(
			config.project.files.map((item) => checkFile(item, "project", options)),
		);
		for (const group of fileGroups) {
			results.push(...group);
		}
		const jsonGroups = await Promise.all(
			config.project.json.map((item) => checkJsonField(item, "project", options)),
		);
		for (const group of jsonGroups) {
			results.push(...group);
		}
		for (const item of config.project.commands) {
			const run = runShell(item.run, options.cwd);
			const ok = run.code === 0 && matchValue(run.output, item.expect, item.match);
			results.push({
				actual:
					run.code === 0
						? short(run.output || "<empty>")
						: short(`exit ${run.code}: ${run.output}`),
				expected: `${item.match}:${short(item.expect)}`,
				fixable: false,
				hint: item.fixHint,
				id: item.id,
				kind: "command",
				ok,
				scope: "project",
				target: item.run,
			});
		}
	}

	if (scopes.includes("system")) {
		const systemFileGroups = await Promise.all(
			config.system.files.map((item) =>
				checkFile(item, "system", { ...options, baseDir: options.home }),
			),
		);
		for (const group of systemFileGroups) {
			results.push(...group);
		}
		for (const item of config.system.binaries) {
			const id = item.id ?? `bin:${item.bin}`;
			const command = [item.bin, ...item.args].join(" ");
			const run = runShell(command, options.cwd);
			const ok = run.code === 0 && matchValue(run.output, item.expect, item.match);
			results.push({
				actual:
					run.code === 0
						? short(run.output || "<empty>")
						: short(`exit ${run.code}: ${run.output}`),
				expected: `${item.match}:${short(item.expect)}`,
				fixable: false,
				hint: item.fixHint ?? `Install or upgrade ${item.bin} to match ${item.expect}`,
				id,
				kind: "binary",
				ok,
				scope: "system",
				target: command,
			});
		}
		for (const item of config.system.env) {
			const value = process.env[item.name];
			if (value === undefined) {
				results.push({
					actual: "<unset>",
					expected: item.mustExist ? (item.expect ?? "set") : "absent",
					fixable: false,
					hint: item.fixHint ?? `export ${item.name}=...`,
					id: `env:${item.name}`,
					kind: "env",
					ok: !item.mustExist,
					scope: "system",
					target: item.name,
				});
				continue;
			}
			if (item.expect !== undefined && !matchValue(value, item.expect, item.match)) {
				results.push({
					actual: short(value),
					expected: `${item.match}:${short(item.expect)}`,
					fixable: false,
					hint: item.fixHint ?? `export ${item.name}=${item.expect}`,
					id: `env:${item.name}`,
					kind: "env",
					ok: false,
					scope: "system",
					target: item.name,
				});
				continue;
			}
			results.push({
				actual: short(value),
				expected: item.expect === undefined ? "set" : `${item.match}:${short(item.expect)}`,
				fixable: false,
				id: `env:${item.name}`,
				kind: "env",
				ok: true,
				scope: "system",
				target: item.name,
			});
		}
	}

	return results;
}

export async function readActualContent(result: CheckResult): Promise<string> {
	if (result.fix?.kind === "overwrite-file") {
		const file = Bun.file(result.fix.filePath);
		if (!(await file.exists())) {
			return "<missing>";
		}
		return file.text();
	}
	if (result.fix?.kind === "set-json-field") {
		const file = Bun.file(result.fix.filePath);
		if (!(await file.exists())) {
			return "<missing file>";
		}
		return file.text();
	}
	return result.actual;
}

export function desiredContent(result: CheckResult): string {
	return result.fix?.newContent ?? result.expected;
}

export async function applyFix(result: CheckResult): Promise<void> {
	if (!result.fix) {
		throw new Error(`Check ${result.id} is not fixable.`);
	}
	await outputFile(result.fix.filePath, result.fix.newContent);
}

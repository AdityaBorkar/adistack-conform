import { writeFileEnsuringDir } from "#/utils/fs.js";

export type CheckScope = "project" | "machine" | "github";

export interface OverwriteFileFix {
	filePath: string;
	kind: "overwrite-file";
	newContent: string;
}

export interface RunCommandFix {
	args: string[];
	command: string;
	kind: "run-command";
	label: string;
}

export interface GithubApiStep {
	body?: unknown;
	method: "DELETE" | "PATCH" | "POST" | "PUT";
	path: string;
}

export interface GithubApiFix {
	kind: "github-api";
	label: string;
	steps: GithubApiStep[];
}

export type CheckFix = OverwriteFileFix | RunCommandFix | GithubApiFix;

export interface CheckResult {
	actual: string;
	expected: string;
	fix?: CheckFix;
	hint?: string;
	id: string;
	kind: string;
	ok: boolean;
	scope: CheckScope;
	skipped?: boolean;
	source?: string;
	target: string;
}

export type CheckBase = Pick<CheckResult, "id" | "kind" | "scope" | "source" | "target">;

export function isFixable(result: CheckResult): boolean {
	return result.fix !== undefined;
}

export function pass(base: CheckBase, actual: string, expected: string): CheckResult {
	return { actual, expected, ok: true, ...base };
}

export function skipped(base: CheckBase, expected: string, reason: string): CheckResult {
	return { actual: reason, expected, ok: true, skipped: true, ...base };
}

export function failFixable(
	base: CheckBase,
	actual: string,
	expected: string,
	fix: CheckFix,
): CheckResult {
	return { actual, expected, fix, ok: false, ...base };
}

export function failManual(
	base: CheckBase,
	actual: string,
	expected: string,
	hint: string,
): CheckResult {
	return { actual, expected, hint, ok: false, ...base };
}

export function partitionResults(results: CheckResult[]): {
	failed: CheckResult[];
	fixable: CheckResult[];
	manual: CheckResult[];
} {
	const failed = results.filter((item) => !item.ok);
	return {
		failed,
		fixable: failed.filter((item) => isFixable(item)),
		manual: failed.filter((item) => !isFixable(item)),
	};
}

export function desiredContent(result: CheckResult): string {
	if (result.fix?.kind === "run-command" || result.fix?.kind === "github-api") {
		return result.fix.label;
	}
	return result.fix?.newContent ?? result.expected;
}

export function describeFix(result: CheckResult): string {
	const fix = result.fix;
	if (fix === undefined) {
		return "manual";
	}
	if (fix.kind === "overwrite-file") {
		return `overwrite ${fix.filePath}`;
	}
	if (fix.kind === "github-api") {
		return `api ${fix.label}`;
	}
	return `run ${fix.command} ${fix.args.join(" ")}`.trim();
}

export async function applyFix(result: CheckResult): Promise<void> {
	if (!result.fix) {
		throw new Error(`Result ${result.id} is not fixable.`);
	}
	if (result.fix.kind === "github-api") {
		const { applyGithubApiFix } = await import("#/stack/github");
		await applyGithubApiFix(result.fix);
		return;
	}
	if (result.fix.kind === "overwrite-file") {
		await writeFileEnsuringDir(result.fix.filePath, result.fix.newContent);
		return;
	}
	const proc = Bun.spawn([result.fix.command, ...result.fix.args], {
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`Command failed with exit code ${code}: ${result.fix.label}`);
	}
}

import type { CheckBase, CheckResult } from "#/checks.js";
import { failFixable, failManual, pass } from "#/checks.js";
import type { MachineRunSpec } from "#/config.js";
import { findMachineEntry, machineNotFoundError, manifestDirRel } from "#/stack/registry.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { errorMessage } from "#/utils/fs.js";
import { encodePathSegments } from "#/utils/net.js";

const SWITCH_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_CHARS = 4000;
const OUTPUT_TAIL_LINES = 30;

function nixCheckId(blueprint: string): string {
	return `nix:${blueprint}`;
}

function encodeDir(dirRel: string): string {
	return encodePathSegments(
		dirRel
			.split("/")
			.filter((segment) => segment !== "")
			.join("/"),
	);
}

// Let nix fetch the flake itself instead of materializing the whole
// tech-stack repo locally: one registry fetch resolves the flake
// subdirectory, then nix uses its own store (no custom download/cache).
function flakeUrl(spec: MachineRunSpec, dirRel: string): string {
	const base = `git+https://github.com/${spec.id}?ref=${encodeURIComponent(spec.ref)}&dir=${encodeDir(dirRel)}`;
	if (spec.configuration === undefined || spec.configuration === "") {
		return base;
	}
	return `${base}#${encodeURIComponent(spec.configuration)}`;
}

function tail(text: string): string {
	const kept = text.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");
	return kept.length > OUTPUT_TAIL_CHARS ? `…${kept.slice(-OUTPUT_TAIL_CHARS)}` : kept;
}

// A failing dry-run that prints a nix eval error never computed a new generation,
// so a real switch fails the same way: report it as manual instead of
// offering it as a fix. Anything else is a drift plan and stays fixable.
const NON_DRIFT_PATTERN = /does not provide attribute|is not set\. Run with/iu;
const BUILD_FAILED_PATTERN = /cannot build|builder failed/iu;

function notDriftHint(detail: string, label: string): string {
	if (/does not provide attribute/iu.test(detail)) {
		return `Flake has no such homeConfiguration; fix machine.configuration (omit it for $USER auto-select) or run manually: ${label}`;
	}
	if (/is not set\. Run with/iu.test(detail)) {
		return `Flake needs env the check lacks (e.g. GIT_NAME/GIT_EMAIL) or the network failed; export it / retry, or run manually: ${label}`;
	}
	return `Flake evaluation or build failed (not drift); resolve the error or run manually: ${label}`;
}

function switchInvocation(
	flake: string,
	dryRun: boolean,
): { args: string[]; command: string; label: string } {
	// The machine flake reads $USER/GIT_NAME/GIT_EMAIL via getEnv, so evaluation needs --impure.
	const args = ["switch", "--flake", flake, ...(dryRun ? ["--dry-run"] : []), "--impure"];
	const label = `home-manager ${args.join(" ")}`;
	const hm = Bun.which("home-manager");
	if (hm !== null) {
		return { args, command: hm, label };
	}
	return {
		args: ["run", "home-manager", "--", ...args],
		command: "nix",
		label: `nix run home-manager -- ${args.join(" ")}`,
	};
}

async function runCapture(
	command: string,
	args: string[],
	timeoutMs: number,
): Promise<{ code: number; stderr: string; stdout: string }> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([command, ...args], { stderr: "pipe", stdin: "ignore", stdout: "pipe" });
	} catch (error) {
		throw new Error(`Cannot run ${command}: ${errorMessage(error)}`, { cause: error });
	}
	const stdoutStream = proc.stdout;
	const stderrStream = proc.stderr;
	if (!(stdoutStream instanceof ReadableStream) || !(stderrStream instanceof ReadableStream)) {
		throw new TypeError(`Cannot capture output of ${command}.`);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const done = (async () => {
			const [stdout, stderr, code] = await Promise.all([
				new Response(stdoutStream).text(),
				new Response(stderrStream).text(),
				proc.exited,
			]);
			return { code, stderr, stdout };
		})();
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				try {
					proc.kill();
				} catch {
					// Already exited; the race below settles on `done`.
				}
				void done.catch(() => {});
				reject(
					new Error(
						`Timed out after ${Math.round(timeoutMs / 1000)}s: ${command} ${args.join(" ")}`,
					),
				);
			}, timeoutMs);
		});
		return await Promise.race([done, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export async function runMachineChecks(
	spec: MachineRunSpec,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	const entry = findMachineEntry(spec.blueprint, registry);
	if (entry === undefined) {
		throw machineNotFoundError(spec.blueprint, registry);
	}
	const dirRel = manifestDirRel(entry.path);
	if (dirRel === "") {
		throw new Error(`Machine blueprint "${spec.blueprint}" has an empty path in the registry.`);
	}
	const flake = flakeUrl(spec, dirRel);
	const base: CheckBase = {
		id: nixCheckId(spec.blueprint),
		kind: "nix",
		scope: "machine",
		source: `tech-stack:${spec.blueprint}`,
		target: flake,
	};
	const expected = "home-manager switch --dry-run --impure clean";
	const check = switchInvocation(flake, true);
	let output: { code: number; stderr: string; stdout: string };
	try {
		output = await runCapture(check.command, check.args, SWITCH_TIMEOUT_MS);
	} catch (error) {
		return [
			failManual(base, "<unavailable>", expected, `Cannot run drift check: ${errorMessage(error)}`),
		];
	}
	if (output.code === 0) {
		return [pass(base, expected, expected)];
	}
	const detail = tail(`${output.stdout}\n${output.stderr}`.trim());
	if (NON_DRIFT_PATTERN.test(detail) || BUILD_FAILED_PATTERN.test(detail)) {
		return [failManual(base, detail, expected, notDriftHint(detail, check.label))];
	}
	const apply = switchInvocation(flake, false);
	const result = failFixable(base, detail === "" ? "<drift detected>" : detail, expected, {
		args: apply.args,
		command: apply.command,
		kind: "run-command",
		label: apply.label,
	});
	result.hint = `Apply with \`fix\` or run manually: ${apply.label}`;
	return [result];
}

export function recheckMachineSelected(
	spec: MachineRunSpec,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	if (!selectedIds.has(nixCheckId(spec.blueprint))) {
		return Promise.resolve([]);
	}
	return runMachineChecks(spec, registry);
}

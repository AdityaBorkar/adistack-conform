import { findMachineEntry, machineNotFoundError, blueprintDirRel } from "#/stack/registry.js";
import type { RegistryDocument } from "#/stack/registry.js";
import type { MachineRunState } from "#/utils/config.js";
import { errorMessage } from "#/utils/fs.js";
import { encodePathSegments } from "#/utils/net.js";
import type { CheckBase, CheckResult } from "#/utils/result.js";
import { failFixable, failManual, pass } from "#/utils/result.js";

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
function flakeUrl(state: MachineRunState, dirRel: string): string {
	const base = `git+https://github.com/${state.id}?ref=${encodeURIComponent(state.ref)}&dir=${encodeDir(dirRel)}`;
	if (state.configuration === undefined || state.configuration === "") {
		return base;
	}
	return `${base}#${encodeURIComponent(state.configuration)}`;
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
	state: MachineRunState,
	registry: RegistryDocument,
): Promise<CheckResult[]> {
	const entry = findMachineEntry(state.blueprint, registry);
	if (entry === undefined) {
		throw machineNotFoundError(state.blueprint, registry);
	}
	const dirRel = blueprintDirRel(entry.path);
	if (dirRel === "") {
		throw new Error(`Machine blueprint "${state.blueprint}" has an empty path in the registry.`);
	}
	const flake = flakeUrl(state, dirRel);
	const base: CheckBase = {
		id: nixCheckId(state.blueprint),
		kind: "nix",
		scope: "machine",
		source: `tech-stack:${state.blueprint}`,
		target: flake,
	};
	const expected = "home-manager switch --dry-run --impure clean";
	const dryRun = switchInvocation(flake, true);
	let output: { code: number; stderr: string; stdout: string };
	try {
		output = await runCapture(dryRun.command, dryRun.args, SWITCH_TIMEOUT_MS);
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
		return [failManual(base, detail, expected, notDriftHint(detail, dryRun.label))];
	}
	const fixRun = switchInvocation(flake, false);
	const result = failFixable(base, detail === "" ? "<drift detected>" : detail, expected, {
		args: fixRun.args,
		command: fixRun.command,
		kind: "run-command",
		label: fixRun.label,
	});
	result.hint = `Apply with \`fix\` or run manually: ${fixRun.label}`;
	return [result];
}

export function recheckMachineSelected(
	state: MachineRunState,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	if (!selectedIds.has(nixCheckId(state.blueprint))) {
		return Promise.resolve([]);
	}
	return runMachineChecks(state, registry);
}

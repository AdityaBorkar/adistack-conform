import type { CheckBase, CheckResult } from "#/checks.js";
import { failFixable, failManual, pass } from "#/checks.js";
import type { MachineRunSpec } from "#/config.js";
import { findMachineEntry, machineNotFoundError } from "#/stack/registry.js";
import { machineDirCandidates } from "#/stack/registry.js";
import type { RegistryDocument } from "#/stack/registry.js";
import { fetchTextOrThrow, rawUrl } from "#/stack/remote.js";
import { errorMessage } from "#/utils/fs.js";

const SWITCH_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_CHARS = 4000;
const OUTPUT_TAIL_LINES = 30;

function nixCheckId(blueprint: string): string {
	return `nix:${blueprint}`;
}

function encodeDir(dirRel: string): string {
	return dirRel
		.split("/")
		.filter((segment) => segment !== "")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
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

async function resolveFlakeDir(spec: MachineRunSpec, entryPath: string): Promise<string> {
	const candidates = machineDirCandidates(entryPath);
	const primary = candidates[0];
	if (primary === undefined) {
		throw new Error(`Machine blueprint "${spec.blueprint}" has an empty path in the registry.`);
	}
	if (candidates.length === 1) {
		return primary;
	}
	const checks = await Promise.all(
		candidates.map(async (dir) => {
			try {
				await fetchTextOrThrow(rawUrl(spec.id, spec.ref, `${dir}/flake.nix`), "flake.nix");
				return true;
			} catch {
				return false;
			}
		}),
	);
	const hit = candidates.find((_dir, index) => checks[index] === true);
	if (hit !== undefined) {
		return hit;
	}
	throw new Error(
		`Machine blueprint "${spec.blueprint}" is not a nix flake (missing flake.nix in ${primary}).`,
	);
}
function tail(text: string): string {
	const kept = text.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");
	return kept.length > OUTPUT_TAIL_CHARS ? `…${kept.slice(-OUTPUT_TAIL_CHARS)}` : kept;
}

// A failing dry-run that prints a nix error never computed a new generation,
// so a real switch fails the same way: report it as manual instead of
// offering it as a fix. Anything else is a drift plan (or transient output)
// and stays fixable. (Nix indents nested errors, so match without ^.)
const NOT_DRIFT_PATTERN =
	/does not provide attribute|is not set\. Run with|cannot build|builder failed/iu;

function notDriftHint(detail: string, label: string): string {
	if (/does not provide attribute/u.test(detail)) {
		return `Flake has no such homeConfiguration; fix machine.configuration (omit it for $USER auto-select) or run manually: ${label}`;
	}
	if (/is not set\. Run with/u.test(detail)) {
		return `Flake needs env the check lacks; export it (e.g. GIT_NAME/GIT_EMAIL) or run manually: ${label}`;
	}
	return `Flake evaluation failed (not drift); resolve the error or run manually: ${label}`;
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
	const flake = flakeUrl(spec, await resolveFlakeDir(spec, entry.path));
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
	if (NOT_DRIFT_PATTERN.test(detail)) {
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

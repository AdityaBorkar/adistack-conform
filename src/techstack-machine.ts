import type { CheckBase, CheckResult } from "#/checks.js";
import { failFixable, failManual, pass } from "#/checks.js";
import type { MachineRunSpec } from "#/config.js";
import { ensureGithubRepo } from "#/techstack-cache.js";
import { loadMachineBlueprint, loadRegistryDocument } from "#/techstack-registry.js";
import type { TechCheckOutput, TechStackRunOptions } from "#/techstack.js";
import { errorMessage } from "#/utils/fs.js";

const SWITCH_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_CHARS = 4000;
const OUTPUT_TAIL_LINES = 30;

function nixCheckId(blueprint: string): string {
	return `nix:${blueprint}`;
}

function flakeRef(dir: string, configuration: string | undefined): string {
	if (configuration === undefined || configuration === "") {
		return dir;
	}
	return `${dir}#${configuration}`;
}

function tail(text: string): string {
	const kept = text.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");
	return kept.length > OUTPUT_TAIL_CHARS ? `…${kept.slice(-OUTPUT_TAIL_CHARS)}` : kept;
}

function switchInvocation(
	flake: string,
	dryRun: boolean,
): { args: string[]; command: string; label: string } {
	const args = ["switch", "--flake", flake, ...(dryRun ? ["--dry-run"] : [])];
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
	options: TechStackRunOptions,
): Promise<TechCheckOutput> {
	const cached = await ensureGithubRepo(spec, options.noCache);
	const warnings: string[] = [];
	if (cached.stale && cached.warning !== undefined) {
		warnings.push(`Warning: using cached tech-stack ${spec.id}@${spec.ref} (${cached.warning})`);
	}
	const registryDoc = await loadRegistryDocument(cached.dir);
	const { dir } = await loadMachineBlueprint(cached.dir, spec.blueprint, registryDoc);
	const flake = flakeRef(dir, spec.configuration);
	const base: CheckBase = {
		id: nixCheckId(spec.blueprint),
		kind: "nix",
		scope: "machine",
		source: `tech-stack:${spec.blueprint}`,
		target: flake,
	};
	const expected = "home-manager switch --dry-run clean";
	const check = switchInvocation(flake, true);
	let output: { code: number; stderr: string; stdout: string };
	try {
		output = await runCapture(check.command, check.args, SWITCH_TIMEOUT_MS);
	} catch (error) {
		return {
			results: [
				failManual(
					base,
					"<unavailable>",
					expected,
					`Cannot run drift check: ${errorMessage(error)}`,
				),
			],
			warnings,
		};
	}
	if (output.code === 0) {
		return { results: [pass(base, expected, expected)], warnings };
	}
	const detail = tail(`${output.stdout}\n${output.stderr}`.trim());
	const apply = switchInvocation(flake, false);
	const result = failFixable(base, detail === "" ? "<drift detected>" : detail, expected, {
		args: apply.args,
		command: apply.command,
		kind: "run-command",
		label: apply.label,
	});
	result.hint = `Apply with \`fix\` or run manually: ${apply.label}`;
	return { results: [result], warnings };
}

export async function recheckMachineSelected(
	spec: MachineRunSpec,
	options: TechStackRunOptions,
	selectedIds: ReadonlySet<string>,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return [];
	}
	if (!selectedIds.has(nixCheckId(spec.blueprint))) {
		return [];
	}
	return (await runMachineChecks(spec, options)).results;
}

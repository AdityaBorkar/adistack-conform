import { errorMessage } from "#/utils/error.js";

// Read-only probes (package lists, sops decrypt) must never hang a check.
const CAPTURE_TIMEOUT_MS = 60_000;

interface Killable {
	exited: Promise<number>;
	kill: (signal?: number) => void;
}

// SIGTERM at the deadline, SIGKILL 5s later; a timeout throws instead of returning a code.
async function exitCodeWithin(proc: Killable, timeoutMs: number, label: string): Promise<number> {
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			proc.kill();
			setTimeout(() => {
				try {
					proc.kill(9);
				} catch {
					// Already exited.
				}
			}, 5000).unref?.();
		} catch {
			// Already exited; the await below settles first.
		}
	}, timeoutMs);
	let code: number;
	try {
		code = await proc.exited;
	} finally {
		clearTimeout(timer);
	}
	if (timedOut) {
		throw new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${label}`);
	}
	return code;
}

function readStream(stream: unknown, label: string): Promise<string> {
	if (!(stream instanceof ReadableStream)) {
		return Promise.reject(new TypeError(`Cannot capture output of ${label}.`));
	}
	return new Response(stream).text();
}

// Interactive command (stdio inherited); non-zero exits and timeouts throw.
export async function runCommand(argv: string[], label: string, timeoutMs: number): Promise<void> {
	const proc = Bun.spawn(argv, { stderr: "inherit", stdin: "inherit", stdout: "inherit" });
	const code = await exitCodeWithin(proc, timeoutMs, label);
	if (code !== 0) {
		throw new Error(`Command failed with exit code ${code}: ${label}`);
	}
}

// Read-only command: returns stdout. Spawn errors, non-zero exits and timeouts
// throw with stderr only, so a failing secrets decrypt never echoes stdout.
export async function captureCommand(
	argv: string[],
	timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<string> {
	const label = argv.join(" ");
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" });
	} catch (error) {
		throw new Error(`Cannot run ${label}: ${errorMessage(error)}`, { cause: error });
	}
	const [stdout, stderr, code] = await Promise.all([
		readStream(proc.stdout, label),
		readStream(proc.stderr, label),
		exitCodeWithin(proc, timeoutMs, label),
	]);
	if (code !== 0) {
		const detail = stderr.trim();
		throw new Error(`Command failed (${label}): ${detail === "" ? `exit ${code}` : detail}`);
	}
	return stdout;
}

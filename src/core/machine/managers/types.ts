import { errorMessage } from "#/utils/error.js";

export type ManagerId = "bun" | "pacman";

// A declared requirement: version is an exact version or "latest" (unpinned).
export interface PackageRef {
	name: string;
	version: string;
}

// `explicit`: user-installed names (extras are judged against these);
// `versions`: every installed package, dependencies included.
export interface InstalledPackages {
	explicit: Set<string>;
	versions: Map<string, string>;
}

function readStream(stream: unknown, command: string): Promise<string> {
	if (!(stream instanceof ReadableStream)) {
		return Promise.reject(new TypeError(`Cannot capture output of ${command}.`));
	}
	return new Response(stream).text();
}

// Runs a read-only command and returns its stdout; spawn errors and non-zero
// exits throw so callers can map them to manual results.
export async function captureCommand(argv: string[]): Promise<string> {
	const label = argv.join(" ");
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" });
	} catch (error) {
		throw new Error(`Cannot run ${label}: ${errorMessage(error)}`, { cause: error });
	}
	const [stdout, stderr, code] = await Promise.all([
		readStream(proc.stdout, argv[0] ?? "command"),
		readStream(proc.stderr, argv[0] ?? "command"),
		proc.exited,
	]);
	if (code !== 0) {
		const detail = `${stdout}\n${stderr}`.trim();
		throw new Error(`Command failed (${label}): ${detail === "" ? `exit ${code}` : detail}`);
	}
	return stdout;
}

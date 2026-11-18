import { errorMessage } from "#/utils/error.js";

export type ManagerId = "bun" | "pacman";

// A declared requirement: version is an exact version or "latest" (unpinned).
export interface PackageRef {
	name: string;
	version: string;
}

export interface InstalledPackages {
	explicit: Set<string>;
	versions: Map<string, string>;
}

export interface PackageManager {
	id: ManagerId;
	install(entries: PackageRef[]): Promise<void>;
	list(): Promise<InstalledPackages>;
	remove(names: string[]): Promise<void>;
}

export interface Runner {
	capture(argv: string[]): Promise<string>;
	run(argv: string[]): Promise<void>;
}

function readStream(stream: unknown, command: string): Promise<string> {
	if (!(stream instanceof ReadableStream)) {
		return Promise.reject(new TypeError(`Cannot capture output of ${command}.`));
	}
	return new Response(stream).text();
}

function label(argv: string[]): string {
	return argv.join(" ");
}

// Default runner shells out via Bun.spawn. Spawn errors throw with
// errorMessage so callers can map them to manual results.
export const defaultRunner: Runner = {
	async capture(argv: string[]): Promise<string> {
		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" });
		} catch (error) {
			throw new Error(`Cannot run ${label(argv)}: ${errorMessage(error)}`, { cause: error });
		}
		const [stdout, stderr, code] = await Promise.all([
			readStream(proc.stdout, argv[0] ?? "command"),
			readStream(proc.stderr, argv[0] ?? "command"),
			proc.exited,
		]);
		if (code !== 0) {
			const detail = `${stdout}\n${stderr}`.trim();
			throw new Error(
				`Command failed (${label(argv)}): ${detail === "" ? `exit ${code}` : detail}`,
			);
		}
		return stdout;
	},
	async run(argv: string[]): Promise<void> {
		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(argv, { stderr: "inherit", stdin: "inherit", stdout: "inherit" });
		} catch (error) {
			throw new Error(`Cannot run ${label(argv)}: ${errorMessage(error)}`, { cause: error });
		}
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(`Command failed (${label(argv)}): exit ${code}`);
		}
	},
};

import { parseBunGlobalVersions } from "#/stack/managers/parse.js";
import { defaultRunner } from "#/stack/managers/types.js";
import type {
	InstalledPackages,
	PackageManager,
	PackageRef,
	Runner,
} from "#/stack/managers/types.js";

export function createBunManager(runner: Runner = defaultRunner): PackageManager {
	return {
		id: "bun",
		async install(entries: PackageRef[]): Promise<void> {
			if (entries.length === 0) {
				return;
			}
			await runner.run([
				"bun",
				"add",
				"-g",
				...entries.map((entry) => `${entry.name}@${entry.version}`),
			]);
		},
		async list(): Promise<InstalledPackages> {
			const versions = parseBunGlobalVersions(await runner.capture(["bun", "pm", "-g", "ls"]));
			return { explicit: new Set(versions.keys()), versions };
		},
		async remove(names: string[]): Promise<void> {
			if (names.length === 0) {
				return;
			}
			await runner.run(["bun", "remove", "-g", ...names]);
		},
	};
}

export const bunManager: PackageManager = createBunManager();

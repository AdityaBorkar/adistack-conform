import type { ScopeCheck } from "#/core/config.js";
import { checkFiles } from "#/core/machine/files.js";
import { defaultLive } from "#/core/machine/live.js";
import type { MachineLive } from "#/core/machine/live.js";
import { activeManagers, evaluatePackages, listInstalled } from "#/core/machine/packages.js";
import { systemWarning } from "#/core/machine/packages.js";
import { checkSecretsTemplates } from "#/core/machine/templates.js";
import type { CheckResult } from "#/core/result.js";
import { checkBase, failManual } from "#/core/result.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { isSecretsTemplate } from "#/schemas/machine-manifest.js";
import { errorMessage } from "#/utils/error.js";
import { resolveTargetPath } from "#/utils/fs.js";

export type { MachineLive } from "#/core/machine/live.js";

export interface MachineCheckInput {
	blueprint: string;
	home: string;
	live: MachineLive;
	manifest: MachineManifest;
	skipSecrets: boolean;
	strict: boolean;
}

// A domain that cannot run at all yields one manual result instead of its items.
async function guard(
	blueprint: string,
	domain: string,
	run: () => Promise<CheckResult[]>,
): Promise<CheckResult[]> {
	try {
		return await run();
	} catch (error) {
		return [
			failManual(
				checkBase("machine", blueprint, domain, domain),
				"<unavailable>",
				`${domain} checks complete`,
				`Cannot run ${domain} checks: ${errorMessage(error)}`,
			),
		];
	}
}

// Extras are skipped unless the run is strict; files and secrets templates ignore strictness.
// Targets resolve against $HOME (a leading ~ expands, relative paths anchor at home).
// Only the distro's system manager runs alongside bun; on unsupported
// distros a skipped warning replaces the system packages.
export async function checkMachine(input: MachineCheckInput): Promise<CheckResult[]> {
	const { blueprint, home, live, manifest, skipSecrets, strict } = input;
	// Per-run copies (oxc/no-map-spread bans spreading inside map).
	const files = manifest.files.map((file) => ({
		mode: file.mode,
		name: file.name,
		secrets: file.secrets,
		source: file.source,
		target: resolveTargetPath(file.target, home, home),
	}));
	const [packages, fileResults, templates] = await Promise.all([
		guard(blueprint, "packages", async () => {
			const systemManager = await live.detectSystemManager();
			const managers = activeManagers(systemManager);
			const results = evaluatePackages({
				allowlist: manifest.allowlist,
				blueprint,
				declared: manifest.packages,
				installed: await listInstalled(live.listPackages, managers),
				strict,
				systemManager,
			});
			return systemManager === undefined ? [systemWarning(blueprint), ...results] : results;
		}),
		guard(blueprint, "files", () =>
			checkFiles({
				blueprint,
				fetch: live.fetchSource,
				files: files.filter((file) => !isSecretsTemplate(file)),
				stat: live.statFile,
			}),
		),
		guard(blueprint, "secrets-templates", () =>
			checkSecretsTemplates({
				blueprint,
				decryptSecrets: live.decryptSecrets,
				fetchSource: live.fetchText,
				readTarget: live.readSecretsTemplateTarget,
				skipSecrets,
				templates: files.filter((file) => isSecretsTemplate(file)),
			}),
		),
	]);
	return [...packages, ...fileResults, ...templates];
}

// Re-checks whole: listing packages and stats takes a few seconds (ADR 0011).
export const runMachine: ScopeCheck = async ({ home, skipSecrets, state, strict, techStack }) => {
	const { data: manifest, rel } = await techStack.blueprint("machines", state.blueprint);
	return checkMachine({
		blueprint: state.blueprint,
		home,
		live: defaultLive(techStack, rel),
		manifest,
		skipSecrets: skipSecrets === true,
		strict,
	});
};

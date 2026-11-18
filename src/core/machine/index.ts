import type { ScopeCheck } from "#/core/config.js";
import { checkLinks } from "#/core/machine/links.js";
import { defaultLive } from "#/core/machine/live.js";
import type { MachineLive } from "#/core/machine/live.js";
import { evaluatePackages, listInstalled } from "#/core/machine/packages.js";
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

// Extras are skipped unless the run is strict; links and secrets templates ignore strictness.
// Targets resolve against $HOME (a leading ~ expands, relative paths anchor at home).
export async function checkMachine(input: MachineCheckInput): Promise<CheckResult[]> {
	const { blueprint, home, live, manifest, strict } = input;
	// Per-run copies (oxc/no-map-spread bans spreading inside map).
	const files = manifest.files.map((file) => ({
		mode: file.mode,
		name: file.name,
		secrets: file.secrets,
		source: file.source,
		target: resolveTargetPath(file.target, home, home),
	}));
	const [packages, links, templates] = await Promise.all([
		guard(blueprint, "packages", async () =>
			evaluatePackages({
				allowlist: manifest.allowlist,
				blueprint,
				declared: manifest.packages,
				installed: await listInstalled(live.listPackages),
				strict,
			}),
		),
		guard(blueprint, "links", () =>
			checkLinks({
				blueprint,
				fetch: live.fetchSource,
				links: files.filter((file) => !isSecretsTemplate(file)),
				stat: live.statLink,
			}),
		),
		guard(blueprint, "secrets-templates", () =>
			checkSecretsTemplates({
				blueprint,
				decryptSecrets: live.decryptSecrets,
				fetchSource: live.fetchText,
				readTarget: live.readSecretsTemplateTarget,
				templates: files.filter((file) => isSecretsTemplate(file)),
			}),
		),
	]);
	return [...packages, ...links, ...templates];
}

// Re-checks whole: listing packages and stats takes a few seconds (ADR 0011).
export const runMachine: ScopeCheck = async ({ home, state, strict, techStack }) => {
	const { data: manifest, rel } = await techStack.blueprint("machines", state.blueprint);
	return checkMachine({
		blueprint: state.blueprint,
		home,
		live: defaultLive(techStack, rel),
		manifest,
		strict,
	});
};

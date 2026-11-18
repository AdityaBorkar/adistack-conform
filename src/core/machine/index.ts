import type { MachineRunState } from "#/core/config.js";
import { checkLinks } from "#/core/machine/links.js";
import { defaultLive } from "#/core/machine/live.js";
import type { MachineLive } from "#/core/machine/live.js";
import { declaredFromManifest, evaluatePackages } from "#/core/machine/packages.js";
import { resolveTarget } from "#/core/machine/paths.js";
import { checkTemplates } from "#/core/machine/templates.js";
import type { CheckResult } from "#/core/result.js";
import { failManual } from "#/core/result.js";
import type { RegistryDocument } from "#/core/upstream/registry.js";
import { fetchMachineManifest } from "#/core/upstream/remote.js";
import type { MachineManifest } from "#/schemas/machine-manifest.js";
import { isTemplateFile } from "#/schemas/machine-manifest.js";
import { errorMessage } from "#/utils/error.js";
import { defaultHome } from "#/utils/fs.js";

export type { MachineLive } from "#/core/machine/live.js";

export interface MachineCheckInput {
	blueprint: string;
	home: string;
	live: MachineLive;
	manifest: MachineManifest;
	strict: boolean;
}

function errorResult(blueprint: string, domain: string, error: unknown): CheckResult[] {
	return [
		failManual(
			{
				id: `machine:${blueprint}:${domain}`,
				kind: "machine",
				scope: "machine",
				target: domain,
				upstream: `tech-stack:${blueprint}`,
			},
			"<unavailable>",
			`${domain} checks complete`,
			`Cannot run ${domain} checks: ${errorMessage(error)}`,
		),
	];
}

async function guard(
	blueprint: string,
	domain: string,
	run: () => Promise<CheckResult[]>,
): Promise<CheckResult[]> {
	try {
		return await run();
	} catch (error) {
		return errorResult(blueprint, domain, error);
	}
}

// Extras are skipped unless the run is strict; links and templates ignore strictness.
export async function checkMachine(input: MachineCheckInput): Promise<CheckResult[]> {
	const { blueprint, home, live, manifest, strict } = input;
	const packagesTask = guard(blueprint, "packages", async () => {
		const [pacman, bun] = await Promise.all([live.listPacman(), live.listBun()]);
		return evaluatePackages({
			allowlist: {
				bun: new Set(manifest.allowlist.bun ?? []),
				pacman: new Set(manifest.allowlist.pacman ?? []),
			},
			blueprint,
			declared: declaredFromManifest(manifest.packages),
			installed: { bun, pacman },
			strict,
		});
	});
	// Manifest entries are per-run temporaries: resolve targets in place
	// (spread-in-map is banned by oxc/no-map-spread; resolveTarget is idempotent).
	// Files without `secrets` link; files with `secrets` render as templates.
	const linksTask = guard(blueprint, "links", () =>
		checkLinks({
			blueprint,
			fetch: live.fetchSource,
			links: manifest.files
				.filter((file) => !isTemplateFile(file))
				.map((link) => ({
					name: link.name,
					source: link.source,
					target: resolveTarget(link.target, home),
				})),
			stat: live.statLink,
		}),
	);
	const templatesTask = guard(blueprint, "templates", () =>
		checkTemplates({
			blueprint,
			decryptSecrets: live.decryptSecrets,
			fetchSource: live.fetchText,
			readTarget: live.readTemplateTarget,
			templates: manifest.files.filter(isTemplateFile).map((template) => ({
				mode: template.mode,
				name: template.name,
				secrets: template.secrets,
				source: template.source,
				target: resolveTarget(template.target, home),
			})),
		}),
	);
	const [packages, links, templates] = await Promise.all([packagesTask, linksTask, templatesTask]);
	return [...packages, ...links, ...templates];
}

export async function runMachine(
	state: MachineRunState,
	registry: RegistryDocument,
	strict: boolean,
	live?: MachineLive,
): Promise<CheckResult[]> {
	const { manifest, manifestRel } = await fetchMachineManifest(
		state.id,
		state.ref,
		state.blueprint,
		registry,
	);
	const home = defaultHome();
	return checkMachine({
		blueprint: state.blueprint,
		home,
		live: live ?? defaultLive(state, manifestRel),
		manifest,
		strict,
	});
}

export function recheckMachineSelected(
	state: MachineRunState,
	registry: RegistryDocument,
	selectedIds: ReadonlySet<string>,
	strict: boolean,
	live?: MachineLive,
): Promise<CheckResult[]> {
	if (selectedIds.size === 0) {
		return Promise.resolve([]);
	}
	const prefix = `machine:${state.blueprint}:`;
	let wanted = false;
	for (const id of selectedIds) {
		if (id.startsWith(prefix)) {
			wanted = true;
			break;
		}
	}
	if (!wanted) {
		return Promise.resolve([]);
	}
	// The full domain run is cheap (~2s): re-check everything, then keep the
	// selected IDs plus any domain error, so a failed re-check never reads as
	// a resolved (vanished) ID.
	const domainErrors = new Set(["packages", "links", "templates"].map((domain) => prefix + domain));
	return runMachine(state, registry, strict, live).then((results) =>
		results.filter((item) => selectedIds.has(item.id) || domainErrors.has(item.id)),
	);
}

import { dirname, join } from "node:path";

import { machineSecretsRel } from "#/core/machine/live.js";
import type { BlueprintKind, RegistryDocument } from "#/core/upstream/registry.js";
import { blueprintNames, blueprintRel } from "#/core/upstream/registry.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import { MachineManifestSchema, isSecretsTemplate } from "#/schemas/machine-manifest.js";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { errorMessage } from "#/utils/error.js";
import { readJsonFile, resolveConfigPath } from "#/utils/fs.js";
import { parseOrThrow } from "#/utils/schema.js";

interface ValidateResult {
	error?: string;
	file: string;
	ok: boolean;
}

const REGISTRY_FILENAME = "registry.json";

const KIND_LABEL: Record<BlueprintKind, string> = {
	github_configs: "GitHub settings",
	machines: "Machine blueprint",
	projects: "Project blueprint",
};

// Tech-stack authors run `validate` inside their tech-stack repo (see that
// repo's `verify` script). It never reads `conform.json`: consumers validate
// their own drift with `check`, not the blueprints.
async function discoverRegistryPath(): Promise<string> {
	const candidate = join(process.cwd(), REGISTRY_FILENAME);
	if (await Bun.file(candidate).exists()) {
		return candidate;
	}
	throw new Error(
		`No tech-stack registry found in ${process.cwd()} (looked for ${REGISTRY_FILENAME}).`,
	);
}

async function resolveRegistryPath(target: string | undefined): Promise<string> {
	if (target === undefined || target.trim() === "") {
		return discoverRegistryPath();
	}
	const abs = resolveConfigPath(target);
	if (await Bun.file(abs).exists()) {
		return abs;
	}
	const candidate = join(abs, REGISTRY_FILENAME);
	if (await Bun.file(candidate).exists()) {
		return candidate;
	}
	throw new Error(
		`No tech-stack registry found: ${candidate} does not exist (pass the tech-stack repo directory or a registry.json file).`,
	);
}

async function missingSources(repoRoot: string, sources: readonly string[]): Promise<string[]> {
	const found = await Promise.all(
		sources.map(async (source) =>
			(await Bun.file(join(repoRoot, source)).exists()) ? undefined : source,
		),
	);
	return found.filter((item) => item !== undefined);
}

async function validateBlueprint(
	repoRoot: string,
	kind: BlueprintKind,
	name: string,
	entryPath: string,
): Promise<ValidateResult> {
	let rel: string;
	try {
		rel = blueprintRel(entryPath);
	} catch (error) {
		return { error: errorMessage(error), file: `${kind} "${name}"`, ok: false };
	}
	const abs = join(repoRoot, rel);
	const label = KIND_LABEL[kind];
	let parsed: unknown;
	try {
		parsed = await readJsonFile(abs, label);
	} catch (error) {
		return { error: errorMessage(error), file: rel, ok: false };
	}
	try {
		if (kind === "projects") {
			const manifest = parseOrThrow(ManifestSchema, abs, parsed, label);
			const missing = await missingSources(
				repoRoot,
				manifest.files.map((file) => file.source),
			);
			if (missing.length > 0) {
				return { error: `Missing blueprint sources: ${missing.join(", ")}`, file: rel, ok: false };
			}
		} else if (kind === "machines") {
			const manifest = parseOrThrow(MachineManifestSchema, abs, parsed, label);
			const missing = await missingSources(
				repoRoot,
				manifest.files.map((file) => file.source),
			);
			if (missing.length > 0) {
				return { error: `Missing blueprint sources: ${missing.join(", ")}`, file: rel, ok: false };
			}
			if (manifest.files.some(isSecretsTemplate)) {
				const secretsRel = machineSecretsRel(rel);
				if (!(await Bun.file(join(repoRoot, secretsRel)).exists())) {
					return {
						error: `Missing secrets file ${secretsRel} (a files[] entry declares secrets).`,
						file: rel,
						ok: false,
					};
				}
			}
		} else {
			parseOrThrow(GithubSchema, abs, parsed, label);
		}
	} catch (error) {
		return { error: errorMessage(error), file: rel, ok: false };
	}
	return { file: rel, ok: true };
}

// The registry first, then one result per blueprint in every section.
export async function validateTechStack(target?: string): Promise<ValidateResult[]> {
	const registryPath = await resolveRegistryPath(target);
	const repoRoot = dirname(registryPath);
	let registry: RegistryDocument;
	try {
		registry = parseOrThrow(
			RegistrySchema,
			registryPath,
			await readJsonFile(registryPath, "Tech-stack registry"),
			"tech-stack registry",
		);
	} catch (error) {
		return [{ error: errorMessage(error), file: REGISTRY_FILENAME, ok: false }];
	}
	const blueprints = (["projects", "machines", "github_configs"] as const).flatMap((kind) =>
		blueprintNames(registry, kind).map((name) => ({ entryPath: registry[kind][name], kind, name })),
	);
	const checked = await Promise.all(
		blueprints.map(({ entryPath, kind, name }) =>
			validateBlueprint(repoRoot, kind, name, entryPath),
		),
	);
	return [{ file: REGISTRY_FILENAME, ok: true }, ...checked];
}

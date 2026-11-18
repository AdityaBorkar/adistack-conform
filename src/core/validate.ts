import { basename, dirname, join } from "node:path";

import { blueprintSources } from "#/core/upstream/blueprint.js";
import type { BlueprintKind } from "#/core/upstream/registry.js";
import { blueprintNames, blueprintRel } from "#/core/upstream/registry.js";
import type { TechStack } from "#/core/upstream/tech-stack.js";
import { UpstreamMissingError, localReader, openTechStack } from "#/core/upstream/tech-stack.js";
import { errorMessage } from "#/utils/error.js";
import { resolveConfigPath } from "#/utils/fs.js";

interface ValidateResult {
	error?: string;
	file: string;
	ok: boolean;
}

const REGISTRY_FILENAME = "registry.json";

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

async function missingSources(techStack: TechStack, sources: readonly string[]): Promise<string[]> {
	const found = await Promise.all(
		sources.map(async (source) => {
			try {
				await techStack.bytes(source, `blueprint source ${source}`);
				return [];
			} catch (error) {
				if (error instanceof UpstreamMissingError) {
					return [source];
				}
				throw error;
			}
		}),
	);
	return found.flat();
}

async function validateBlueprint(
	techStack: TechStack,
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
	try {
		const { data } = await techStack.blueprint(kind, name);
		const missing = await missingSources(techStack, blueprintSources(kind, data, rel));
		if (missing.length > 0) {
			return { error: `Missing blueprint sources: ${missing.join(", ")}`, file: rel, ok: false };
		}
	} catch (error) {
		return { error: errorMessage(error), file: rel, ok: false };
	}
	return { file: rel, ok: true };
}

// The registry first, then one result per blueprint in every section. Reads go
// through the same tech-stack module `check` uses, so the two parse identically.
export async function validateTechStack(target?: string): Promise<ValidateResult[]> {
	const registryPath = await resolveRegistryPath(target);
	let techStack: TechStack;
	try {
		techStack = await openTechStack(localReader(dirname(registryPath)), basename(registryPath));
	} catch (error) {
		return [{ error: errorMessage(error), file: REGISTRY_FILENAME, ok: false }];
	}
	const { registry } = techStack;
	const blueprints = (["projects", "machines", "github_configs"] as const).flatMap((kind) =>
		blueprintNames(registry, kind).map((name) => ({ entryPath: registry[kind][name], kind, name })),
	);
	const checked = await Promise.all(
		blueprints.map(({ entryPath, kind, name }) =>
			validateBlueprint(techStack, kind, name, entryPath),
		),
	);
	return [{ file: REGISTRY_FILENAME, ok: true }, ...checked];
}

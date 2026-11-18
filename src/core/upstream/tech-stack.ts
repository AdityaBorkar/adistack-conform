import { join } from "node:path";

import type { BlueprintData } from "#/core/upstream/blueprint.js";
import { blueprintLabels, parseBlueprint } from "#/core/upstream/blueprint.js";
import type { BlueprintKind, RegistryDocument } from "#/core/upstream/registry.js";
import {
	availableHint,
	blueprintNames,
	blueprintRel,
	findEntry,
} from "#/core/upstream/registry.js";
import { RegistrySchema } from "#/schemas/registry.js";
import { errorMessage } from "#/utils/error.js";
import { isMissingError } from "#/utils/fs.js";
import { parseJsonc } from "#/utils/jsonc.js";
import { parseOrThrow } from "#/utils/schema.js";

// The one "absent" failure every reader and lookup throws, so callers can tell
// a blueprint fix ("entry": not in the registry, "file": not in the repo) from
// an unreachable tech-stack. Anything else a reader throws means "could not look".
export class UpstreamMissingError extends Error {
	rel: string;
	what: "entry" | "file";

	constructor(message: string, what: "entry" | "file", rel: string, options?: ErrorOptions) {
		super(message, options);
		this.rel = rel;
		this.what = what;
	}
}

// Where a tech-stack repo is read from: the pin over HTTPS (check/fix) or a
// local checkout (validate). `rel` is always repo-relative.
export interface TechStackReader {
	bytes: (rel: string, label: string) => Promise<Uint8Array>;
	text: (rel: string, label: string) => Promise<string>;
	// Names a repo-relative file in parse errors.
	where: (rel: string) => string;
}

// One tech-stack repo, opened once per run (fresh every run, ADR 0004).
export interface TechStack extends TechStackReader {
	blueprint: <K extends BlueprintKind>(
		kind: K,
		name: string,
	) => Promise<{ data: BlueprintData<K>; rel: string }>;
	registry: RegistryDocument;
}

// JSONC is a superset of JSON, so every tech-stack document parses the same way.
async function readJsonc(reader: TechStackReader, rel: string, label: string): Promise<unknown> {
	const text = await reader.text(rel, label);
	try {
		return parseJsonc(text);
	} catch (error) {
		throw new Error(`${label} has invalid JSON in ${reader.where(rel)}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
}

export async function openTechStack(
	reader: TechStackReader,
	registryRel = "registry.json",
): Promise<TechStack> {
	const registry = parseOrThrow(
		RegistrySchema,
		reader.where(registryRel),
		await readJsonc(reader, registryRel, "Tech-stack registry"),
		"tech-stack registry",
	);
	return {
		...reader,
		// Registry lookup, read and schema parse for one blueprint file.
		blueprint: async (kind, name) => {
			const { label, plural } = blueprintLabels(kind);
			const entry = findEntry(registry, kind, name);
			if (entry === undefined) {
				const hint = availableHint(blueprintNames(registry, kind), plural);
				throw new UpstreamMissingError(
					`${label} "${name}" not found in the tech-stack registry.${hint}`,
					"entry",
					name,
				);
			}
			const rel = blueprintRel(entry.path);
			const raw = await readJsonc(reader, rel, `${label} ${name}`);
			return { data: parseBlueprint(kind, raw, reader.where(rel)), rel };
		},
		registry,
	};
}

// A tech-stack checkout on disk (`validate`).
export function localReader(root: string): TechStackReader {
	const read = async <T>(rel: string, label: string, load: (abs: string) => Promise<T>) => {
		const abs = join(root, rel);
		try {
			return await load(abs);
		} catch (error) {
			if (isMissingError(error)) {
				throw new UpstreamMissingError(`${label} not found: ${abs}`, "file", rel, {
					cause: error,
				});
			}
			throw error;
		}
	};
	return {
		bytes: (rel, label) =>
			read(rel, label, async (abs) => new Uint8Array(await Bun.file(abs).arrayBuffer())),
		text: (rel, label) => read(rel, label, (abs) => Bun.file(abs).text()),
		where: (rel) => join(root, rel),
	};
}

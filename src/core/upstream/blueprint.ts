import type * as z from "zod";

import type { BlueprintKind } from "#/core/upstream/registry.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import { MachineManifestSchema, isSecretsTemplate } from "#/schemas/machine-manifest.js";
import { ManifestSchema } from "#/schemas/project-manifest.js";
import { parseOrThrow } from "#/utils/schema.js";

// The sops-encrypted secrets file lives next to the machine manifest.
export function machineSecretsRel(manifestRel: string): string {
	const slash = manifestRel.lastIndexOf("/");
	return slash === -1 ? "secrets.yaml" : `${manifestRel.slice(0, slash)}/secrets.yaml`;
}

// Everything per blueprint kind that both `check` (fetched) and `validate`
// (local checkout) need, so the two can never disagree on what is valid.
const BLUEPRINTS = {
	github_configs: {
		label: "GitHub blueprint",
		plural: "GitHub blueprints",
		schema: GithubSchema,
		sources: (): string[] => [],
	},
	machines: {
		label: "Machine blueprint",
		plural: "machine blueprints",
		schema: MachineManifestSchema,
		sources: (data: z.infer<typeof MachineManifestSchema>, rel: string): string[] => [
			...data.files.map((file) => file.source),
			...(data.files.some(isSecretsTemplate) ? [machineSecretsRel(rel)] : []),
		],
	},
	projects: {
		label: "Project blueprint",
		plural: "project blueprints",
		schema: ManifestSchema,
		sources: (data: z.infer<typeof ManifestSchema>): string[] =>
			data.files.map((file) => file.source),
	},
} as const;

export type BlueprintData<K extends BlueprintKind> = z.infer<(typeof BLUEPRINTS)[K]["schema"]>;

export function blueprintLabels(kind: BlueprintKind): { label: string; plural: string } {
	return BLUEPRINTS[kind];
}

// `raw` is the already JSONC-parsed document; `where` names it in errors.
export function parseBlueprint<K extends BlueprintKind>(
	kind: K,
	raw: unknown,
	where: string,
): BlueprintData<K> {
	const { label, schema } = BLUEPRINTS[kind];
	return parseOrThrow(schema as z.ZodType<unknown>, where, raw, label) as BlueprintData<K>;
}

// Repo-relative files a parsed blueprint needs to exist in the tech-stack repo.
export function blueprintSources<K extends BlueprintKind>(
	kind: K,
	data: BlueprintData<K>,
	rel: string,
): string[] {
	const sources = BLUEPRINTS[kind].sources as (data: BlueprintData<K>, rel: string) => string[];
	return sources(data, rel);
}

import * as z from "zod";

import { RepoRelSourceSchema } from "#/schemas/source.js";

function versionString(label: string) {
	return z
		.string()
		.min(1)
		.refine((value) => !/\s/u.test(value), {
			message: `${label} version must be a version or "latest" (no whitespace).`,
		});
}

// Names reach `sudo pacman` / `sudo apt-get` / `bun add` argv: no leading "-"
// or "." and no shell or option syntax, so an upstream can never smuggle a
// flag in.
const PackageNameSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9@_+][\w@.+/-]*$/u,
		"Package names use letters, digits and @ . _ + / - (no leading - or .).",
	);

// Secrets are $$CAPITAL_CASING$$ slots; same alphabet secrets.yaml keys are parsed with.
const SecretNameSchema = z
	.string()
	.regex(/^[A-Z][A-Z0-9_]*$/u, "Secret names use CAPITAL_CASING (A-Z, 0-9, _, leading letter).");

const ManagerPackagesSchema = z.record(PackageNameSchema, versionString("Package"));

const MachinePackagesSchema = z
	.object({
		apt: ManagerPackagesSchema.default({}),
		bun: ManagerPackagesSchema.default({}),
		pacman: ManagerPackagesSchema.default({}),
	})
	.strict();

const MachineFileSchema = z
	.object({
		mode: z.enum(["0600", "0644"]).optional(),
		name: z.string().min(1),
		secrets: z.array(SecretNameSchema).min(1).optional(),
		source: RepoRelSourceSchema,
		target: z.string().min(1),
	})
	.strict();

const MachineAllowlistSchema = z
	.object({
		apt: z.array(PackageNameSchema).optional(),
		bun: z.array(PackageNameSchema).optional(),
		pacman: z.array(PackageNameSchema).optional(),
	})
	.strict();

export const MachineManifestSchema = z.compile(
	z
		.object({
			$description: z.string().optional(),
			$name: z.string().min(1).optional(),
			$schema: z.string().optional(),
			allowlist: MachineAllowlistSchema.default({}),
			files: z.array(MachineFileSchema).default([]),
			packages: MachinePackagesSchema.default({ apt: {}, bun: {}, pacman: {} }),
		})
		.strict()
		.superRefine((data, ctx) => {
			const seen = new Set<string>();
			for (const entry of data.files) {
				if (seen.has(entry.name)) {
					ctx.addIssue({ code: "custom", message: `files has duplicate name "${entry.name}".` });
				}
				seen.add(entry.name);
				// Modes apply to secrets templates alone; plain files carry no mode.
				if (entry.mode !== undefined && entry.secrets === undefined) {
					ctx.addIssue({
						code: "custom",
						message: `files entry "${entry.name}" sets mode without secrets; mode applies to secrets templates only (default 0600).`,
					});
				}
			}
			if (
				Object.keys(data.packages.apt).length === 0 &&
				Object.keys(data.packages.pacman).length === 0 &&
				Object.keys(data.packages.bun).length === 0 &&
				data.files.length === 0
			) {
				ctx.addIssue({
					code: "custom",
					message:
						"Machine manifest enforces nothing: add at least one packages (apt/pacman/bun) or files[] entry.",
				});
			}
		}),
);

export type MachineManifest = z.infer<typeof MachineManifestSchema>;

// A file with a `secrets` list renders as a secrets template; without it, it
// links. The schema rejects empty lists, so presence alone decides.
export function isSecretsTemplate<T extends { secrets?: string[] | undefined }>(
	file: T,
): file is T & { secrets: string[] } {
	return file.secrets !== undefined;
}

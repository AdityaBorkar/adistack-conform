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

// Names reach `sudo pacman` / `bun add` argv: no leading "-" or "." and no
// shell or option syntax, so an upstream can never smuggle a flag in.
const PackageNameSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9@_+][\w@.+/-]*$/u,
		"Package names use letters, digits and @ . _ + / - (no leading - or .).",
	);

// Same alphabet secrets.yaml keys are parsed with.
const SecretNameSchema = z
	.string()
	.regex(
		/^[A-Za-z_][\w.-]*$/u,
		"Secret names use letters, digits and _ . - (leading letter or _).",
	);

const ManagerPackagesSchema = z.record(PackageNameSchema, versionString("Package"));

const MachinePackagesSchema = z
	.object({
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
		bun: z.array(PackageNameSchema).optional(),
		pacman: z.array(PackageNameSchema).optional(),
	})
	.strict();

export const MachineManifestSchema = z.compile(
	z
		.object({
			$schema: z.string().optional(),
			"@description": z.string().optional(),
			"@name": z.string().min(1).optional(),
			allowlist: MachineAllowlistSchema.default({}),
			files: z.array(MachineFileSchema).default([]),
			packages: MachinePackagesSchema.default({ bun: {}, pacman: {} }),
		})
		.strict()
		.superRefine((data, ctx) => {
			const seen = new Set<string>();
			for (const entry of data.files) {
				if (seen.has(entry.name)) {
					ctx.addIssue({ code: "custom", message: `files has duplicate name "${entry.name}".` });
				}
				seen.add(entry.name);
				// Links enforce only the symlink path; modes apply to secrets templates alone.
				if (entry.mode !== undefined && entry.secrets === undefined) {
					ctx.addIssue({
						code: "custom",
						message: `files entry "${entry.name}" sets mode without secrets; mode applies to secrets templates only (default 0600).`,
					});
				}
			}
			if (
				Object.keys(data.packages.pacman).length === 0 &&
				Object.keys(data.packages.bun).length === 0 &&
				data.files.length === 0
			) {
				ctx.addIssue({
					code: "custom",
					message:
						"Machine manifest enforces nothing: add at least one packages (pacman/bun) or files[] entry.",
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

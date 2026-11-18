import * as z from "zod";

function machineSourceRel() {
	return z
		.string()
		.min(1)
		.refine(
			(value) =>
				!value.startsWith("/") &&
				!value.startsWith("./") &&
				!value.startsWith("../") &&
				!value.includes("\\") &&
				value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
			{ message: "Source must be repo-relative with no empty, dot, or dot-dot segments." },
		);
}

function versionString(label: string) {
	return z
		.string()
		.min(1)
		.refine((value) => !/\s/u.test(value), {
			message: `${label} version must be a version or "latest" (no whitespace).`,
		});
}

const ManagerPackagesSchema = z.record(z.string().min(1), versionString("Package"));

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
		secrets: z.array(z.string().min(1)).min(1).optional(),
		source: machineSourceRel(),
		target: z.string().min(1),
	})
	.strict();

const MachineAllowlistSchema = z
	.object({
		bun: z.array(z.string().min(1)).optional(),
		pacman: z.array(z.string().min(1)).optional(),
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
			params: z.array(z.string()).default([]),
			system: z.string().min(1).default("x86_64-linux"),
		})
		.strict()
		.superRefine((data, ctx) => {
			const seen = new Set<string>();
			for (const entry of data.files) {
				if (seen.has(entry.name)) {
					ctx.addIssue({ code: "custom", message: `files has duplicate name "${entry.name}".` });
				}
				seen.add(entry.name);
				// Links enforce only the symlink path; modes apply to templates alone.
				if (entry.mode !== undefined && entry.secrets === undefined) {
					ctx.addIssue({
						code: "custom",
						message: `files entry "${entry.name}" sets mode without secrets; mode applies to templates only.`,
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

export type MachineFile = z.infer<typeof MachineFileSchema>;

// A file with a non-empty `secrets` list renders as a template; without it
// links. The schema rejects empty lists so both predicates agree.
export function isTemplateFile(file: MachineFile): boolean {
	return (file.secrets?.length ?? 0) > 0;
}

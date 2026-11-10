import * as z from "zod";

function safeRelPath(label: string) {
	return z
		.string()
		.min(1)
		.refine(
			(value) =>
				!value.includes("\\") &&
				value
					.replace(/\/+$/u, "")
					.replace(/^\.\//u, "")
					.replace(/^\/+/u, "")
					.split("/")
					.every((part) => part !== "" && part !== "." && part !== ".."),
			{ message: `${label} must stay inside the repo (no empty, ".", or ".." segments).` },
		);
}

const MachineEntrySchema = z
	.object({
		name: z.string().min(1).describe("Display name for the blueprint."),
		path: safeRelPath("Machine flake directory").describe(
			"Machine flake directory relative to the tech-stack root (e.g. ./machines/main/).",
		),
	})
	.strict();

export const RegistrySchema = z.compile(
	z
		.object({
			$schema: z
				.string()
				.describe(
					"JSON Schema reference, e.g. https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json.",
				)
				.optional(),
			github_configs: z
				.record(z.string(), safeRelPath("GitHub settings path"))
				.describe("GitHub settings blueprints as key/path entries."),
			machines: z
				.record(z.string(), MachineEntrySchema)
				.describe("Machine blueprints as key/entry pairs."),
			projects: z
				.record(z.string(), safeRelPath("Project blueprint path"))
				.describe("Project blueprints as key/path entries."),
		})
		.strict()
		.superRefine((data, ctx) => {
			for (const [scope, entries] of [
				["github_configs", Object.keys(data.github_configs)],
				["machines", Object.keys(data.machines)],
				["projects", Object.keys(data.projects)],
			] as const) {
				for (const key of entries) {
					if (key.trim() === "") {
						ctx.addIssue({
							code: "custom",
							message: `${scope} has an empty blueprint key.`,
							path: [scope, key],
						});
					}
				}
			}
		}),
);

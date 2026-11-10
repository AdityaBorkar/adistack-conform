import * as z from "zod";

const TechStackSourceSchema = z.object({
	ref: z.string().min(1).describe("Git branch, tag, or commit.").default("main"),
	repo: z
		.string()
		.regex(/^[^/\s]+\/[^/\s]+$/u)
		.describe("GitHub owner/repo holding blueprints (project) or nix flakes (machine)."),
	type: z.literal("github").describe("Tech-stack source; only github is supported."),
});

const ConformMachineSectionSchema = z.object({
	blueprint: z
		.string()
		.min(1)
		.describe(
			"Machine blueprint from the tech-stack registry (entry name or directory, e.g. main).",
		),
	configuration: z
		.string()
		.min(1)
		.describe(
			"homeConfigurations attribute to switch to, e.g. adityab. Defaults to home-manager auto-select ($USER).",
		)
		.optional(),
});

const ConformGithubSectionSchema = z.object({
	blueprint: z
		.string()
		.min(1)
		.describe("GitHub settings blueprint name, e.g. npm-package (registry github_configs entry)."),
	repo: z
		.string()
		.regex(/^[^/\s]+\/[^/\s]+$/u)
		.describe(
			"GitHub owner/repo to check. Defaults to $GITHUB_REPOSITORY, then the git origin remote.",
		)
		.optional(),
});
const ConformProjectSectionSchema = z.object({
	blueprint: z.string().min(1).describe("Project blueprint name, e.g. cli-app."),
});

export const ConformSchema = z.compile(
	z.object({
		$schema: z
			.string()
			.describe("JSON Schema reference, e.g. ./configuration_schema/conform.json.")
			.optional(),
		github: ConformGithubSectionSchema.describe("GitHub repo settings desired state.").optional(),
		machine: ConformMachineSectionSchema.describe("Machine desired state.").optional(),
		project: ConformProjectSectionSchema.describe("Project desired state.").optional(),
		source: TechStackSourceSchema.describe("Tech-stack repo holding blueprints and nix flakes."),
	}),
);

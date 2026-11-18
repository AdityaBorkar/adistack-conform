import * as z from "zod";

const TechStackSourceSchema = z
	.object({
		ref: z.string().min(1).describe("Git branch, tag, or commit.").default("main"),
		repo: z
			.string()
			.regex(/^[^/\s]+\/[^/\s]+$/u)
			.describe("GitHub owner/repo holding blueprints."),
		type: z.literal("github").describe("Provider hosting the pin; only github is supported."),
	})
	.strict();

const ConformMachineSectionSchema = z
	.object({
		blueprint: z
			.string()
			.min(1)
			.describe("Machine blueprint name from the tech-stack registry, e.g. main."),
	})
	.strict();

const ConformGithubSectionSchema = z
	.object({
		blueprint: z
			.string()
			.min(1)
			.describe(
				"GitHub settings blueprint name, e.g. npm-package (registry github_configs entry).",
			),
		repo: z
			.string()
			.regex(/^[^/\s]+\/[^/\s]+$/u)
			.describe(
				"GitHub owner/repo to check. Defaults to $GITHUB_REPOSITORY, then the git origin remote.",
			)
			.optional(),
	})
	.strict();
const ConformProjectSectionSchema = z
	.object({
		blueprint: z.string().min(1).describe("Project blueprint name, e.g. cli-app."),
	})
	.strict();

export const ConformSchema = z.compile(
	z
		.object({
			$schema: z.string().describe("JSON Schema reference, e.g. ./config/conform.json.").optional(),
			github: ConformGithubSectionSchema.describe("GitHub repo settings desired state.").optional(),
			machine: ConformMachineSectionSchema.describe("Machine desired state.").optional(),
			project: ConformProjectSectionSchema.describe("Project desired state.").optional(),
			source: TechStackSourceSchema.describe(
				"Pin: the tech-stack repo and ref holding the registry and blueprints.",
			),
		})
		.strict(),
);

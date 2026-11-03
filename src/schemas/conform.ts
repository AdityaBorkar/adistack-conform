import * as v from "valibot";

const TechStackSourceSchema = v.object({
	ref: v.optional(
		v.pipe(v.string(), v.minLength(1), v.description("Git branch, tag, or commit.")),
		"main",
	),
	repo: v.pipe(
		v.string(),
		v.regex(/^[^/\s]+\/[^/\s]+$/u),
		v.description(
			"GitHub owner/repo holding blueprints and presets (project) or nix flakes (machine).",
		),
	),
	type: v.pipe(v.literal("github"), v.description("Tech-stack source; only github is supported.")),
});

export const ConformMachineSectionSchema = v.object({
	blueprint: v.pipe(
		v.string(),
		v.minLength(1),
		v.description(
			"Machine blueprint from the tech-stack registry (entry name or directory, e.g. main).",
		),
	),
	configuration: v.optional(
		v.pipe(
			v.string(),
			v.minLength(1),
			v.description(
				"homeConfigurations attribute to switch to, e.g. adityab. Defaults to home-manager auto-select ($USER).",
			),
		),
	),
});

export const ConformGithubSectionSchema = v.object({
	blueprint: v.pipe(
		v.string(),
		v.minLength(1),
		v.description(
			"GitHub settings blueprint name, e.g. cli-app (reads the manifest github preset).",
		),
	),
	repo: v.optional(
		v.pipe(
			v.string(),
			v.regex(/^[^/\s]+\/[^/\s]+$/u),
			v.description(
				"GitHub owner/repo to check. Defaults to $GITHUB_REPOSITORY, then the git origin remote.",
			),
		),
	),
});
export const ConformProjectSectionSchema = v.object({
	blueprint: v.pipe(
		v.string(),
		v.minLength(1),
		v.description("Project blueprint name, e.g. cli-app."),
	),
});

export const ConformSchema = v.object({
	$schema: v.optional(
		v.pipe(
			v.string(),
			v.description("JSON Schema reference, e.g. ./configuration_schema/conform.json."),
		),
	),
	github: v.optional(
		v.pipe(ConformGithubSectionSchema, v.description("GitHub repo settings desired state.")),
	),
	machine: v.optional(v.pipe(ConformMachineSectionSchema, v.description("Machine desired state."))),
	project: v.optional(v.pipe(ConformProjectSectionSchema, v.description("Project desired state."))),
	source: v.pipe(
		TechStackSourceSchema,
		v.description("Tech-stack repo holding blueprints and nix flakes."),
	),
});

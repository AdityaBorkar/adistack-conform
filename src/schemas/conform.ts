import * as v from "valibot";

import { TechStackSourceSchema } from "#/schemas/common.js";

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
	machine: v.optional(v.pipe(ConformMachineSectionSchema, v.description("Machine desired state."))),
	project: v.optional(v.pipe(ConformProjectSectionSchema, v.description("Project desired state."))),
	source: v.pipe(
		TechStackSourceSchema,
		v.description("Tech-stack repo holding blueprints and nix flakes."),
	),
});

import { makeBlueprintSchema } from "#/schemas/common.js";

export const ProjectBlueprintSchema = makeBlueprintSchema({
	nameDescription: "Display name for the project blueprint.",
	schemaDescription: "JSON Schema reference, e.g. project-blueprint.json.",
	typeDescription: "Discriminant for project blueprints.",
	typeLiteral: "project.blueprint",
});

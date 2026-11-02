import { makeBlueprintSchema } from "#/schemas/common.js";

export const MachineBlueprintSchema = makeBlueprintSchema({
	nameDescription: "Display name for the machine blueprint.",
	schemaDescription: "JSON Schema reference, e.g. machine-blueprint.json.",
	typeDescription: "Discriminant for machine blueprints.",
	typeLiteral: "machine.blueprint",
});

import { makeConfigSchema } from "#/schemas/common.js";

export const ProjectSchema = makeConfigSchema({
	blueprintDescription: "Project blueprint name, e.g. cli-app.",
	schemaDescription: "JSON Schema reference, e.g. ./configuration_schema/project.json.",
});

import { makeConfigSchema } from "#/schemas/common.js";

export const MachineSchema = makeConfigSchema({
	blueprintDescription: "Machine blueprint name, e.g. main.",
	schemaDescription: "JSON Schema reference, e.g. ./configuration_schema/machine.json.",
});

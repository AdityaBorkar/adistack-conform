import type { Command } from "commander";

import type { DesiredStateOption } from "#/core/config.js";
import { loadDesiredState } from "#/core/config.js";
import { okMark } from "#/core/report.js";
import { collectValidateTargets, validateTargets } from "#/core/validate.js";

async function run(options: DesiredStateOption): Promise<number> {
	const desiredState = await loadDesiredState(options.desiredState);
	const results = await validateTargets(collectValidateTargets(desiredState));
	for (const result of results) {
		if (result.ok) {
			console.log(`${okMark(true)} ${result.file}`);
		} else {
			console.error(`${okMark(false)} ${result.file}\n    ${result.error ?? "invalid"}`);
		}
	}
	const invalid = results.filter((item) => !item.ok).length;
	if (invalid === 0) {
		console.log(`\nAll ${results.length} tech-stack file(s) valid.`);
		return 0;
	}
	console.log(`\nValidate: ${results.length - invalid} valid, ${invalid} invalid.`);
	return 1;
}

export const validateCommand = {
	configure: (cmd: Command): Command =>
		cmd.description("Validate the tech-stack registry.json and blueprint files."),
	name: "validate",
	run,
};

import type { Command } from "commander";

import type { ConfigPathOption } from "#/core/config.js";
import { okMark } from "#/core/report.js";
import { validateTechStack } from "#/core/validate.js";

async function run(options: ConfigPathOption): Promise<number> {
	const results = await validateTechStack(options.path);
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
		cmd
			.description(
				"Validate a local tech-stack repo: registry.json, every blueprint, and every referenced source file.",
			)
			.option(
				"--path <path>",
				"Path to registry.json or tech-stack repo dir (default: ./registry.json).",
			),
	name: "validate",
	run,
};

#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Command, type OptionValues } from "commander";

import { checkCommand } from "#/commands/check.js";
import { fixCommand } from "#/commands/fix.js";
import { validateCommand } from "#/commands/validate.js";
import { errorMessage } from "#/utils/error.js";

declare const CONFORM_VERSION: string | undefined;

function packageVersion(): string {
	if (typeof CONFORM_VERSION === "string" && CONFORM_VERSION !== "") {
		return CONFORM_VERSION;
	}
	try {
		const pkg = JSON.parse(
			readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf8"),
		) as { version?: unknown };
		if (typeof pkg.version === "string" && pkg.version !== "") {
			return pkg.version;
		}
	} catch {
		// Compiled binary without package.json nearby; fall through.
	}
	return "0.0.0-dev";
}

const VERSION = packageVersion();

function failWith(error: unknown): never {
	console.error(errorMessage(error));
	process.exit(2);
}

const program = new Command();
program
	.description(
		"Check the current project/machine/repo against the desired state in the current directory.",
	)
	.name("adistack-conform")
	.version(VERSION);

// Each command module owns its flags (`configure`) and logic (`run`, which
// returns the exit code); this file only wires them and maps throws to exit 2.
function register<Options extends OptionValues>(definition: {
	configure: (cmd: Command) => Command;
	name: string;
	run: (options: Options, cmd: Command) => Promise<number>;
}): void {
	definition.configure(program.command(definition.name)).action(async (...args: unknown[]) => {
		try {
			const cmd = args.at(-1) as Command;
			process.exit(await definition.run(cmd.opts<Options>(), cmd));
		} catch (error) {
			failWith(error);
		}
	});
}

register(checkCommand);
register(fixCommand);
register(validateCommand);

void program.parseAsync(process.argv).catch((error: unknown) => {
	failWith(error);
});

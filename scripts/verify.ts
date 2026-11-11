import { $ } from "bun";
import { join } from "node:path";

let failedCommands = [];

const results = await Promise.all(
	["oxfmt --check", "check:lint", "check:types", "test", "check:knip", "check:conform"].map(
		async (name) => ({
			name,
			output: await $`bun ${name}`
				.cwd(join(import.meta.dir, ".."))
				.quiet()
				.nothrow(),
		}),
	),
);

for (const result of results) {
	const status = result.output.exitCode === 0 ? "ok" : `failed: ${result.output.exitCode}`;
	console.log(`\n=== bun ${result.name} (${status}) ===\n`, result.output.text());
	if (result.output.exitCode !== 0) {
		failedCommands.push(result.name);
	}
}

if (failedCommands.length > 0) {
	console.error(`\nverify failed: ${failedCommands.join(", ")}`);
	process.exit(1);
}

console.log("\nverify passed");

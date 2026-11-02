import { build } from "bun";
import { join } from "node:path";

import { generateJsonSchema } from "./generate-json-schema";

const root = join(import.meta.dir, "..");

const results = await Promise.allSettled([
	generateJsonSchema(),
	build({
		bytecode: true,
		compile: {
			autoloadPackageJson: false,
			autoloadTsconfig: false,
			outfile: join(root, ".output", "adistack-conform"),
		},
		entrypoints: [join(root, "src", "index.ts")],
		minify: true,
		outdir: join(root, ".output"),
		sourcemap: "none",
		target: "bun",
	}),
]);

const failures = results.filter((result) => result.status === "rejected");
if (failures.length > 0) {
	for (const failure of failures) {
		console.error(failure.reason instanceof Error ? failure.reason.message : failure.reason);
	}
	process.exit(1);
}

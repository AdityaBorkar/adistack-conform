import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function run(args: string[]): Promise<void> {
	const proc = Bun.spawn(args, {
		cwd: root,
		stdio: ["inherit", "inherit", "inherit"],
	});
	const code = await proc.exited;
	if (code !== 0) {
		process.exit(code);
	}
}

await run([process.execPath, join(root, "scripts", "generate-json-schema.ts")]);
await run([
	process.execPath,
	"build",
	join(root, "src", "index.ts"),
	"--compile",
	"--outfile",
	join(root, ".output", "adistack-conform"),
]);

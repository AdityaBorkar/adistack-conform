import type { TechStackReader } from "#/core/upstream/tech-stack.js";
import { UpstreamMissingError } from "#/core/upstream/tech-stack.js";

// In-memory tech-stack adapter for tests: `files` maps repo-relative paths to
// text; paths in `down` fail as unreachable instead of missing.
export function memoryReader(
	files: Record<string, string>,
	down: ReadonlySet<string> = new Set(),
): TechStackReader {
	const read = (rel: string): Promise<string> =>
		new Promise((resolve) => {
			if (down.has(rel)) {
				throw new Error(`${rel} fetch failed: HTTP 503.`);
			}
			const text = files[rel];
			if (text === undefined) {
				throw new UpstreamMissingError(`${rel} not found`, "file", rel);
			}
			resolve(text);
		});
	return {
		bytes: async (rel) => new TextEncoder().encode(await read(rel)),
		text: (rel) => read(rel),
		where: (rel) => `${rel} (memory)`,
	};
}

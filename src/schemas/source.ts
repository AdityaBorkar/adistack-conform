import * as z from "zod";

// A file path inside the tech-stack repo (e.g. projects/files/<group>/<file>):
// no leading "/", "./" or "../", no empty/dot segments, "/" separators only.
export const RepoRelSourceSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("\\") &&
			value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
		{ message: "Source must be repo-relative with no empty, dot, or dot-dot segments." },
	);

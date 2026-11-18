import type * as z from "zod";

import type { CheckBase } from "#/core/result.js";
import { GithubSchema } from "#/schemas/github-settings.js";

export type GithubSettings = z.infer<typeof GithubSchema>;

export function baseFor(blueprint: string, name: string, target: string): CheckBase {
	return {
		id: `github:${blueprint}:${name}`,
		kind: "github",
		scope: "github",
		target,
		upstream: `tech-stack:${blueprint}`,
	};
}

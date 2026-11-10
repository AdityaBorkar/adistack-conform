import type * as z from "zod";

import { GithubSchema } from "#/schemas/github-settings.js";
import type { CheckBase } from "#/utils/result.js";

export type GithubSettings = z.infer<typeof GithubSchema>;

export function baseFor(blueprint: string, name: string, target: string): CheckBase {
	return {
		id: `github:${blueprint}:${name}`,
		kind: "github",
		scope: "github",
		source: `tech-stack:${blueprint}`,
		target,
	};
}

export function diffSummary(diffs: readonly string[]): string {
	return diffs.join("; ");
}

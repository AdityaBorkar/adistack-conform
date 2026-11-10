import { describe, expect, test } from "bun:test";

import { ConformSchema } from "#/schemas/conform.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import {
	forkApprovalPolicy,
	isPrivateVulnEnabled,
	normalizeAllowedActions,
} from "#/stack/github.js";

const source = { ref: "main", repo: "o/r", type: "github" } as const;

describe("github IaC mappings", () => {
	test("allowed uses GitHub API values (local_only)", () => {
		expect(normalizeAllowedActions("local-only")).toBe("local_only");
		expect(normalizeAllowedActions("local_only")).toBe("local_only");
		const parsed = GithubSchema.safeParse({});
		expect(parsed.success).toBe(true);
		const hyphen = GithubSchema.safeParse({ actions: { allowed: "local-only" } });
		expect(hyphen.success).toBe(false);
		const ok = GithubSchema.safeParse({ actions: { allowed: "local_only" } });
		expect(ok.success).toBe(true);
	});

	test("fork approval maps to API policies", () => {
		expect(forkApprovalPolicy(true)).toBe("all_external_contributors");
		expect(forkApprovalPolicy(false)).toBe("first_time_contributors");
	});

	test("private vulnerability reporting reads the enabled flag", () => {
		expect(isPrivateVulnEnabled({ enabled: true })).toBe(true);
		expect(isPrivateVulnEnabled({ enabled: false })).toBe(false);
		expect(isPrivateVulnEnabled()).toBe(false);
	});

	test("conform.json keeps github.repo and requires a blueprint", () => {
		const parsed = ConformSchema.safeParse({
			github: { blueprint: "npm-package", repo: "o/r" },
			source,
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.github?.repo).toBe("o/r");
		}
		expect(ConformSchema.safeParse({ github: {}, source }).success).toBe(false);
		expect(ConformSchema.safeParse({ github: { blueprint: "" }, source }).success).toBe(false);
	});
});

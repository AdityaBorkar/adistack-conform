import { describe, expect, test } from "bun:test";

import { ConformSchema } from "#/schemas/config.js";
import { GithubSchema } from "#/schemas/github-settings.js";
import { forkApprovalPolicy, isPrivateVulnEnabled, protectionPutBody } from "#/stack/github.js";
import { checkSecrets, checkSecurity } from "#/stack/github/security.js";

const source = { ref: "main", repo: "o/r", type: "github" } as const;

function stubGithubBody(body: unknown): Response {
	return {
		headers: { get: () => null },
		ok: true,
		status: 200,
		text: () => Promise.resolve(JSON.stringify(body)),
	} as unknown as Response;
}

describe("github IaC mappings", () => {
	test("allowed uses GitHub API values (local_only)", () => {
		const parsed = GithubSchema.safeParse({});
		expect(parsed.success).toBe(true);
		const hyphen = GithubSchema.safeParse({ actions: { allowed: "local-only" } });
		expect(hyphen.success).toBe(false);
		const ok = GithubSchema.safeParse({ actions: { allowed: "local_only" } });
		expect(ok.success).toBe(true);
	});

	test("missing security status reads as disabled", async () => {
		const golden = GithubSchema.parse({});
		const notFound = {
			headers: { get: () => null },
			ok: false,
			status: 404,
			text: () => Promise.resolve(""),
		} as unknown as Response;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => Promise.resolve(notFound)) as unknown as typeof fetch;
		try {
			const results = await checkSecurity("npm-package", "o/r", golden, "o/r", () =>
				Promise.resolve({}),
			);
			expect(results[0]?.actual).toContain("secret_scanning: disabled → enabled");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("secrets hint names the right CLI for the missing kind", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((url: string | URL | Request) => {
			const path = String(url);
			if (path.includes("/actions/secrets")) {
				return Promise.resolve(stubGithubBody({ secrets: [] }));
			}
			return Promise.resolve(stubGithubBody({ variables: [] }));
		}) as unknown as typeof fetch;
		try {
			const forSecrets = await checkSecrets(
				"npm-package",
				"o/r",
				GithubSchema.parse({ secrets: ["A"] }),
				"o/r",
			);
			expect(forSecrets.hint).toContain("gh secret set A");
			const forVariables = await checkSecrets(
				"npm-package",
				"o/r",
				GithubSchema.parse({ variables: ["V"] }),
				"o/r",
			);
			expect(forVariables.hint).toContain("gh variable set V");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("protection body preserves unknown fields and maps checks", () => {
		const body = protectionPutBody(undefined, {
			branch: "stable",
			checks: ["conform"],
			dismissStale: true,
			requireApprovals: 1,
			requireCodeOwner: true,
			requireConversationResolution: true,
			requireSignedCommits: false,
			restrictPushes: false,
		});
		expect(body["restrictions"]).toBeNull();
		expect(body["enforce_admins"]).toBe(true);
		expect(body["required_status_checks"]).toEqual({
			checks: [{ context: "conform" }],
			strict: false,
		});
		expect(body["required_pull_request_reviews"]).toMatchObject({
			required_approving_review_count: 1,
		});
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

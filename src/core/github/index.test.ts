import { describe, expect, test } from "bun:test";

import { forkApprovalPolicy } from "#/core/github/actions.js";
import { protectionPutBody } from "#/core/github/protection.js";
import { checkSecrets, checkSecurity, isPrivateVulnEnabled } from "#/core/github/security.js";
import { checkWebhooks } from "#/core/github/webhooks.js";
import { ConformSchema } from "#/schemas/config.js";
import { GithubSchema } from "#/schemas/github-settings.js";

const source = { ref: "main", repo: "o/r", type: "github" } as const;

function validGithubJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		actions: {
			allowApprovePRs: false,
			allowed: "all",
			approvalForExternal: true,
			defaultWorkflowPermissions: "read",
			oidcImmutableSubject: true,
			retentionDays: 90,
			shaPinningRequired: true,
		},
		archiveSettings: { commitComments: false, includeLfsInArchives: false, pushUpdateLimit: null },
		checks: ["conform"],
		codeowners: ".github/CODEOWNERS",
		defaultBranch: "main",
		environments: ["production"],
		features: {
			discussions: false,
			issueTemplates: true,
			issues: { enabled: true },
			projects: false,
			sponsorships: false,
			wiki: false,
		},
		merge: {
			autoMerge: false,
			deleteHeadBranches: true,
			mergeCommit: false,
			mergeMessage: "pr-body",
			mergeTitle: "pr-title",
			rebaseMerge: false,
			squashMerge: true,
			squashMessage: "pr-body",
			squashTitle: "pr-title",
		},
		planning: { agentSuggestions: "full-control" },
		releases: { immutable: true },
		reviews: {
			dismissStale: true,
			requireCodeOwner: true,
			requireConversationResolution: true,
			requireSignedCommits: false,
			requiredApprovals: 1,
			restrictPushes: true,
		},
		rulesets: [],
		secrets: [],
		security: {
			copilotAutofix: false,
			dependabot: true,
			dependencyAutoSubmit: true,
			dependencyGraph: true,
			privateVulnerabilityReporting: true,
			pushProtection: true,
			secretProtection: true,
		},
		signoffRequired: false,
		socialPreview: true,
		variables: [],
		webhooks: [],
		...overrides,
	};
}

function stubGithubBody(body: unknown): Response {
	return {
		headers: { get: () => null },
		ok: true,
		status: 200,
		text: () => Promise.resolve(JSON.stringify(body)),
	} as unknown as Response;
}

describe("github IaC mappings", () => {
	test("github settings require every property explicitly", () => {
		expect(GithubSchema.safeParse({}).success).toBe(false);
		const hyphen = GithubSchema.safeParse({ actions: { allowed: "local-only" } });
		expect(hyphen.success).toBe(false);
		expect(GithubSchema.safeParse(validGithubJson()).success).toBe(true);
		expect(
			GithubSchema.safeParse(
				validGithubJson({
					access: { collaborators: [{ login: "octocat", permission: "push" }], teams: [] },
					actionsPolicies: ["deploy-review"],
					autolinks: [{ prefix: "TICKET-", urlTemplate: "https://jira.example.com/<num>" }],
					codespaces: { devcontainerRequired: false },
					codespacesSecrets: ["CODESPACE_TOKEN"],
					community: { funding: true, readme: true },
					copilot: { codeReview: true },
					customProperties: { tier: "gold" },
					dependabotSecrets: ["DEP_TOKEN"],
					deployKeys: ["ci-key"],
					description: "Test repo",
					environmentProtection: { production: { waitMinutes: 30 } },
					environmentSecrets: { production: ["TOKEN"] },
					features: {
						discussions: false,
						issueTemplates: true,
						issues: { autoClose: true, enabled: true, permissions: "collaborators-only" },
						projects: false,
						pullRequests: { permissions: "collaborators-only" },
						sponsorships: false,
						wiki: false,
					},
					githubApps: ["octoapp"],
					homepage: "https://example.com",
					interactionLimits: { limit: "off" },
					mergeQueue: { enabled: false },
					notificationEmail: "notify@example.com",
					pages: { branch: "gh-pages", enabled: true, path: "/" },
					pullRequestLimits: { maxOpen: 5 },
					requiredWorkflows: [],
					runners: ["self-hosted"],
					tagProtection: ["v*"],
					topics: ["cli", "conform"],
					visibility: "private",
				}),
			).success,
		).toBe(true);
	});

	test("missing security status reads as disabled", async () => {
		const upstream = GithubSchema.parse(validGithubJson());
		const notFound = {
			headers: { get: () => null },
			ok: false,
			status: 404,
			text: () => Promise.resolve(""),
		} as unknown as Response;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => Promise.resolve(notFound)) as unknown as typeof fetch;
		try {
			const results = await checkSecurity("npm-package", "o/r", upstream, "o/r", () =>
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
				GithubSchema.parse(validGithubJson({ secrets: ["A"] })),
				"o/r",
			);
			expect(forSecrets.hint).toContain("gh secret set A");
			const forVariables = await checkSecrets(
				"npm-package",
				"o/r",
				GithubSchema.parse(validGithubJson({ secrets: [], variables: ["V"] })),
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
	test("protection body maps GET-shaped allowances to PUT login lists", () => {
		const team = { id: 1, name: "Core Team", slug: "core", url: "https://api.github.com/x" };
		const user = { id: 2, login: "octocat", url: "https://api.github.com/users/octocat" };
		const app = { id: 3, name: "Bot", slug: "bot" };
		const body = protectionPutBody(
			{
				required_pull_request_reviews: {
					bypass_pull_request_allowances: { apps: [app], teams: [], users: [user] },
					dismissal_restrictions: {
						teams: [team],
						teams_url: "https://api.github.com/t",
						url: "https://api.github.com/d",
						users: [user],
						users_url: "https://api.github.com/u",
					},
				},
				restrictions: { apps: [app], teams: [team], url: "https://api.github.com/r", users: [] },
			},
			{
				branch: "main",
				checks: [],
				dismissStale: false,
				requireApprovals: 1,
				requireCodeOwner: false,
				requireConversationResolution: false,
				requireSignedCommits: false,
				restrictPushes: true,
			},
		);
		expect(body["required_pull_request_reviews"]).toMatchObject({
			bypass_pull_request_allowances: { apps: ["bot"], teams: [], users: ["octocat"] },
			dismissal_restrictions: { teams: ["core"], users: ["octocat"] },
		});
		expect(body["restrictions"]).toEqual({ apps: ["bot"], teams: ["core"], users: [] });
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

	test("disabled or empty github settings pass instead of skipping", async () => {
		const off = GithubSchema.parse(
			validGithubJson({
				actions: {
					allowApprovePRs: false,
					allowed: "all",
					approvalForExternal: true,
					defaultWorkflowPermissions: "read",
					oidcImmutableSubject: false,
					retentionDays: 90,
					shaPinningRequired: true,
				},
				archiveSettings: {
					commitComments: false,
					includeLfsInArchives: false,
					pushUpdateLimit: null,
				},
				codeowners: "",
				environments: [],
				features: {
					discussions: false,
					issueTemplates: false,
					issues: { enabled: true },
					projects: false,
					sponsorships: false,
					wiki: false,
				},
				planning: { agentSuggestions: "disabled" },
				rulesets: [],
				secrets: [],
				security: {
					copilotAutofix: false,
					dependabot: false,
					dependencyAutoSubmit: false,
					dependencyGraph: false,
					privateVulnerabilityReporting: false,
					pushProtection: false,
					secretProtection: false,
				},
				socialPreview: false,
				variables: [],
			}),
		);
		const { checkCodeowners, checkIssueTemplates, checkRulesets } =
			await import("#/core/github/repo.js");
		const { checkActionsOidc, checkEnvironments } = await import("#/core/github/actions.js");
		expect((await checkCodeowners("bp", "o/r", off, "t")).ok).toBe(true);
		expect((await checkIssueTemplates("bp", "o/r", off, "t")).ok).toBe(true);
		expect((await checkRulesets("bp", "o/r", { ...off, rulesets: [] }, "t")).ok).toBe(true);
		expect((await checkEnvironments("bp", "o/r", off, "t")).ok).toBe(true);
		expect((await checkSecrets("bp", "o/r", off, "t")).ok).toBe(true);
		expect((await checkActionsOidc("bp", "o/r", off, "t")).ok).toBe(true);
		expect((await checkWebhooks("bp", "o/r", off, "t")).ok).toBe(true);
	});

	test("webhooks enforce declared hooks and ignore extras", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				stubGithubBody([
					{
						active: true,
						config: { content_type: "json", url: "https://example.com/hook" },
						events: ["push"],
						id: 1,
					},
					{
						active: true,
						config: { content_type: "json", url: "https://example.com/extra" },
						events: ["push"],
						id: 2,
					},
				]),
			)) as unknown as typeof fetch;
		try {
			const matching = GithubSchema.parse(
				validGithubJson({
					webhooks: [
						{
							active: true,
							contentType: "json",
							events: ["push"],
							url: "https://example.com/hook",
						},
					],
				}),
			);
			expect((await checkWebhooks("bp", "o/r", matching, "t")).ok).toBe(true);
			const drifted = GithubSchema.parse(
				validGithubJson({
					webhooks: [
						{
							active: true,
							contentType: "json",
							events: ["push"],
							url: "https://example.com/hook",
						},
						{
							active: false,
							contentType: "json",
							events: ["release"],
							url: "https://example.com/new",
						},
					],
				}),
			);
			const result = await checkWebhooks("bp", "o/r", drifted, "t");
			expect(result.ok).toBe(false);
			expect(result.fix).toMatchObject({ kind: "github-api", label: "github webhooks o/r" });
		} finally {
			globalThis.fetch = originalFetch;
		}
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

	test("new optional settings default to skipped or pass without API calls", async () => {
		const { checkAccess, checkInteractionLimits, checkRequiredWorkflows } =
			await import("#/core/github/access.js");
		const { checkAutolinks } = await import("#/core/github/autolinks.js");
		const { checkCodespaces, checkCommunity, checkDeployKeys, checkTagProtection } =
			await import("#/core/github/community.js");
		const { checkPages } = await import("#/core/github/pages.js");
		const { checkCustomProperties, checkMergeQueue } = await import("#/core/github/repo.js");
		const { checkEnvironmentProtection, checkRunners } = await import("#/core/github/actions.js");
		const empty = GithubSchema.parse(validGithubJson());
		expect((await checkAccess("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkInteractionLimits("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkRequiredWorkflows("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkAutolinks("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkCommunity("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkDeployKeys("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkTagProtection("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkMergeQueue("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkRunners("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkEnvironmentProtection("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkCustomProperties("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkCodespaces("bp", "o/r", empty, "t")).ok).toBe(true);
		expect((await checkPages("bp", "o/r", empty, "t")).ok).toBe(true);
	});

	test("new agent suggestion levels parse and pull-request limits skip with UI hint", async () => {
		for (const level of ["full-control", "cautious", "balanced", "full-automation", "disabled"]) {
			const parsed = GithubSchema.safeParse(
				validGithubJson({ planning: { agentSuggestions: level } }),
			);
			expect(parsed.success).toBe(true);
		}
		expect(
			GithubSchema.safeParse(validGithubJson({ planning: { agentSuggestions: "auto" } })).success,
		).toBe(false);
		const withLimits = GithubSchema.parse(
			validGithubJson({
				actionsPolicies: ["deploy-review"],
				copilot: { codeReview: true, codingAgent: false },
				features: {
					discussions: false,
					issueTemplates: false,
					issues: { autoClose: true, enabled: true, permissions: "collaborators-only" },
					projects: false,
					pullRequests: { permissions: "collaborators-only" },
					sponsorships: true,
					wiki: false,
				},
				githubApps: ["octoapp"],
				pullRequestLimits: { countDrafts: true, maxOpen: 5 },
			}),
		);
		const { runGithubChecks } = await import("#/core/github/index.js");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((url: string | URL | Request) => {
			const path = String(url);
			if (path.includes("/repos/o/r/environments") && !path.includes("/environments/")) {
				return Promise.resolve(stubGithubBody({ environments: [] }));
			}
			return Promise.resolve(stubGithubBody({}));
		}) as unknown as typeof fetch;
		try {
			const techStack = {
				blueprint: (_scope: string, _name: string) =>
					Promise.resolve({ data: withLimits, rel: "github-configs/x.json" }),
			} as unknown as Parameters<typeof runGithubChecks>[0]["techStack"];
			const results = await runGithubChecks({
				state: { blueprint: "bp", repo: "o/r" },
				techStack,
			} as unknown as Parameters<typeof runGithubChecks>[0]);
			const pr = results.find((r) => r.id === "github:bp:pull-request-limits");
			expect(pr?.skipped).toBe(true);
			expect(pr?.actual).toContain("Pull request limits");
			for (const id of [
				"github:bp:auto-close",
				"github:bp:issue-permissions",
				"github:bp:pr-permissions",
				"github:bp:actions-policies",
				"github:bp:copilot",
				"github:bp:github-apps",
				"github:bp:sponsorships",
			]) {
				expect(results.find((r) => r.id === id)?.skipped).toBe(true);
			}
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("agents secrets and variables are presence-checked manually", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((url: string | URL | Request) => {
			const path = String(url);
			if (path.includes("/agents/secrets")) {
				return Promise.resolve(stubGithubBody({ secrets: [{ name: "HAVE_SECRET" }] }));
			}
			if (path.includes("/agents/variables")) {
				return Promise.resolve(stubGithubBody({ variables: [{ name: "HAVE_VAR" }] }));
			}
			if (path.includes("/actions/secrets")) {
				return Promise.resolve(stubGithubBody({ secrets: [] }));
			}
			return Promise.resolve(stubGithubBody({ variables: [] }));
		}) as unknown as typeof fetch;
		try {
			const present = GithubSchema.parse(
				validGithubJson({ agentsSecrets: ["HAVE_SECRET"], agentsVariables: ["HAVE_VAR"] }),
			);
			expect((await checkSecrets("bp", "o/r", present, "t")).ok).toBe(true);
			const missing = GithubSchema.parse(
				validGithubJson({ agentsSecrets: ["NEED_SECRET"], agentsVariables: ["NEED_VAR"] }),
			);
			const result = await checkSecrets("bp", "o/r", missing, "t");
			expect(result.ok).toBe(false);
			expect(result.fix).toBeUndefined();
			expect(result.hint).toContain("--app agents");
			expect(result.actual).toContain("agents-secret:NEED_SECRET");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("sponsorships off passes instead of skipping", async () => {
		const { runGithubChecks } = await import("#/core/github/index.js");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((url: string | URL | Request) => {
			const path = String(url);
			if (path.includes("/repos/o/r/environments") && !path.includes("/environments/")) {
				return Promise.resolve(stubGithubBody({ environments: [] }));
			}
			return Promise.resolve(stubGithubBody({}));
		}) as unknown as typeof fetch;
		try {
			const techStack = {
				blueprint: (_scope: string, _name: string) =>
					Promise.resolve({ data: GithubSchema.parse(validGithubJson()), rel: "x.json" }),
			} as unknown as Parameters<typeof runGithubChecks>[0]["techStack"];
			const results = await runGithubChecks({
				state: { blueprint: "bp", repo: "o/r" },
				techStack,
			} as unknown as Parameters<typeof runGithubChecks>[0]);
			expect(results.find((r) => r.id === "github:bp:sponsorships")?.ok).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

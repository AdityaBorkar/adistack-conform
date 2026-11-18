import { afterEach, describe, expect, test } from "bun:test";

import { checkInteractionLimits } from "#/core/github/access.js";
import { checkActionsOidc, checkEnvironmentProtection } from "#/core/github/actions.js";
import { checkCopilotCloud } from "#/core/github/copilot.js";
import { protectionPutBody } from "#/core/github/protection.js";
import { checkGeneral } from "#/core/github/repo.js";
import { checkRulesets, rulesFromApi, rulesetBody, rulesetDrift } from "#/core/github/rulesets.js";
import type { Ruleset } from "#/core/github/rulesets.js";
import {
	checkDependencyGraph,
	checkSecrets,
	checkSecurity,
	isPrivateVulnEnabled,
} from "#/core/github/security.js";
import { checkWebhooks } from "#/core/github/webhooks.js";
import type { CheckResult, GithubApiFix } from "#/core/result.js";
import { ConformSchema } from "#/schemas/config.js";
import { GithubSchema } from "#/schemas/github-settings.js";

const source = { ref: "main", repo: "o/r", type: "github" } as const;

const pull_requests = {
	auto_merge: false,
	delete_head_branches: true,
	merge_commit: false,
	merge_message: "pr-body",
	merge_title: "pr-title",
	rebase_merge: false,
	squash_merge: true,
	squash_message: "pr-body",
	squash_title: "pr-title",
};

type Json = Record<string, unknown>;

function validGithubJson(
	overrides: { cpa?: Json; general?: Json; sq?: Json; top?: Json } = {},
): Json {
	const { cpa = {}, general = {}, sq = {}, top = {} } = overrides;
	const { community: topCommunity, ...topRest } = top as Json & { community?: Json };
	return {
		actions: {
			general: {
				allowed: "all",
				fork_pr_approval: "all_external_contributors",
				retention_days: 90,
				sha_pinning_required: true,
				workflow_permissions: { can_approve_pull_requests: false, default: "read" },
			},
		},
		environments: {},
		webhooks: [],
		...cpa,
		archives: { include_lfs_objects: false },
		commits: { comments_allowed: false, signoff_required: false },
		default_branch: "main",
		features: {
			discussions: false,
			issues: { enabled: true },
			projects: false,
			sponsorships: false,
			wikis: { enabled: false },
		},
		pull_requests,
		pushes: { update_limit: null },
		releases: { immutable: true },
		social_preview: false,
		...general,
		advanced_security: {
			automatic_dependency_submission: "disabled",
			code_scanning: { copilot_autofix: false },
			dependabot: { alerts: true, security_updates: true },
			dependency_graph: true,
			private_vulnerability_reporting: { enabled: true },
			secret_protection: { enabled: true, push_protection: true },
		},
		secrets: { actions: { secrets: [], variables: [] } },
		...sq,
		...topRest,
		...(topCommunity as Json | undefined),
	};
}

const steps = (result: CheckResult | undefined) => (result?.fix as GithubApiFix | undefined)?.steps;

const withCopilot = (copilot: Json) => parse({ cpa: { copilot } });

const env = (production: Json) => parse({ cpa: { environments: { production } } });

const parse = (overrides?: Parameters<typeof validGithubJson>[0]) =>
	GithubSchema.parse(validGithubJson(overrides));

function stubGithubBody(body: unknown, status = 200): Response {
	return {
		headers: { get: () => null },
		ok: status < 300,
		status,
		text: () => Promise.resolve(status === 204 ? "" : JSON.stringify(body)),
	} as unknown as Response;
}

const originalFetch = globalThis.fetch;
const calls: Array<{ method: string; path: string }> = [];

// Routes by URL substring (first match wins); unmatched paths return {}.
function mockFetch(routes: Array<[string, unknown, number?]>): void {
	calls.length = 0;
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const path = String(url);
		calls.push({ method: init?.method ?? "GET", path });
		const hit = routes.find(([part]) => path.includes(part));
		return Promise.resolve(stubGithubBody(hit?.[1] ?? {}, hit?.[2]));
	}) as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function runAll(data: unknown) {
	const { runGithubChecks } = await import("#/core/github/index.js");
	const techStack = {
		blueprint: () => Promise.resolve({ data, rel: "github-configs/x.json" }),
	} as unknown as Parameters<typeof runGithubChecks>[0]["techStack"];
	return runGithubChecks({
		state: { blueprint: "bp", repo: "o/r" },
		techStack,
	} as unknown as Parameters<typeof runGithubChecks>[0]);
}

// The live "Protect Branches" ruleset (GET /rulesets/{id}).
const liveRuleset = {
	bypass_actors: [],
	conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH", "refs/heads/main"] } },
	enforcement: "active",
	id: 7,
	name: "Protect Branches",
	rules: [
		{ type: "deletion" },
		{ type: "required_linear_history" },
		{
			parameters: {
				allowed_merge_methods: ["squash"],
				dismiss_stale_reviews_on_push: true,
				require_code_owner_review: true,
				require_extra_approval_for_unattributed_changes: true,
				require_last_push_approval: false,
				required_approving_review_count: 0,
				required_review_thread_resolution: false,
				required_reviewers: [],
			},
			type: "pull_request",
		},
	],
	target: "branch",
};

const wantRuleset: Ruleset = {
	enforcement: "active",
	include: ["refs/heads/main", "~DEFAULT_BRANCH"],
	name: "Protect Branches",
	rules: {
		deletion: true,
		pull_request: {
			allowed_merge_methods: ["squash"],
			dismiss_stale: true,
			require_code_owner: true,
			require_conversation_resolution: false,
			require_last_push_approval: false,
			required_approvals: 0,
		},
		required_linear_history: true,
	},
	target: "branch",
};

describe("github settings schema", () => {
	test("requires the flat top-level shape and rejects unknown keys", () => {
		expect(GithubSchema.safeParse({}).success).toBe(false);
		expect(GithubSchema.safeParse(validGithubJson()).success).toBe(true);
		expect(
			GithubSchema.safeParse({ ...validGithubJson(), checks: [], default_branch: "main" }).success,
		).toBe(false);
		expect(
			GithubSchema.safeParse(
				validGithubJson({
					top: { access: { moderation: { interaction_limits: { limit: "contributors" } } } },
				}),
			).success,
		).toBe(false);
	});

	test("accepts every optional section", () => {
		const full = validGithubJson({
			cpa: {
				actions: {
					general: {
						access_level: "none",
						allowed: "selected",
						cache: { retention_days: 7 },
						enabled: true,
						fork_pr_approval: "first_time_contributors",
						fork_pr_workflows_private: {
							require_approval: true,
							run_workflows: false,
							send_secrets: false,
							send_write_tokens: false,
						},
						retention_days: 30,
						selected: { github_owned: true, patterns: ["owner/*"] },
						sha_pinning_required: true,
						workflow_permissions: { can_approve_pull_requests: false, default: "read" },
					},
					oidc: { immutable_subject: true, use_default: true },
					policies: ["deploy-review"],
					runners: ["self-hosted"],
				},
				branches: {
					required_status_checks: ["conform"],
					reviews: {
						dismiss_stale: true,
						require_code_owner: true,
						require_conversation_resolution: true,
						require_signed_commits: false,
						required_approvals: 1,
						restrict_pushes: false,
					},
					strict_status_checks: true,
				},
				codespaces: {
					devcontainer_required: false,
					prebuilds: [{ branch: "main", trigger: "push" }],
				},
				copilot: {
					cloud: { automations: { enabled: true }, validation_tools: { codeql: true } },
					code_review: { mcp_enabled: true, review_effort: "inherit" },
					internet_access: { cloud: { firewall: true } },
					mcp: { configuration: null },
					memory: { enabled: true },
				},
				environments: {
					production: {
						admin_bypass: false,
						secrets: ["TOKEN"],
						variables: ["URL"],
						wait_minutes: 30,
					},
					staging: {},
				},
				pages: { branch: "gh-pages", build_type: "legacy", enabled: true, path: "/" },
				planning: { agent_suggestions: "balanced" },
				rulesets: [wantRuleset],
				webhooks: [],
			},
			general: {
				archives: { include_lfs_objects: false },
				commits: { comments_allowed: false, signoff_required: false },
				custom_properties: { tier: "gold" },
				danger_zone: { allow_forking: false, archived: false, visibility: "private" },
				default_branch: "main",
				description: "Test repo",
				features: {
					discussions: false,
					issues: { auto_close: true, enabled: true, permissions: "collaborators-only" },
					projects: false,
					sponsorships: false,
					wikis: { enabled: false, restrict_editing_to_collaborators: true },
				},
				homepage: "https://example.com",
				pull_requests: { ...pull_requests, permissions: "collaborators-only" },
				pushes: { update_limit: null },
				releases: { immutable: true },
				social_preview: false,
				template_repository: false,
				topics: ["cli"],
			},
			top: {
				access: {
					collaborators: [{ login: "octocat", permission: "push" }],
					moderation: {
						code_review_limits: { restrict_to_explicit_access: false },
						interaction_limits: { expiry: "one_week", limit: "contributors_only" },
						pull_request_limits: { max_open: 5 },
					},
				},
				community: { codeowners: ".github/CODEOWNERS", issue_templates: true, readme: true },
				integrations: {
					autolinks: [{ prefix: "TICKET-", url_template: "https://jira.example.com/<num>" }],
					email_notifications: { addresses: ["notify@example.com"] },
					github_apps: ["octoapp"],
				},
			},
		});
		const parsed = GithubSchema.safeParse(full);
		expect(parsed.error).toBeUndefined();
	});
});

describe("github check mappings", () => {
	test("missing security status reads as disabled", async () => {
		mockFetch([["", {}, 404]]);
		const result = await checkSecurity("bp", "o/r", parse(), "o/r", () => Promise.resolve({}));
		expect(result.actual).toContain("secret_scanning: disabled → enabled");
	});

	test("secrets hint names the right CLI for the missing kind", async () => {
		mockFetch([
			["/actions/secrets", { secrets: [] }],
			["/agents/secrets", { secrets: [{ name: "HAVE" }] }],
			["/environments/production/variables", { variables: [] }],
			["", { variables: [] }],
		]);
		const secrets = (actions: Json, extra: Json = {}) =>
			parse({ sq: { secrets: { actions, ...extra } } });
		const forSecrets = await checkSecrets(
			"bp",
			"o/r",
			secrets({ secrets: ["A"], variables: [] }),
			"t",
		);
		expect(forSecrets.hint).toContain("gh secret set A");
		const forVariables = await checkSecrets(
			"bp",
			"o/r",
			secrets({ secrets: [], variables: ["V"] }),
			"t",
		);
		expect(forVariables.hint).toContain("gh variable set V");
		const agents = await checkSecrets(
			"bp",
			"o/r",
			secrets({ secrets: [], variables: [] }, { agents: { secrets: ["HAVE", "NEED"] } }),
			"t",
		);
		expect(agents.fix).toBeUndefined();
		expect(agents.actual).toBe("missing: agents-secret:NEED");
		expect(agents.hint).toContain("--app agents");
		const envVars = await checkSecrets(
			"bp",
			"o/r",
			parse({ cpa: { environments: { production: { variables: ["URL"] } } } }),
			"t",
		);
		expect(envVars.actual).toBe("missing: env-variable:production:URL");
		expect(envVars.hint).toContain("--env production");
	});

	test("protection body maps checks and keeps unknown fields unless pinned", () => {
		const body = protectionPutBody(undefined, {
			branch: "stable",
			checks: ["conform"],
			dismiss_stale: true,
			require_code_owner: true,
			require_conversation_resolution: true,
			require_signed_commits: false,
			required_approvals: 1,
			restrict_pushes: false,
		});
		expect(body["restrictions"]).toBeNull();
		expect(body["enforce_admins"]).toBe(true);
		expect(body["required_status_checks"]).toEqual({
			checks: [{ context: "conform" }],
			strict: false,
		});
		const pinned = protectionPutBody(
			{ allow_force_pushes: { enabled: true }, required_linear_history: { enabled: true } },
			{
				allow_force_pushes: false,
				branch: "main",
				checks: [],
				dismiss_stale: false,
				require_code_owner: false,
				require_conversation_resolution: false,
				require_signed_commits: false,
				required_approvals: 0,
				restrict_pushes: false,
				strict: true,
			},
		);
		expect(pinned["allow_force_pushes"]).toBe(false);
		expect(pinned["required_linear_history"]).toBe(true);
		expect(pinned["required_status_checks"]).toEqual({ checks: [], strict: true });
	});

	test("protection body maps GET-shaped allowances to PUT login lists", () => {
		const team = { id: 1, name: "Core Team", slug: "core", url: "https://api.github.com/x" };
		const user = { id: 2, login: "octocat", url: "https://api.github.com/users/octocat" };
		const app = { id: 3, name: "Bot", slug: "bot" };
		const body = protectionPutBody(
			{
				required_pull_request_reviews: {
					bypass_pull_request_allowances: { apps: [app], teams: [], users: [user] },
					dismissal_restrictions: { teams: [team], url: "https://api.github.com/d", users: [user] },
				},
				restrictions: { apps: [app], teams: [team], url: "https://api.github.com/r", users: [] },
			},
			{
				branch: "main",
				checks: [],
				dismiss_stale: false,
				require_code_owner: false,
				require_conversation_resolution: false,
				require_signed_commits: false,
				required_approvals: 1,
				restrict_pushes: true,
			},
		);
		expect(body["required_pull_request_reviews"]).toMatchObject({
			bypass_pull_request_allowances: { apps: ["bot"], teams: [], users: ["octocat"] },
			dismissal_restrictions: { teams: ["core"], users: ["octocat"] },
		});
		expect(body["restrictions"]).toEqual({ apps: ["bot"], teams: ["core"], users: [] });
	});

	test("private vulnerability reporting reads the enabled flag", () => {
		expect(isPrivateVulnEnabled({ enabled: true })).toBe(true);
		expect(isPrivateVulnEnabled({ enabled: false })).toBe(false);
		expect(isPrivateVulnEnabled()).toBe(false);
	});

	test("unmanaged or empty sections pass or report nothing, without API calls", async () => {
		mockFetch([]);
		const empty = parse();
		const { checkAccess } = await import("#/core/github/access.js");
		const { checkActionsCache, checkEnvironments, checkRunners } =
			await import("#/core/github/actions.js");
		const { checkAutolinks } = await import("#/core/github/autolinks.js");
		const { checkCodespaces, checkCommunity, checkDeployKeys } =
			await import("#/core/github/community.js");
		const { checkPages } = await import("#/core/github/pages.js");
		const { checkCodeowners, checkCustomProperties, checkIssueTemplates } =
			await import("#/core/github/repo.js");
		const passing: Array<Promise<CheckResult>> = [];
		const unmanaged: Array<Promise<CheckResult | undefined> | undefined> = [];
		for (const check of [
			checkAccess,
			checkAutolinks,
			checkCodeowners,
			checkCodespaces,
			checkCommunity,
			checkCustomProperties,
			checkEnvironmentProtection,
			checkEnvironments,
			checkIssueTemplates,
			checkRunners,
			checkSecrets,
			checkWebhooks,
		]) {
			passing.push(check("bp", "o/r", empty, "t"));
		}
		for (const check of [
			checkActionsCache,
			checkActionsOidc,
			checkDeployKeys,
			checkInteractionLimits,
			checkPages,
			checkRulesets,
		]) {
			unmanaged.push(check("bp", "o/r", empty, "t"));
		}
		expect((await Promise.all(passing)).every((result) => result.ok)).toBe(true);
		expect((await Promise.all(unmanaged)).filter((result) => result !== undefined)).toEqual([]);
		expect(calls).toEqual([]);
	});

	test("webhooks enforce declared hooks, ignore extras, and send insecure_ssl", async () => {
		mockFetch([
			[
				"/hooks",
				[
					{
						active: true,
						config: { content_type: "json", insecure_ssl: "0", url: "https://example.com/hook" },
						events: ["push"],
						id: 1,
					},
					{ active: true, config: { url: "https://example.com/extra" }, events: ["push"], id: 2 },
				],
			],
		]);
		const hook = {
			active: true,
			content_type: "json",
			events: ["push"],
			url: "https://example.com/hook",
		};
		expect((await checkWebhooks("bp", "o/r", parse({ cpa: { webhooks: [hook] } }), "t")).ok).toBe(
			true,
		);
		const result = await checkWebhooks(
			"bp",
			"o/r",
			parse({ cpa: { webhooks: [{ ...hook, insecure_ssl: true }] } }),
			"t",
		);
		expect(result.actual).toContain("insecure_ssl: 0 → 1");
		expect((result.fix as GithubApiFix).steps[0]).toMatchObject({
			body: { config: { insecure_ssl: "1" } },
			method: "PATCH",
		});
	});

	test("conform.json keeps github.repo and requires a blueprint", () => {
		const parsed = ConformSchema.safeParse({
			github: { blueprint: "npm-package", repo: "o/r" },
			source,
		});
		expect(parsed.success).toBe(true);
		expect(ConformSchema.safeParse({ github: {}, source }).success).toBe(false);
		expect(ConformSchema.safeParse({ github: { blueprint: "" }, source }).success).toBe(false);
	});
});

describe("rulesets", () => {
	test("general omits merge titles when merge commits are disabled (no_merge_strategy)", async () => {
		mockFetch([["/topics", { names: [] }]]);
		const upstream = parse();
		// Live has merge disabled but stale titles: no PATCH for titles.
		const disabled = await checkGeneral("bp", "o/r", upstream, "t", () =>
			Promise.resolve({
				allow_auto_merge: false,
				allow_merge_commit: false,
				allow_rebase_merge: false,
				allow_squash_merge: true,
				allow_update_branch: false,
				default_branch: "main",
				delete_branch_on_merge: true,
				has_discussions: false,
				has_issues: true,
				has_projects: false,
				has_pull_requests: true,
				has_wiki: false,
				merge_commit_message: "BLANK",
				merge_commit_title: "MERGE_MESSAGE",
				squash_merge_commit_message: "PR_BODY",
				squash_merge_commit_title: "PR_TITLE",
				web_commit_signoff_required: false,
			}),
		);
		expect(disabled.ok).toBe(true);
		// Live has merge enabled, want disabled: PATCH disables without titles.
		const enabled = await checkGeneral("bp", "o/r", upstream, "t", () =>
			Promise.resolve({
				allow_auto_merge: false,
				allow_merge_commit: true,
				allow_rebase_merge: false,
				allow_squash_merge: true,
				allow_update_branch: false,
				default_branch: "main",
				delete_branch_on_merge: true,
				has_discussions: false,
				has_issues: true,
				has_projects: false,
				has_pull_requests: true,
				has_wiki: false,
				merge_commit_message: "BLANK",
				merge_commit_title: "MERGE_MESSAGE",
				squash_merge_commit_message: "PR_BODY",
				squash_merge_commit_title: "PR_TITLE",
				web_commit_signoff_required: false,
			}),
		);
		const body = (steps(enabled)?.[0]?.body ?? {}) as Record<string, unknown>;
		expect(body["allow_merge_commit"]).toBe(false);
		expect("merge_commit_title" in body).toBe(false);
		expect("merge_commit_message" in body).toBe(false);
	});
	test("live rules normalise to the manifest shape and match the declared ruleset", () => {
		expect(rulesFromApi(liveRuleset.rules)).toMatchObject({
			deletion: true,
			pull_request: { allowed_merge_methods: ["squash"], require_extra_approval_for_copilot: true },
			required_linear_history: true,
		});
		expect(rulesetDrift(wantRuleset, liveRuleset)).toEqual([]);
	});

	test("undeclared, missing, or changed rules drift", () => {
		const { deletion: _, ...withoutDeletion } = wantRuleset.rules;
		expect(rulesetDrift({ ...wantRuleset, rules: withoutDeletion }, liveRuleset)).toEqual([
			"rules.deletion",
		]);
		expect(
			rulesetDrift(
				{
					...wantRuleset,
					enforcement: "disabled",
					rules: { ...wantRuleset.rules, non_fast_forward: true },
				},
				liveRuleset,
			),
		).toEqual(["enforcement", "rules.non_fast_forward"]);
		expect(
			rulesetDrift({ ...wantRuleset, exclude: ["refs/heads/x"], include: ["~ALL"] }, liveRuleset),
		).toEqual(["include", "exclude"]);
	});

	test("fix body maps manifest rules back to API rule params", () => {
		const body = rulesetBody({
			...wantRuleset,
			bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
			rules: {
				...wantRuleset.rules,
				code_scanning: [{ alerts: "errors", security_alerts: "high_or_higher", tool: "CodeQL" }],
				required_status_checks: { checks: [{ context: "ci", integration_id: 1 }], strict: true },
			},
		});
		expect(body).toMatchObject({
			bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
			conditions: { ref_name: { exclude: [], include: wantRuleset.include } },
		});
		expect(body["rules"]).toContainEqual({
			parameters: {
				code_scanning_tools: [
					{
						alerts_threshold: "errors",
						security_alerts_threshold: "high_or_higher",
						tool: "CodeQL",
					},
				],
			},
			type: "code_scanning",
		});
		expect(body["rules"]).toContainEqual({
			parameters: {
				required_status_checks: [{ context: "ci", integration_id: 1 }],
				strict_required_status_checks_policy: true,
			},
			type: "required_status_checks",
		});
		// Round trip: what the fix sends normalises back to what was declared.
		expect(
			rulesetDrift(wantRuleset, { ...liveRuleset, rules: rulesetBody(wantRuleset)["rules"] }),
		).toEqual([]);
	});

	test("check POSTs missing rulesets and PUTs drifted ones", async () => {
		mockFetch([
			["/rulesets/7", { ...liveRuleset, enforcement: "disabled" }],
			["/rulesets?", [{ id: 7, name: "Protect Branches" }]],
		]);
		const tags: Ruleset = {
			enforcement: "active",
			include: ["~ALL"],
			name: "Tags",
			rules: { deletion: true },
			target: "tag",
		};
		const result = await checkRulesets(
			"bp",
			"o/r",
			parse({ cpa: { rulesets: [wantRuleset, tags] } }),
			"t",
		);
		expect(result?.actual).toBe("Protect Branches: enforcement; Tags: missing");
		expect((steps(result) ?? []).map((step) => `${step.method} ${step.path}`)).toEqual([
			"PUT /repos/o/r/rulesets/7",
			"POST /repos/o/r/rulesets",
		]);
	});
});

describe("new checks", () => {
	test("interaction limits fix PUTs the API enum or DELETEs for off", async () => {
		mockFetch([["/interaction-limits", {}]]);
		const on = await checkInteractionLimits(
			"bp",
			"o/r",
			parse({
				top: {
					access: {
						moderation: { interaction_limits: { expiry: "one_day", limit: "collaborators_only" } },
					},
				},
			}),
			"t",
		);
		expect(on?.actual).toBe("interaction limits: off → collaborators_only");
		expect(steps(on)).toEqual([
			{
				body: { expiry: "one_day", limit: "collaborators_only" },
				method: "PUT",
				path: "/repos/o/r/interaction-limits",
			},
		]);
		mockFetch([["/interaction-limits", { limit: "existing_users" }]]);
		const off = await checkInteractionLimits(
			"bp",
			"o/r",
			parse({ top: { access: { moderation: { interaction_limits: { limit: "off" } } } } }),
			"t",
		);
		expect(steps(off)).toEqual([{ method: "DELETE", path: "/repos/o/r/interaction-limits" }]);
	});

	test("dependency graph no longer reads Dependabot alerts", async () => {
		mockFetch([]);
		const upstream = parse();
		const pub = await checkDependencyGraph("bp", upstream, "t", () =>
			Promise.resolve({ private: false }),
		);
		expect(pub.ok).toBe(true);
		const priv = await checkDependencyGraph("bp", upstream, "t", () =>
			Promise.resolve({ private: true }),
		);
		expect(priv.skipped).toBe(true);
		expect(priv.actual).toContain("Dependency graph");
		expect(calls).toEqual([]);
	});

	test("copilot cloud config is READ: drift is manual with the Settings path", async () => {
		mockFetch([
			[
				"/copilot/cloud-agent/configuration",
				{ custom_allowlist: [], enabled_tools: { codeql: true }, is_firewall_enabled: true },
			],
		]);
		const ok = await checkCopilotCloud(
			"bp",
			"o/r",
			withCopilot({
				cloud: { validation_tools: { codeql: true } },
				internet_access: { cloud: { custom_allowlist: [] } },
			}),
			"t",
		);
		expect(ok?.ok).toBe(true);
		const drift = await checkCopilotCloud(
			"bp",
			"o/r",
			withCopilot({ internet_access: { cloud: { firewall: false } } }),
			"t",
		);
		expect(drift?.fix).toBeUndefined();
		expect(drift?.actual).toBe("is_firewall_enabled: true → false");
		expect(drift?.hint).toContain("Settings → Copilot → Internet access → Copilot in the cloud");
		expect(
			await checkCopilotCloud("bp", "o/r", withCopilot({ memory: { enabled: true } }), "t"),
		).toBeUndefined();
	});

	test("MCP config compares deeply, ignoring key order", async () => {
		mockFetch([
			[
				"/copilot/cloud-agent/configuration",
				// Live key order differs from the manifest's.
				{ mcp_configuration: JSON.parse('{"mcpServers":{"a":{"command":"npx","args":["x"]}}}') },
			],
		]);
		const ok = await checkCopilotCloud(
			"bp",
			"o/r",
			withCopilot({
				mcp: { configuration: { mcpServers: { a: { args: ["x"], command: "npx" } } } },
			}),
			"t",
		);
		expect(ok?.ok).toBe(true);
	});

	test("OIDC immutable subject is API-fixable", async () => {
		mockFetch([["/actions/oidc", { use_default: true, use_immutable_subject: false }]]);
		const result = await checkActionsOidc(
			"bp",
			"o/r",
			parse({
				cpa: {
					actions: {
						general: {
							allowed: "all",
							fork_pr_approval: "all_external_contributors",
							retention_days: 90,
							sha_pinning_required: true,
							workflow_permissions: { can_approve_pull_requests: false, default: "read" },
						},
						oidc: { immutable_subject: true, use_default: true },
					},
				},
			}),
			"t",
		);
		expect(steps(result)).toEqual([
			{
				body: { use_default: true, use_immutable_subject: true },
				method: "PUT",
				path: "/repos/o/r/actions/oidc/customization/sub",
			},
		]);
	});

	test("environment reviewers match by type and name; admin bypass is manual", async () => {
		mockFetch([
			[
				"/environments/production",
				{
					can_admins_bypass: true,
					protection_rules: [{ reviewers: [{ reviewer: { login: "octocat" }, type: "User" }] }],
				},
			],
		]);
		const ok = await checkEnvironmentProtection(
			"bp",
			"o/r",
			env({ required_reviewers: [{ name: "octocat", type: "user" }] }),
			"t",
		);
		expect(ok.ok).toBe(true);
		const bypass = await checkEnvironmentProtection("bp", "o/r", env({ admin_bypass: false }), "t");
		expect(bypass.fix).toBeUndefined();
		expect(bypass.actual).toContain("admin bypass: true → false");
	});

	test("environment PUT keeps live reviewers when only the wait timer drifts", async () => {
		mockFetch([
			[
				"/environments/production",
				{
					protection_rules: [
						{ reviewers: [{ reviewer: { id: 7, login: "octocat" }, type: "User" }] },
					],
				},
			],
		]);
		const result = await checkEnvironmentProtection("bp", "o/r", env({ wait_minutes: 30 }), "t");
		expect(steps(result)?.[0]?.body).toEqual({
			deployment_branch_policy: null,
			prevent_self_review: false,
			reviewers: [{ id: 7, type: "User" }],
			wait_timer: 30,
		});
	});

	test("UI-only items pass when off and skip with a Settings path when on", async () => {
		mockFetch([["/repos/o/r/environments", { environments: [] }]]);
		const off = await runAll(
			parse({
				top: {
					access: { moderation: { code_review_limits: { restrict_to_explicit_access: false } } },
				},
			}),
		);
		for (const id of ["code-review-limits", "sponsorships", "social-preview", "copilot-autofix"]) {
			expect(off.find((r) => r.id === `github:bp:${id}`)?.ok).toBe(true);
		}
		// Unmanaged sections report nothing.
		expect(off.find((r) => r.id === "github:bp:pr-checks")).toBeUndefined();
		expect(off.find((r) => r.id === "github:bp:copilot")).toBeUndefined();
		const on = await runAll(
			parse({
				cpa: {
					actions: {
						general: {
							allowed: "all",
							fork_pr_approval: "all_external_contributors",
							retention_days: 90,
							sha_pinning_required: true,
							workflow_permissions: { can_approve_pull_requests: false, default: "read" },
						},
						policies: ["deploy-review"],
					},
					copilot: { memory: { enabled: true } },
					planning: { agent_suggestions: "full-automation" },
				},
				general: {
					archives: { include_lfs_objects: false },
					commits: { comments_allowed: false, signoff_required: false },
					default_branch: "main",
					features: {
						discussions: false,
						issues: { auto_close: true, enabled: true, permissions: "collaborators-only" },
						projects: false,
						sponsorships: true,
						wikis: { enabled: false },
					},
					pull_requests: { ...pull_requests, permissions: "collaborators-only" },
					pushes: { update_limit: null },
					releases: { immutable: true },
					social_preview: false,
				},
				top: {
					access: {
						moderation: {
							code_review_limits: { restrict_to_explicit_access: true },
							pull_request_limits: { count_drafts: true, max_open: 5 },
						},
					},
					integrations: { github_apps: ["octoapp"] },
				},
			}),
		);
		const limits = on.find((r) => r.id === "github:bp:code-review-limits");
		expect(limits?.skipped).toBe(true);
		expect(limits?.actual).toBe("confirm in Settings → Access → Moderation → Code review limits");
		expect(on.find((r) => r.id === "github:bp:pull-request-limits")?.actual).toContain(
			"Pull request limits",
		);
		for (const id of [
			"auto-close",
			"issue-permissions",
			"actions-policies",
			"copilot",
			"agent-suggestions",
			"github-apps",
			"sponsorships",
		]) {
			expect(on.find((r) => r.id === `github:bp:${id}`)?.skipped).toBe(true);
		}
	});
});

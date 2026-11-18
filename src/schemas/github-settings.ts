import * as z from "zod";

// Flat top-level manifest in Settings sidebar order (ADR 0015): general
// fields (/settings) → access (/settings/access + Moderation) → code,
// planning, and automation fields (Rulesets, Branches, Actions, Webhooks,
// Copilot, Planning, Environments, Codespaces, Pages) → security and quality
// fields (Advanced Security, Deploy keys, Secrets and variables) →
// integrations (GitHub Apps, Autolinks, Email notifications) → community
// files (repo contents, not a Settings page). Key order below is that
// sidebar order (sort-keys is off for this file).
// Each leaf's describe names its UI path and how conform handles it:
// API = checked and fixed via REST; READ = checked via REST, fix is manual;
// UI = no API, passes when off/default, otherwise skipped with a Settings hint.
// Optional (omit = not managed, no result). Name/transfer/delete are not
// fields: rename breaks the target, transfer/delete are destructive.

const permission = z.enum(["pull", "triage", "push", "maintain", "admin"]);
const names = z.array(z.string().min(1));
const audience = z.enum(["all-users", "collaborators-only"]);

const general = z
	.object({
		description: z
			.string()
			.max(350)
			.describe("General → About → Description. API: PATCH description. Omit to skip.")
			.optional(),
		homepage: z
			.string()
			.max(2048)
			.describe("General → About → Website. API: PATCH homepage (empty clears). Omit to skip.")
			.optional(),
		topics: z
			.array(z.string().min(1).max(50))
			.max(20)
			.describe("General → About → Topics. API: PUT /topics (replace-all). Omit to skip.")
			.optional(),
		template_repository: z
			.boolean()
			.describe("General → Template repository. API: PATCH is_template. Omit to skip.")
			.optional(),
		default_branch: z
			.string()
			.min(1)
			.describe("General → Default branch. API: PATCH default_branch."),
		releases: z
			.object({
				immutable: z
					.boolean()
					.describe(
						"General → Releases → Enable release immutability. API: PUT/DELETE /immutable-releases.",
					),
			})
			.strict()
			.describe("General → Releases."),
		social_preview: z
			.boolean()
			.describe(
				"General → Social preview (custom image set). UI: pass when false, skipped with a hint when true.",
			),
		features: z
			.object({
				wikis: z
					.object({
						enabled: z.boolean().describe("General → Features → Wikis. API: PATCH has_wiki."),
						restrict_editing_to_collaborators: z
							.boolean()
							.describe(
								"General → Features → Wikis → Restrict editing to collaborators only. UI: pass when false.",
							)
							.optional(),
					})
					.strict()
					.describe("General → Features → Wikis."),
				issues: z
					.object({
						enabled: z.boolean().describe("General → Features → Issues. API: PATCH has_issues."),
						permissions: audience
							.describe(
								"General → Features → Issues → Issue permissions (creation allowed by). UI: skipped with a hint when set.",
							)
							.optional(),
						auto_close: z
							.boolean()
							.describe(
								"General → Issues → Auto-close issues with merged linked pull requests. UI: skipped with a hint when set.",
							)
							.optional(),
					})
					.strict()
					.describe("General → Features → Issues (plus the page's Issues section)."),
				sponsorships: z
					.boolean()
					.describe(
						"General → Features → Sponsorships (Sponsor button). UI: pass when false, skipped with a hint when true.",
					),
				preserve_repository: z
					.boolean()
					.describe(
						"General → Features → Preserve this repository (Archive Program). UI: skipped with a hint when set.",
					)
					.optional(),
				discussions: z
					.boolean()
					.describe(
						"General → Features → Discussions. READ: has_discussions (no PATCH field; toggle in the UI).",
					),
				projects: z.boolean().describe("General → Features → Projects. API: PATCH has_projects."),
			})
			.strict()
			.describe("General → Features, in page order."),
		pull_requests: z
			.object({
				enabled: z
					.boolean()
					.describe(
						"General → Features → Pull requests. API: PATCH has_pull_requests. Omit to skip.",
					)
					.optional(),
				permissions: audience
					.describe(
						"General → Features → Pull requests → PR permissions (creation allowed by). API: PATCH pull_request_creation_policy. Omit to skip.",
					)
					.optional(),
				merge_commit: z
					.boolean()
					.describe("General → Pull Requests → Allow merge commits. API: allow_merge_commit."),
				merge_title: z
					.enum(["merge-message", "pr-title"])
					.describe(
						"General → Pull Requests → merge commit default title. API: merge_commit_title.",
					),
				merge_message: z
					.enum(["blank", "pr-body", "pr-title"])
					.describe(
						"General → Pull Requests → merge commit default message. API: merge_commit_message.",
					),
				squash_merge: z
					.boolean()
					.describe("General → Pull Requests → Allow squash merging. API: allow_squash_merge."),
				squash_title: z
					.enum(["commit-title", "pr-title"])
					.describe(
						"General → Pull Requests → squash default title. API: squash_merge_commit_title.",
					),
				squash_message: z
					.enum(["blank", "commit-messages", "pr-body"])
					.describe(
						"General → Pull Requests → squash default message. API: squash_merge_commit_message.",
					),
				rebase_merge: z
					.boolean()
					.describe("General → Pull Requests → Allow rebase merging. API: allow_rebase_merge."),
				suggest_updating_branches: z
					.boolean()
					.describe(
						"General → Pull Requests → Always suggest updating pull request branches. API: allow_update_branch. Omit to skip.",
					)
					.optional(),
				auto_merge: z
					.boolean()
					.describe("General → Pull Requests → Allow auto-merge. API: allow_auto_merge."),
				delete_head_branches: z
					.boolean()
					.describe(
						"General → Pull Requests → Automatically delete head branches. API: delete_branch_on_merge.",
					),
			})
			.strict()
			.describe("General → Features → Pull requests and the Pull Requests section."),
		commits: z
			.object({
				signoff_required: z
					.boolean()
					.describe(
						"General → Commits → Require contributors to sign off on web-based commits. API: web_commit_signoff_required.",
					),
				comments_allowed: z
					.boolean()
					.describe(
						"General → Commits → Allow comments on individual commits. UI: pass when false.",
					),
			})
			.strict()
			.describe("General → Commits."),
		archives: z
			.object({
				include_lfs_objects: z
					.boolean()
					.describe(
						"General → Archives → Include Git LFS objects in archives. UI: pass when false.",
					),
			})
			.strict()
			.describe("General → Archives."),
		pushes: z
			.object({
				update_limit: z
					.number()
					.int()
					.min(1)
					.max(1000)
					.nullable()
					.describe(
						"General → Pushes → Limit how many branches and tags can be updated in a single push. UI: null (unlimited) passes.",
					),
			})
			.strict()
			.describe("General → Pushes."),
		danger_zone: z
			.object({
				visibility: z
					.enum(["public", "private"])
					.describe("Danger Zone → Change visibility. API: PATCH private. Omit to skip.")
					.optional(),
				allow_forking: z
					.boolean()
					.describe("Danger Zone → Allow forking (private repos). API: PATCH allow_forking.")
					.optional(),
				branch_protection_rules_disabled: z
					.boolean()
					.describe(
						"Danger Zone → Disable branch protection rules. UI: pass when false, skipped with a hint when true.",
					)
					.optional(),
				archived: z
					.boolean()
					.describe("Danger Zone → Archive this repository. API: PATCH archived. Omit to skip.")
					.optional(),
			})
			.strict()
			.describe(
				"General → Danger Zone. Transfer/delete are destructive and have no field. Omit to skip.",
			)
			.optional(),
		custom_properties: z
			.record(z.string().min(1), z.union([z.string(), z.array(z.string())]))
			.describe(
				"General → Custom properties values (schemata are org-level). API: PATCH /properties/values. Omit to skip.",
			)
			.optional(),
	})
	.strict()
	.describe(
		"Settings → General (/settings): About, Template, Default branch, Releases, Social preview, Features, Pull Requests, Commits, Archives, Pushes, Danger Zone.",
	);

const access = z
	.object({
		collaborators: z
			.array(z.object({ login: z.string().min(1), permission }).strict())
			.describe(
				"Access → Collaborators. API: PUT /collaborators/{login} (extras ignored). Omit to skip.",
			)
			.optional(),
		teams: z
			.array(z.object({ slug: z.string().min(1), permission }).strict())
			.describe(
				"Access → Collaborators and teams (org repos). API: PUT org team repo permission (extras ignored). Omit to skip.",
			)
			.optional(),
		moderation: z
			.object({
				interaction_limits: z
					.object({
						limit: z
							.enum(["off", "existing_users", "contributors_only", "collaborators_only"])
							.describe(
								"Moderation → Interaction limits → which users may interact. API: PUT /interaction-limits; off = DELETE.",
							),
						expiry: z
							.enum(["one_day", "three_days", "one_week", "one_month", "six_months"])
							.describe(
								"Moderation → Interaction limits → duration (sent on fix; not compared, the live value is a timestamp).",
							)
							.optional(),
					})
					.strict()
					.describe("Access → Moderation → Interaction limits (time-boxed). Omit to skip.")
					.optional(),
				pull_request_limits: z
					.object({
						max_open: z
							.number()
							.int()
							.min(1)
							.max(100)
							.describe("Maximum open pull requests per user without write access.")
							.optional(),
						count_drafts: z
							.boolean()
							.describe("Count draft pull requests toward the limit.")
							.optional(),
						min_account_age_days: z
							.number()
							.int()
							.min(1)
							.describe("Exemption: minimum account age in days.")
							.optional(),
						min_merged_prs: z
							.number()
							.int()
							.min(1)
							.describe("Exemption: minimum merged pull requests in this repository.")
							.optional(),
					})
					.strict()
					.describe(
						"Access → Moderation → Interaction limits → Pull request limits. UI: skipped with a hint when set. Omit to skip.",
					)
					.optional(),
				code_review_limits: z
					.object({
						restrict_to_explicit_access: z
							.boolean()
							.describe(
								"Moderation → Code review limits → Limit to users explicitly granted read or higher access. UI: pass when false.",
							),
					})
					.strict()
					.describe("Access → Moderation → Code review limits. Omit to skip.")
					.optional(),
			})
			.strict()
			.describe("Access → Moderation: Interaction limits, Pull request limits, Code review limits.")
			.optional(),
	})
	.strict()
	.describe("Settings → Access (/settings/access): Collaborators, Moderation. Omit to skip.");

const threshold = {
	alerts: z.enum(["none", "errors", "errors_and_warnings", "all"]),
	security: z.enum(["none", "critical", "high_or_higher", "medium_or_higher", "all"]),
};

const ruleset = z
	.object({
		name: z.string().min(1).describe("Ruleset Name; live rulesets match by name."),
		target: z.enum(["branch", "tag"]).describe("New branch ruleset or New tag ruleset."),
		enforcement: z
			.enum(["active", "disabled", "evaluate"])
			.describe("Enforcement status (evaluate is Enterprise-only)."),
		bypass_actors: z
			.array(
				z
					.object({
						actor_type: z.enum([
							"RepositoryRole",
							"Team",
							"Integration",
							"DeployKey",
							"OrganizationAdmin",
							"User",
						]),
						actor_id: z
							.number()
							.int()
							.nullable()
							.describe("Actor id (RepositoryRole admin 5, maintain 2, write 4).")
							.optional(),
						bypass_mode: z.enum(["always", "pull_request", "exempt"]),
					})
					.strict(),
			)
			.describe("Bypass list. Omit to leave the live list alone.")
			.optional(),
		include: names.describe(
			"Target branches/tags → include (~DEFAULT_BRANCH, ~ALL, refs/heads/<pattern>, refs/tags/<pattern>).",
		),
		exclude: names.describe("Target branches/tags → exclude patterns. Omit to skip.").optional(),
		rules: z
			.object({
				creation: z.literal(true).describe("Restrict creations.").optional(),
				update: z.literal(true).describe("Restrict updates.").optional(),
				deletion: z.literal(true).describe("Restrict deletions.").optional(),
				required_linear_history: z.literal(true).describe("Require linear history.").optional(),
				required_signatures: z.literal(true).describe("Require signed commits.").optional(),
				non_fast_forward: z.literal(true).describe("Block force pushes.").optional(),
				required_deployments: names
					.describe("Require deployments to succeed → environment names.")
					.optional(),
				pull_request: z
					.object({
						required_approvals: z.number().int().min(0).max(10),
						dismiss_stale: z.boolean(),
						require_code_owner: z.boolean(),
						require_last_push_approval: z.boolean(),
						require_conversation_resolution: z.boolean(),
						require_extra_approval_for_copilot: z
							.boolean()
							.describe("Require an additional approval for unattributed Copilot pull requests.")
							.optional(),
						allowed_merge_methods: z.array(z.enum(["merge", "squash", "rebase"])).min(1),
					})
					.strict()
					.describe("Require a pull request before merging (branch rulesets only).")
					.optional(),
				required_status_checks: z
					.object({
						strict: z.boolean().describe("Require branches to be up to date before merging."),
						do_not_enforce_on_create: z
							.boolean()
							.describe("Do not require status checks on creation.")
							.optional(),
						checks: z.array(
							z
								.object({
									context: z.string().min(1),
									integration_id: z.number().int().optional(),
								})
								.strict(),
						),
					})
					.strict()
					.describe("Require status checks to pass.")
					.optional(),
				code_scanning: z
					.array(
						z
							.object({
								tool: z.string().min(1),
								security_alerts: threshold.security,
								alerts: threshold.alerts,
							})
							.strict(),
					)
					.describe("Require code scanning results → tools and alert thresholds.")
					.optional(),
				code_quality: z
					.object({ severity: z.enum(["errors", "warnings", "notes", "all"]) })
					.strict()
					.describe("Require code quality results.")
					.optional(),
				code_coverage: z
					.object({
						minimum_coverage: z.number().min(0).max(100).optional(),
						max_coverage_drop: z.number().min(0).max(100).optional(),
					})
					.strict()
					.describe("Restrict code coverage.")
					.optional(),
				copilot_code_review: z
					.object({ review_on_push: z.boolean(), review_draft_pull_requests: z.boolean() })
					.strict()
					.describe("Automatically request Copilot code review.")
					.optional(),
				merge_queue: z
					.object({
						merge_method: z.enum(["MERGE", "SQUASH", "REBASE"]),
						grouping_strategy: z.enum(["ALLGREEN", "HEADGREEN"]),
						max_entries_to_build: z.number().int(),
						max_entries_to_merge: z.number().int(),
						min_entries_to_merge: z.number().int(),
						min_entries_to_merge_wait_minutes: z.number().int(),
						check_response_timeout_minutes: z.number().int(),
					})
					.strict()
					.describe("Require merge queue (org repos only).")
					.optional(),
			})
			.strict()
			.describe("Rules. Every key is optional; an absent rule must not be present live."),
	})
	.strict();

const branchProtection = z
	.object({
		required_status_checks: names.describe(
			"Require status checks to pass → required check contexts. API: PUT /branches/{b}/protection.",
		),
		strict_status_checks: z
			.boolean()
			.describe(
				"Require branches to be up to date before merging. API: required_status_checks.strict.",
			)
			.optional(),
		reviews: z
			.object({
				required_approvals: z.number().int().min(0).max(10),
				dismiss_stale: z.boolean(),
				require_code_owner: z.boolean(),
				require_conversation_resolution: z.boolean(),
				require_signed_commits: z
					.boolean()
					.describe("Require signed commits. API: POST/DELETE protection/required_signatures."),
				restrict_pushes: z
					.boolean()
					.describe(
						"Restrict who can push (org repos). API: protection restrictions; enabling needs an allowlist in the UI.",
					),
			})
			.strict()
			.describe("Require a pull request before merging + signed commits + push restrictions."),
		require_last_push_approval: z
			.boolean()
			.describe("Require approval of the most recent reviewable push. API.")
			.optional(),
		require_linear_history: z.boolean().describe("Require linear history. API.").optional(),
		allow_force_pushes: z.boolean().describe("Allow force pushes. API.").optional(),
		allow_deletions: z.boolean().describe("Allow deletions. API.").optional(),
		enforce_admins: z
			.boolean()
			.describe("Do not allow bypassing the above settings. API.")
			.optional(),
		lock_branch: z.boolean().describe("Lock branch. API.").optional(),
	})
	.strict()
	.describe(
		"Branches → classic branch protection on default_branch. Omit when the branch is protected by rulesets only.",
	);

const allowlist = z
	.object({
		firewall: z.boolean().describe("Enable firewall.").optional(),
		recommended_allowlist: z.boolean().describe("Recommended allowlist.").optional(),
		custom_allowlist: names.describe("Custom allowlist rules.").optional(),
	})
	.strict();

const copilot = z
	.object({
		code_review: z
			.object({
				review_effort: z
					.enum(["inherit", "adaptive", "lite", "balanced", "max"])
					.describe("General → Review effort level (inherit = Default). API.")
					.optional(),
				severity_filter: z
					.enum(["no_filter", "low", "low_and_medium"])
					.describe("Severity filter (no UI control). API.")
					.optional(),
				mcp_enabled: z
					.boolean()
					.describe("General → Allow Copilot to use MCP tools. API.")
					.optional(),
				cross_repo_context: z
					.boolean()
					.describe("General → Search public repositories. API.")
					.optional(),
				custom_instructions: z
					.boolean()
					.describe("General → Use custom instructions. API.")
					.optional(),
				max_review_effort: z
					.enum(["no-limit", "lite", "balanced", "max"])
					.describe("General → Maximum review effort. UI: pass when no-limit.")
					.optional(),
				secret_protection_ai_scan: z
					.boolean()
					.describe("Security → Secret Protection AI Scan. UI: pass when false.")
					.optional(),
				allow_approvals: z
					.boolean()
					.describe("Approvals → Allow Copilot to approve pull requests. UI: pass when false.")
					.optional(),
				block_external_license: z
					.boolean()
					.describe(
						"Access and licensing → Block reviews requested with an external Copilot license. UI: pass when false.",
					)
					.optional(),
			})
			.strict()
			.describe(
				"Copilot → Code review. API: GET/PATCH /copilot/code-review/settings. Omit to skip.",
			)
			.optional(),
		cloud: z
			.object({
				sandbox_size: z
					.enum(["default", "S", "M", "L"])
					.describe("Sandbox resources → Sandbox size. UI: pass when default.")
					.optional(),
				require_workflow_approval: z
					.boolean()
					.describe("Policies → Require approval for workflow runs. READ.")
					.optional(),
				automations: z
					.object({
						enabled: z.boolean().describe("Allow automations. READ.").optional(),
						shared: z
							.boolean()
							.describe("Allow shared automations. UI: pass when false.")
							.optional(),
						require_write_access: z
							.boolean()
							.describe("Require write access to trigger automations. READ.")
							.optional(),
						only_update_triggering_resource: z
							.boolean()
							.describe(
								"Only allow automations to update the resource that triggered them. UI: pass when false.",
							)
							.optional(),
						require_workflow_approval_on_prs: z
							.boolean()
							.describe(
								"Require approval for workflows on automation pull requests. UI: pass when false.",
							)
							.optional(),
					})
					.strict()
					.describe("Automations.")
					.optional(),
				validation_tools: z
					.object({
						codeql: z.boolean().optional(),
						copilot_code_review: z.boolean().optional(),
						secret_scanning: z.boolean().optional(),
						dependency_vulnerability_checks: z.boolean().optional(),
					})
					.strict()
					.describe("Validation tools toggles. READ: enabled_tools.")
					.optional(),
			})
			.strict()
			.describe(
				"Copilot → Cloud (Copilot in the cloud). READ: GET /copilot/cloud-agent/configuration (no write API). Omit to skip.",
			)
			.optional(),
		internet_access: z
			.object({
				cloud: allowlist.describe("Internet access → Copilot in the cloud. READ.").optional(),
				code_review: allowlist
					.describe("Internet access → Copilot code review. UI: pass when off/empty.")
					.optional(),
			})
			.strict()
			.describe("Copilot → Internet access. Omit to skip.")
			.optional(),
		mcp: z
			.object({
				configuration: z
					.record(z.string(), z.unknown())
					.nullable()
					.describe("MCP configuration JSON ({ mcpServers: {...} }); null = unset. READ."),
			})
			.strict()
			.describe("Copilot → MCP servers. READ: mcp_configuration. Omit to skip.")
			.optional(),
		memory: z
			.object({
				enabled: z.boolean().describe("Allow Copilot to store and retrieve repository facts."),
			})
			.strict()
			.describe("Copilot → Memory. UI: pass when false.")
			.optional(),
		dreaming: z
			.object({ enabled: z.boolean().describe("Dreaming (Preview).") })
			.strict()
			.describe("Copilot → Dreaming. UI: pass when false.")
			.optional(),
	})
	.strict()
	.describe(
		"Copilot: Code review, Cloud, Internet access, MCP servers, Memory, Dreaming. Omit to skip.",
	);

const environment = z
	.object({
		wait_minutes: z
			.number()
			.int()
			.min(0)
			.max(43_200)
			.describe("Deployment protection rules → Wait timer (minutes). API: PUT wait_timer.")
			.optional(),
		prevent_self_review: z
			.boolean()
			.describe("Required reviewers → Prevent self-review. API: PUT prevent_self_review.")
			.optional(),
		required_reviewers: z
			.array(
				z
					.object({
						type: z.enum(["user", "team"]),
						name: z.string().min(1).describe("User login or team slug."),
					})
					.strict(),
			)
			.max(6)
			.describe("Required reviewers. API: PUT reviewers (ids resolved via Users/Teams API).")
			.optional(),
		admin_bypass: z
			.boolean()
			.describe(
				"Allow administrators to bypass configured protection rules. READ: can_admins_bypass (not in the PUT body; toggle in the UI).",
			)
			.optional(),
		branch_policy: z
			.object({
				type: z
					.enum(["all", "protected", "selected"])
					.describe("Deployment branches and tags: No restriction, Protected branches, Selected."),
				patterns: names
					.describe("Selected → branch name patterns. API: POST type branch.")
					.optional(),
				tag_patterns: names
					.describe("Selected → tag name patterns. API: POST type tag.")
					.optional(),
			})
			.strict()
			.describe(
				"Deployment branches and tags. API: PUT deployment_branch_policy + branch policies.",
			)
			.optional(),
		custom_protection_rules: names
			.describe("Enable custom rules with GitHub Apps → app slugs. READ (enable in the UI).")
			.optional(),
		secrets: names.describe("Environment secrets (presence only). READ.").optional(),
		variables: names.describe("Environment variables (presence only). READ.").optional(),
	})
	.strict();

const codePlanningAutomation = z
	.object({
		rulesets: z
			.array(ruleset)
			.describe(
				"Rulesets (/settings/rules). API: matched by name, created (POST) or replaced (PUT) when drifted; undeclared rulesets are ignored. Omit to skip.",
			)
			.optional(),
		branches: branchProtection.optional(),
		actions: z
			.object({
				general: z
					.object({
						enabled: z
							.boolean()
							.describe("Actions permissions (false = Disable actions). API. Omit = enabled.")
							.optional(),
						allowed: z
							.enum(["all", "local_only", "selected"])
							.describe("Actions permissions policy. API: allowed_actions."),
						selected: z
							.object({
								github_owned: z.boolean().describe("Allow actions created by GitHub.").optional(),
								verified_creators: z
									.boolean()
									.describe("Allow actions by Marketplace verified creators.")
									.optional(),
								patterns: names
									.max(1000)
									.describe("Allow or block specified actions and reusable workflows.")
									.optional(),
							})
							.strict()
							.describe("Selected actions (allowed: selected). API: PUT selected-actions.")
							.optional(),
						sha_pinning_required: z
							.boolean()
							.describe("Require actions to be pinned to a full-length commit SHA. API."),
						retention_days: z
							.number()
							.int()
							.min(1)
							.max(400)
							.describe("Artifact and log retention (days). API."),
						fork_pr_approval: z
							.enum([
								"first_time_contributors_new_to_github",
								"first_time_contributors",
								"all_external_contributors",
							])
							.describe("Approval for running fork pull request workflows from contributors. API."),
						fork_pr_workflows_private: z
							.object({
								run_workflows: z.boolean(),
								require_approval: z.boolean(),
								send_write_tokens: z.boolean(),
								send_secrets: z.boolean(),
							})
							.strict()
							.describe(
								"Fork pull request workflows in private repositories. API (public repos: skipped).",
							)
							.optional(),
						access_level: z
							.enum(["none", "user", "organization"])
							.describe("Access (share actions with other repos). API (public repos: skipped).")
							.optional(),
						workflow_permissions: z
							.object({
								default: z.enum(["read", "write"]).describe("Default GITHUB_TOKEN permissions."),
								can_approve_pull_requests: z
									.boolean()
									.describe("Allow GitHub Actions to create and approve pull requests."),
							})
							.strict()
							.describe("Workflow permissions. API."),
						cache: z
							.object({
								retention_days: z.number().int().min(1).optional(),
								storage_limit_gb: z.number().int().min(1).optional(),
							})
							.strict()
							.describe("Cache retention/storage limits. API (needs billing; 402 → skipped).")
							.optional(),
					})
					.strict()
					.describe("Actions → General (/settings/actions)."),
				runners: names
					.describe(
						"Actions → Runners: required self-hosted runner names. READ (register on the host).",
					)
					.optional(),
				policies: names
					.describe("Actions → Policies: required policy names. UI: skipped with a hint when set.")
					.optional(),
				oidc: z
					.object({
						use_default: z.boolean().describe("Subject claim → Use default template. API."),
						include_claim_keys: names
							.describe("Subject claim template keys (when useDefault is false). API.")
							.optional(),
						immutable_subject: z
							.boolean()
							.describe("Use immutable subject claim. API: use_immutable_subject.")
							.optional(),
					})
					.strict()
					.describe("Actions → OIDC. API: PUT /actions/oidc/customization/sub. Omit to skip.")
					.optional(),
			})
			.strict()
			.describe("Actions: General, Runners, Policies, OIDC."),
		webhooks: z
			.array(
				z
					.object({
						url: z.string().min(1).describe("Payload URL; live hooks match by URL."),
						content_type: z.enum(["form", "json"]).describe("Content type."),
						events: names.min(1).describe('Events, e.g. ["push"].'),
						active: z.boolean().describe("Active."),
						insecure_ssl: z
							.boolean()
							.describe("SSL verification disabled (insecure_ssl 1). Omit to skip.")
							.optional(),
					})
					.strict(),
			)
			.describe(
				"Webhooks (/settings/hooks). API: matched by URL, created/updated; secrets stay manual; extras ignored.",
			),
		copilot: copilot.optional(),
		planning: z
			.object({
				agent_suggestions: z
					.enum(["full-control", "cautious", "balanced", "full-automation"])
					.describe(
						"Agent suggestions for issues → Automation level. UI: pass when cautious (default).",
					),
			})
			.strict()
			.describe("Planning (/settings/suggestions). Omit to skip.")
			.optional(),
		environments: z
			.record(z.string().min(1), environment)
			.describe(
				"Environments by name; each must exist (fix creates). `{}` only requires existence.",
			),
		codespaces: z
			.object({
				devcontainer_required: z
					.boolean()
					.describe("Require .devcontainer/devcontainer.json in the repo. READ.")
					.optional(),
				prebuilds: z
					.array(
						z
							.object({
								branch: z.string().min(1),
								config_file: z.string().min(1).optional(),
								trigger: z.enum(["push", "configuration", "schedule"]),
								regions: z
									.array(z.enum(["UsEast", "UsWest", "EuropeWest", "SoutheastAsia", "Australia"]))
									.optional(),
								template_versions: z.number().int().min(1).optional(),
							})
							.strict(),
					)
					.describe("Prebuild configurations. UI: [] passes, otherwise skipped with a hint.")
					.optional(),
			})
			.strict()
			.describe("Codespaces (/settings/codespaces). Omit to skip.")
			.optional(),
		pages: z
			.object({
				enabled: z.boolean(),
				build_type: z
					.enum(["legacy", "workflow"])
					.describe("Build and deployment → Source (legacy = Deploy from a branch).")
					.optional(),
				branch: z.string().min(1).describe("Branch (legacy source).").optional(),
				path: z.enum(["/", "/docs"]).describe("Folder (legacy source).").optional(),
				custom_domain: z.string().min(1).describe("Custom domain (cname).").optional(),
				https_enforced: z.boolean().describe("Enforce HTTPS.").optional(),
				public: z.boolean().describe("Visibility (Enterprise Cloud only).").optional(),
			})
			.strict()
			.describe("Pages (/settings/pages). API: POST/PUT/DELETE /pages. Omit to skip.")
			.optional(),
	})
	.strict()
	.describe(
		"Settings → Code, planning, and automation: Rulesets, Branches, Actions, Webhooks, Copilot, Planning, Environments, Codespaces, Pages (Tags is deprecated — use a tag ruleset).",
	);

const securityAndQuality = z
	.object({
		advanced_security: z
			.object({
				private_vulnerability_reporting: z
					.object({
						enabled: z.boolean().describe("Enable/Disable. API: PUT/DELETE."),
						require_cwe: z.boolean().describe("Require a CWE assignment. UI.").optional(),
						daily_limit: z.number().int().min(1).describe("Daily advisory limit. UI.").optional(),
						trusted_reporters: names.describe("Trusted reporters. UI.").optional(),
					})
					.strict()
					.describe("Private vulnerability reporting (+ its settings page, UI)."),
				dependency_graph: z
					.boolean()
					.describe(
						"Dependency Scanning → Dependency graph. UI (always on for public repos: true passes there).",
					),
				automatic_dependency_submission: z
					.enum(["enabled", "labeled", "disabled"])
					.describe(
						"Dependency Scanning → Automatic dependency submission. UI: pass when disabled.",
					),
				dependabot: z
					.object({
						alerts: z
							.boolean()
							.describe("Dependabot alerts. API: PUT/DELETE /vulnerability-alerts."),
						malware_alerts: z.boolean().describe("Malware alerts. UI.").optional(),
						security_updates: z
							.boolean()
							.describe("Dependabot security updates. API: /automated-security-fixes."),
						grouped_security_updates: z
							.boolean()
							.describe("Grouped security updates. UI.")
							.optional(),
						version_updates: z
							.boolean()
							.describe("Dependabot version updates (.github/dependabot.yml present). READ.")
							.optional(),
						rules: z
							.object({
								dismiss_low_impact_dev_alerts: z.boolean().optional(),
								dismiss_package_malware_alerts: z.boolean().optional(),
								custom: names.optional(),
							})
							.strict()
							.describe("Dependabot auto-triage rules. UI.")
							.optional(),
						runner: z
							.object({
								type: z.enum(["standard", "labeled"]),
								labels: names.max(1).describe("Exactly one label (API limit).").optional(),
								group: z.string().min(1).optional(),
							})
							.strict()
							.describe("Dependabot on self-hosted runners. API: /dependabot/runner-settings.")
							.optional(),
					})
					.strict()
					.describe("Dependabot."),
				code_scanning: z
					.object({
						default_setup: z
							.object({
								state: z.enum(["configured", "not-configured"]),
								languages: names.optional(),
								query_suite: z.enum(["default", "extended"]).optional(),
								threat_model: z.enum(["remote", "remote_and_local"]).optional(),
								runner_type: z.enum(["standard", "labeled"]).optional(),
								runner_label: z.string().min(1).optional(),
							})
							.strict()
							.describe(
								"Tools → CodeQL analysis default setup. API: PATCH /code-scanning/default-setup.",
							)
							.optional(),
						ai_scan: z
							.object({ repository: z.boolean().optional(), pull_requests: z.boolean().optional() })
							.strict()
							.describe(
								"AI Scan for repositories / pull requests. API: PATCH /code-scanning/ai-scan.",
							)
							.optional(),
						ai_applications: z.boolean().describe("Scan for AI applications. UI.").optional(),
						copilot_autofix: z.boolean().describe("Copilot Autofix. UI: pass when false."),
						agentic_autofix: z.boolean().describe("Agentic autofix. UI.").optional(),
						check_run_thresholds: z
							.object({ security: threshold.security, standard: threshold.alerts })
							.strict()
							.describe("Protection rules → Check runs failure threshold. UI.")
							.optional(),
					})
					.strict()
					.describe("Code Security: Tools, AI Scan, Protection rules."),
				secret_protection: z
					.object({
						enabled: z.boolean().describe("Secret Protection. API: security_and_analysis."),
						push_protection: z.boolean().describe("Push protection. API."),
						non_provider_patterns: z
							.boolean()
							.describe("Scan for non-provider patterns. API.")
							.optional(),
						ai_detection: z.boolean().describe("Use AI detection. API.").optional(),
						validity_checks: z.boolean().describe("Validity checks. READ.").optional(),
						delegated_bypass: z
							.boolean()
							.describe("Push protection → delegated bypass. API.")
							.optional(),
						delegated_alert_dismissal: z
							.boolean()
							.describe("Prevent direct alert dismissals. API.")
							.optional(),
						custom_patterns: names
							.describe("Custom pattern names. READ: GET /secret-scanning/custom-patterns.")
							.optional(),
					})
					.strict()
					.describe("Secret Protection."),
			})
			.strict()
			.describe(
				"Advanced Security (/settings/security_analysis): PVR, Dependency Scanning, Dependabot, Code Security, Secret Protection.",
			),
		deploy_keys: z
			.array(
				z
					.object({
						title: z.string().min(1),
						read_only: z.boolean().describe("Inverse of Allow write access.").optional(),
					})
					.strict(),
			)
			.describe("Deploy keys by title. READ (key material is manual). Omit to skip.")
			.optional(),
		secrets: z
			.object({
				actions: z
					.object({ secrets: names, variables: names })
					.strict()
					.describe("Secrets and variables → Actions (repository)."),
				agents: z
					.object({ secrets: names.optional(), variables: names.optional() })
					.strict()
					.describe("Secrets and variables → Agents.")
					.optional(),
				codespaces: names.describe("Secrets and variables → Codespaces.").optional(),
				dependabot: names.describe("Secrets and variables → Dependabot.").optional(),
			})
			.strict()
			.describe(
				"Secrets and variables, presence only (values are write-only). READ: fix with gh secret/variable set.",
			),
	})
	.strict()
	.describe(
		"Settings → Security and quality: Advanced Security, Deploy keys, Secrets and variables.",
	);

const integrations = z
	.object({
		github_apps: names
			.describe("GitHub Apps: installed app slugs. UI (no user-token API): skipped when set.")
			.optional(),
		autolinks: z
			.array(
				z
					.object({
						prefix: z.string().min(1).describe("Reference prefix, e.g. TICKET-."),
						url_template: z.string().min(1).describe("Target URL with <num>."),
						alphanumeric: z.boolean().describe("Alphanumeric references.").optional(),
					})
					.strict(),
			)
			.describe("Autolink references. API: create; mismatches delete + recreate.")
			.optional(),
		email_notifications: z
			.object({
				addresses: z.array(z.string().email()).max(2),
				active: z.boolean().optional(),
			})
			.strict()
			.describe("Email notifications (/settings/notifications). UI: skipped when set.")
			.optional(),
	})
	.strict()
	.describe(
		"Settings → Integrations: GitHub Apps, Autolink references, Email notifications. Omit to skip.",
	);

const community = z
	.object({
		codeowners: z
			.string()
			.describe('CODEOWNERS path, e.g. .github/CODEOWNERS ("" disables). READ presence.')
			.optional(),
		issue_templates: z
			.boolean()
			.describe("Require .github/ISSUE_TEMPLATE content. READ.")
			.optional(),
		pr_template: z.boolean().describe("Require .github/PULL_REQUEST_TEMPLATE.md. READ.").optional(),
		funding: z.boolean().describe("Require .github/FUNDING.yml. READ.").optional(),
		license: z.boolean().describe("Require LICENSE. READ.").optional(),
		code_of_conduct: z.boolean().describe("Require CODE_OF_CONDUCT.md. READ.").optional(),
		readme: z.boolean().describe("Require README.md. READ.").optional(),
	})
	.strict()
	.describe("Community files (repo contents, not a Settings page). Omit to skip.");

export const GithubSchema = z.compile(
	z
		.object({
			$schema: z
				.string()
				.describe("JSON Schema reference, e.g. ./config/github-manifest.json.")
				.optional(),
			$name: z.string().min(1).describe("Human-readable blueprint name.").optional(),
			$description: z.string().describe("Human-readable blueprint description.").optional(),
			...general.shape,
			access: access.optional(),
			...codePlanningAutomation.shape,
			...securityAndQuality.shape,
			integrations: integrations.optional(),
			...community.shape,
		})
		.strict(),
);

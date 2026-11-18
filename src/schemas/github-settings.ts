import * as z from "zod";

// Field order follows the repo Settings sidebar top to bottom (see ADR-0014):
// General (incl. Releases) → Access (Collaborators, Moderation: interaction +
// pull-request limits, code review limits via reviews.restrictPushes) → Branches
// → Tags → Rules (rulesets, required workflows, merge queue) → Actions
// (permissions, runners, policies, OIDC) → Webhooks → Copilot suite →
// Suggestions (planning) → Environments → Codespaces → Pages → Security
// (Advanced Security, deploy keys) → Secrets and variables (Actions, Agents,
// Codespaces, Dependabot, per-environment) → Community files → Integrations
// (GitHub Apps, autolinks, notifications), then Releases.
// New fields stay optional so old blueprints still parse. Name/transfer/delete
// are intentionally not fields: rename breaks the target, transfer/delete are
// destructive — do them in the UI dialogs (see SKILL.md dialog mapping).
export const GithubSchema = z.compile(
	z
		.object({
			$description: z.string().describe("Human-readable blueprint description.").optional(),
			$name: z.string().min(1).describe("Human-readable blueprint name.").optional(),
			$schema: z
				.string()
				.describe("JSON Schema reference, e.g. ./config/github-manifest.json.")
				.optional(),
			// General (/settings).
			description: z
				.string()
				.max(350)
				.describe("General → Description (PATCH description). Omit to skip.")
				.optional(),
			homepage: z
				.string()
				.max(2048)
				.describe("General → Website URL (PATCH homepage, empty string clears). Omit to skip.")
				.optional(),
			topics: z
				.array(z.string().min(1).max(50))
				.max(20)
				.describe("General → Topics (PUT /repos/{repo}/topics, replace-all). Omit to skip.")
				.optional(),
			socialPreview: z
				.boolean()
				.describe(
					"Custom social preview image is set. Check-only: no public API, upload in Settings.",
				),
			features: z
				.object({
					discussions: z.boolean(),
					issueTemplates: z.boolean().describe("Require .github/ISSUE_TEMPLATE content."),
					issues: z
						.object({
							enabled: z.boolean().describe("General → Issues toggle (PATCH has_issues)."),
							permissions: z
								.enum(["all-users", "collaborators-only"])
								.describe(
									"General → Features → Issue permissions (Creation allowed by). Check-only: no public repo read API — skipped with a UI hint when set.",
								)
								.optional(),
							autoClose: z
								.boolean()
								.describe(
									"General → Issues → auto-close with merged linked PRs. Check-only: no public repo read API — skipped with a UI hint when set.",
								)
								.optional(),
						})
						.strict()
						.describe("Issues toggle and audience (permissions/auto-close are check-only)."),
					projects: z.boolean(),
					sponsorships: z
						.boolean()
						.describe(
							"General → Sponsorships → display a Sponsor button. Check-only: no public repo read API — pass when false, skipped with a UI hint when true.",
						),
					wiki: z.boolean(),
				})
				.describe("Repo feature toggles.")
				.strict(),
			// Pull requests (General → Features/Pull Requests + merge methods).
			pullRequests: z
				.object({
					enabled: z
						.boolean()
						.describe("General → allow pull requests (PATCH has_pull_requests). Omit to skip.")
						.optional(),
					permissions: z
						.enum(["all-users", "collaborators-only"])
						.describe(
							"General → Features → Pull request permissions (Creation allowed by). Check-only: no public repo read API — skipped with a UI hint when set.",
						)
						.optional(),
					autoMerge: z.boolean(),
					deleteHeadBranches: z.boolean().describe("Automatically delete head branches."),
					mergeCommit: z.boolean(),
					mergeMessage: z.enum(["blank", "pr-body", "pr-title"]),
					mergeTitle: z.enum(["merge-message", "pr-title"]),
					rebaseMerge: z.boolean(),
					squashMerge: z.boolean(),
					squashMessage: z.enum(["blank", "commit-messages", "pr-body"]),
					squashTitle: z.enum(["commit-title", "pr-title"]),
					suggestUpdatingBranches: z
						.boolean()
						.describe(
							"General → always suggest updating PR branches (PATCH allow_update_branch). Omit to skip.",
						)
						.optional(),
				})
				.describe("Pull request feature, audience, merge methods, and PR automation.")
				.strict(),
			signoffRequired: z
				.boolean()
				.describe("Require contributors to sign off on web-based commits."),
			archiveSettings: z
				.object({
					commitComments: z.boolean().describe("Allow comments on individual commits."),
					includeLfsInArchives: z.boolean().describe("Include Git LFS objects in archives."),
					pushUpdateLimit: z
						.number()
						.int()
						.min(1)
						.max(10_000)
						.nullable()
						.describe("Max branches/tags updated in a single push. Null skips (no public API)."),
				})
				.describe("Repo archive/push toggles. Check-only: no public API, confirm in Settings.")
				.strict(),
			visibility: z
				.enum(["public", "private"])
				.describe("Danger Zone → Change visibility (PATCH private). Omit to skip.")
				.optional(),
			isTemplateRepo: z
				.boolean()
				.describe("General → Template repository toggle (PATCH is_template). Omit to skip.")
				.optional(),
			allowForking: z
				.boolean()
				.describe("General → Allow forking (PATCH allow_forking, private repos). Omit to skip.")
				.optional(),
			archived: z
				.boolean()
				.describe("Danger Zone → Archive repository (PATCH archived). Omit to skip.")
				.optional(),
			// Access (/settings/access).
			access: z
				.object({
					collaborators: z
						.array(
							z
								.object({
									login: z.string().min(1),
									permission: z.enum(["pull", "triage", "push", "maintain", "admin"]),
								})
								.strict(),
						)
						.describe("Required collaborators with repo permission (extras ignored).")
						.optional(),
					teams: z
						.array(
							z
								.object({
									permission: z.enum(["pull", "triage", "push", "maintain", "admin"]),
									slug: z.string().min(1),
								})
								.strict(),
						)
						.describe("Required teams with repo permission (extras ignored; needs org team slug).")
						.optional(),
				})
				.describe("Access → Collaborators & teams (/settings/access). Omit to skip.")
				.optional(),
			interactionLimits: z
				.object({
					limit: z.enum(["off", "existing_users", "contributors", "collaborators"]),
				})
				.describe(
					"Access → Moderation → Interaction limits (time-boxed abuse response; check via API, fix is manual in the UI). Omit to skip.",
				)
				.strict()
				.optional(),
			pullRequestLimits: z
				.object({
					countDrafts: z
						.boolean()
						.describe("Count draft PRs toward the per-user open-PR limit.")
						.optional(),
					maxOpen: z
						.number()
						.int()
						.min(1)
						.max(100)
						.describe("Max concurrent open PRs per user without write access.")
						.optional(),
					minAccountAgeDays: z
						.number()
						.int()
						.min(1)
						.describe("Exempt contributors whose account is at least this old (days).")
						.optional(),
					minMergedPRs: z
						.number()
						.int()
						.min(1)
						.describe("Exempt contributors with at least this many merged PRs.")
						.optional(),
				})
				.strict()
				.describe(
					"Access → Moderation → Pull request limits (Settings → Interaction limits). Check-only: no public repo read API — skipped with a UI hint when set. Omit to skip.",
				)
				.optional(),
			// Branches (/settings/branches).
			defaultBranch: z.string().min(1).describe("Default branch name."),
			checks: z
				.array(z.string().min(1))
				.describe("Required status check contexts on the default branch."),
			reviews: z
				.object({
					dismissStale: z.boolean(),
					requireCodeOwner: z.boolean(),
					requireConversationResolution: z.boolean(),
					requireSignedCommits: z.boolean(),
					requiredApprovals: z.number().int().min(0).max(10),
					restrictPushes: z
						.boolean()
						.describe(
							"Access → Moderation → Code review limits, enforced via branch protection restrictions (PUT). Limit pushes to users explicitly granted read or higher access.",
						),
				})
				.describe("Default-branch code review and push restrictions.")
				.strict(),
			// Tags (/settings/tags).
			tagProtection: z
				.array(z.string().min(1))
				.describe(
					"Tags → Tag protection patterns. Check-only: legacy API is closing down — use Rulesets; fix is manual.",
				)
				.optional(),
			// Rules (/settings/rules).
			rulesets: z
				.array(z.string().min(1))
				.describe(
					"Ruleset names that must exist and be active. Fix is manual (author JSON in the UI).",
				),
			requiredWorkflows: z
				.array(z.string().min(1))
				.describe(
					"Required workflow file paths (org-level file reference; manual authoring). Omit to skip.",
				)
				.optional(),
			mergeQueue: z
				.object({
					enabled: z.boolean().describe("A ruleset with a merge_queue rule must exist (or not)."),
					method: z
						.enum(["merge", "squash", "rebase"])
						.describe("Required merge_queue merge method (case-insensitive).")
						.optional(),
					maxEntriesToMerge: z
						.number()
						.int()
						.min(1)
						.describe("Required merge_queue max entries to merge.")
						.optional(),
				})
				.describe(
					"Rules → merge queue policy (rulesets only; no repo PATCH field). Check reads rulesets; fix is manual in Settings → Rules.",
				)
				.strict()
				.optional(),
			// Actions (/settings/actions).
			actions: z
				.object({
					allowApprovePRs: z
						.boolean()
						.describe("Allow GitHub Actions to create and approve pull requests."),
					allowed: z
						.enum(["all", "local_only", "selected"])
						.describe("Which actions and reusable workflows may run (GitHub API values)."),
					approvalForExternal: z
						.boolean()
						.describe("Require approval for all external contributors (fork PR workflows)."),
					defaultWorkflowPermissions: z
						.enum(["read", "write"])
						.describe("Default GITHUB_TOKEN permissions."),
					oidcImmutableSubject: z
						.boolean()
						.describe("Use the immutable subject claim for OIDC. Check-only: no public fix API."),
					retentionDays: z
						.number()
						.int()
						.min(1)
						.max(400)
						.describe("Artifact and log retention in days."),
					selectedPatterns: z
						.array(z.string().min(1))
						.max(1000)
						.describe(
							"Allowed-actions patterns when allowed is selected (e.g. owner/repo@sha). Omit to skip.",
						)
						.optional(),
					shaPinningRequired: z
						.boolean()
						.describe("Require actions to be pinned to a full-length commit SHA."),
				})
				.describe("GitHub Actions permissions and retention.")
				.strict(),
			runners: z
				.array(z.string().min(1))
				.describe(
					"Required self-hosted runner names (presence audit; runners are ephemeral — register them manually in Settings → Actions → Runners).",
				)
				.optional(),
			actionsPolicies: z
				.array(z.string().min(1))
				.describe(
					"Required Actions policy names (Settings → Actions → Policies). Check-only: no public repo read API — skipped with a UI hint when set. Omit to skip.",
				)
				.optional(),
			// Webhooks (/settings/hooks).
			webhooks: z
				.array(
					z
						.object({
							active: z.boolean(),
							contentType: z
								.enum(["form", "json"])
								.describe("Payload content type (GitHub API values)."),
							events: z
								.array(z.string().min(1))
								.min(1)
								.describe('Events triggering delivery, e.g. ["push"].'),
							url: z.string().min(1).describe("Payload URL; live hooks match by URL."),
						})
						.strict(),
				)
				.describe(
					"Repository webhooks, matched by URL (fix creates/updates; secrets are set manually in the UI).",
				),
			// Copilot suite (no single /settings page; subpages below).
			copilot: z
				.object({
					codeReview: z
						.boolean()
						.describe(
							"Copilot → Code review enabled (Settings → Copilot → Code review). Check-only: org-level or no public repo API — skipped with a UI hint when set.",
						)
						.optional(),
					codingAgent: z
						.boolean()
						.describe(
							"Copilot → Coding agent enabled (Settings → Copilot → Coding agent). Check-only: org-level or no public repo API — skipped with a UI hint when set.",
						)
						.optional(),
					internetAccessFirewall: z
						.boolean()
						.describe(
							"Copilot → Internet access firewall enabled (Settings → Copilot → Internet access). Check-only: no public repo API — skipped with a UI hint when set.",
						)
						.optional(),
					mcp: z
						.boolean()
						.describe(
							"Copilot → MCP enabled (Settings → Copilot → MCP). Check-only: no public repo API — skipped with a UI hint when set.",
						)
						.optional(),
					memory: z
						.boolean()
						.describe(
							"Copilot → Memory enabled (Settings → Copilot → Memory). Check-only: no public repo API — skipped with a UI hint when set.",
						)
						.optional(),
				})
				.strict()
				.describe(
					"Copilot suite (code review, coding agent, internet access, MCP, memory; dreaming has no repo toggle). Omit to skip.",
				)
				.optional(),
			// Suggestions (Planning → Agent suggestions for issues).
			planning: z
				.object({
					agentSuggestions: z
						.enum(["full-control", "cautious", "balanced", "full-automation", "disabled"])
						.describe(
							"Planning → Agent suggestions automation level (Full control, Cautious default, Balanced, Full automation, or disabled/off). Check-only: no public API, confirm in the UI.",
						),
				})
				.describe("Planning assistance toggles.")
				.strict(),
			// Environments (/settings/environments).
			environments: z
				.array(z.string().min(1))
				.describe("Deployment environments that must exist (created by fix when missing)."),
			environmentProtection: z
				.record(
					z.string().min(1),
					z
						.object({
							waitMinutes: z
								.number()
								.int()
								.min(0)
								.max(43_200)
								.describe("Wait timer in minutes (PUT wait_timer).")
								.optional(),
							preventSelfReview: z
								.boolean()
								.describe("Prevent self-review (PUT prevent_self_review).")
								.optional(),
							requiredReviewers: z
								.array(
									z
										.object({
											type: z.enum(["user", "team"]),
											name: z.string().min(1).describe("User login or team slug."),
										})
										.strict(),
								)
								.max(6)
								.describe(
									"Required reviewers by login/slug (fix resolves IDs via the Users/Teams API).",
								)
								.optional(),
							branchPolicy: z
								.object({
									type: z.enum(["all", "protected", "selected"]),
									patterns: z
										.array(z.string().min(1))
										.describe("Branch name patterns (only for selected).")
										.optional(),
								})
								.strict()
								.describe("Deployment branch policy (PUT deployment_branch_policy).")
								.optional(),
						})
						.strict(),
				)
				.describe(
					"Per-environment protection rules, e.g. { production: { waitMinutes: 30 } } (fix via the Environments API). Omit to skip.",
				)
				.optional(),
			environmentSecrets: z
				.record(z.string().min(1), z.array(z.string().min(1)))
				.describe(
					'Per-environment secret names, e.g. { production: ["TOKEN"] } (presence only; manual fix). Omit to skip.',
				)
				.optional(),
			// Codespaces (/settings/codespaces; secrets live under Secrets and variables).
			codespacesSecrets: z
				.array(z.string().min(1))
				.describe(
					"Required Codespaces secret names (presence only; values write-only). Fix is manual (gh secret set --app codespaces).",
				)
				.optional(),
			codespaces: z
				.object({
					devcontainerRequired: z
						.boolean()
						.describe("Require .devcontainer/devcontainer.json in the repo.")
						.optional(),
				})
				.describe(
					"Codespaces file requirements (machine types and access/spending policies are org-level or UI-only). Omit to skip.",
				)
				.strict()
				.optional(),
			// Pages (/settings/pages).
			pages: z
				.object({
					enabled: z.boolean(),
					branch: z.string().min(1).describe("Publishing branch (branch source only).").optional(),
					path: z.enum(["/", "/docs"]).describe("Publishing folder.").optional(),
					customDomain: z.string().min(1).describe("Custom domain (CNAME).").optional(),
					httpsEnforced: z.boolean().describe("Enforce HTTPS.").optional(),
				})
				.describe("Code and automation → Pages (/settings/pages). Fix via Pages API.")
				.strict()
				.optional(),
			// Security (/settings/security).
			security: z
				.object({
					copilotAutofix: z
						.boolean()
						.describe("Copilot Autofix. Check-only: no public API, confirm in the UI."),
					dependabot: z.boolean().describe("Dependabot security updates."),
					dependencyAutoSubmit: z.boolean(),
					dependencyGraph: z.boolean(),
					nonProviderPatterns: z
						.boolean()
						.describe(
							"Secret scanning non-provider patterns (PATCH security_and_analysis). Omit to skip.",
						)
						.optional(),
					aiDetection: z
						.boolean()
						.describe("Secret scanning AI detection (PATCH security_and_analysis). Omit to skip.")
						.optional(),
					privateVulnerabilityReporting: z.boolean(),
					pushProtection: z.boolean(),
					secretProtection: z.boolean(),
				})
				.describe("Advanced Security toggles.")
				.strict(),
			deployKeys: z
				.array(z.string().min(1))
				.describe(
					"Deploy-key titles that must exist (presence by title; key material is manual in Settings → Deploy keys).",
				)
				.optional(),
			// Secrets and variables (/settings/secrets/*).
			secrets: z
				.array(z.string().min(1))
				.describe("Required Actions secret names (presence only; values are write-only)."),
			variables: z
				.array(z.string().min(1))
				.describe("Required Actions variable names (presence only)."),
			dependabotSecrets: z
				.array(z.string().min(1))
				.describe(
					"Required Dependabot secret names (presence only). Fix is manual (gh secret set --app dependabot).",
				)
				.optional(),
			agentsSecrets: z
				.array(z.string().min(1))
				.describe(
					"Required Agents secret names (presence only via /agents/secrets; values write-only). Fix is manual (gh secret set --app agents or Settings → Secrets → Agents).",
				)
				.optional(),
			agentsVariables: z
				.array(z.string().min(1))
				.describe(
					"Required Agents variable names (presence only via /agents/variables). Fix is manual in Settings → Secrets → Agents.",
				)
				.optional(),
			customProperties: z
				.record(z.string().min(1), z.union([z.string(), z.array(z.string())]))
				.describe(
					"Repository custom-property values (schemata are org-level; values fixable via PATCH /properties/values). Omit to skip.",
				)
				.optional(),
			// Community files (Community Standards / issue and PR templates).
			codeowners: z
				.string()
				.describe(
					"Required CODEOWNERS path, e.g. .github/CODEOWNERS. Empty string disables the presence check.",
				),
			community: z
				.object({
					prTemplate: z.boolean().describe("Require .github/PULL_REQUEST_TEMPLATE.md.").optional(),
					funding: z.boolean().describe("Require .github/FUNDING.yml (sponsor button).").optional(),
					license: z.boolean().describe("Require LICENSE file.").optional(),
					codeOfConduct: z.boolean().describe("Require CODE_OF_CONDUCT.md.").optional(),
					readme: z.boolean().describe("Require README.md.").optional(),
					dependabotConfig: z.boolean().describe("Require .github/dependabot.yml.").optional(),
				})
				.describe("Community files (contents-API presence; manual fix). Omit to skip.")
				.strict()
				.optional(),
			// Integrations.
			githubApps: z
				.array(z.string().min(1))
				.describe(
					"Integrations → GitHub Apps: required installed app slugs (Settings → Integrations → GitHub Apps). Check-only: installing needs the UI/marketplace — skipped with a UI hint when set. Omit to skip.",
				)
				.optional(),
			autolinks: z
				.array(
					z
						.object({
							prefix: z.string().min(1).describe("Reference prefix, e.g. TICKET-."),
							urlTemplate: z.string().min(1).describe("Target URL with <num> placeholder."),
							alphanumeric: z.boolean().describe("Accept alphanumeric ids.").optional(),
						})
						.strict(),
				)
				.describe(
					"Integrations → Autolink references (/settings/autolink_references). Fix creates missing; mismatched entries are delete+recreate via fix.",
				)
				.optional(),
			notificationEmail: z
				.string()
				.email()
				.describe(
					"Integrations → Email notifications address. Check-only: no repo read API — always skipped with a manual hint when set.",
				)
				.optional(),
			// Releases (General → Releases).
			releases: z
				.object({
					immutable: z.boolean().describe("Disallow modifying release assets and tags."),
				})
				.strict()
				.describe("Release immutability policy."),
		})
		.strict(),
);

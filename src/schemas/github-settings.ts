import * as z from "zod";

export const GithubSchema = z.compile(
	z
		.object({
			$description: z.string().describe("Human-readable blueprint description.").optional(),
			$name: z.string().min(1).describe("Human-readable blueprint name.").optional(),
			$schema: z
				.string()
				.describe("JSON Schema reference, e.g. ./config/github-manifest.json.")
				.optional(),
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
					shaPinningRequired: z
						.boolean()
						.describe("Require actions to be pinned to a full-length commit SHA."),
				})
				.describe("GitHub Actions permissions and retention.")
				.strict(),
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
			checks: z
				.array(z.string().min(1))
				.describe("Required status check contexts on the default branch."),
			codeowners: z
				.string()
				.describe(
					"Required CODEOWNERS path, e.g. .github/CODEOWNERS. Empty string disables the presence check.",
				),
			defaultBranch: z.string().min(1).describe("Default branch name."),
			environments: z
				.array(z.string().min(1))
				.describe("Deployment environments that must exist (created by fix when missing)."),
			features: z
				.object({
					discussions: z.boolean(),
					issueTemplates: z.boolean().describe("Require .github/ISSUE_TEMPLATE content."),
					issues: z.boolean(),
					projects: z.boolean(),
					wiki: z.boolean(),
				})
				.describe("Repo feature toggles.")
				.strict(),
			merge: z
				.object({
					autoMerge: z.boolean(),
					deleteHeadBranches: z.boolean().describe("Automatically delete head branches."),
					mergeCommit: z.boolean(),
					mergeMessage: z.enum(["blank", "pr-body", "pr-title"]),
					mergeTitle: z.enum(["merge-message", "pr-title"]),
					rebaseMerge: z.boolean(),
					squashMerge: z.boolean(),
					squashMessage: z.enum(["blank", "commit-messages", "pr-body"]),
					squashTitle: z.enum(["commit-title", "pr-title"]),
				})
				.describe("Merge methods, commit message defaults, and PR automation.")
				.strict(),
			planning: z
				.object({
					agentSuggestions: z
						.enum(["full-control", "disabled"])
						.describe(
							"Agent suggestions for issues. Check-only: no public API, confirm in the UI.",
						),
				})
				.describe("Planning assistance toggles.")
				.strict(),
			releasesImmutable: z.boolean().describe("Disallow modifying release assets and tags."),
			reviews: z
				.object({
					dismissStale: z.boolean(),
					requireCodeOwner: z.boolean(),
					requireConversationResolution: z.boolean(),
					requireSignedCommits: z.boolean(),
					requiredApprovals: z.number().int().min(0).max(10),
					restrictPushes: z
						.boolean()
						.describe("Limit pushes to users explicitly granted read or higher access."),
				})
				.describe("Default-branch code review and push restrictions.")
				.strict(),
			rulesets: z
				.array(z.string().min(1))
				.describe(
					"Ruleset names that must exist and be active. Fix is manual (author JSON in the UI).",
				),
			secrets: z
				.array(z.string().min(1))
				.describe("Required Actions secret names (presence only; values are write-only)."),
			security: z
				.object({
					copilotAutofix: z
						.boolean()
						.describe("Copilot Autofix. Check-only: no public API, confirm in the UI."),
					dependabot: z.boolean().describe("Dependabot security updates."),
					dependencyAutoSubmit: z.boolean(),
					dependencyGraph: z.boolean(),
					privateVulnerabilityReporting: z.boolean(),
					pushProtection: z.boolean(),
					secretProtection: z.boolean(),
				})
				.describe("Advanced Security toggles.")
				.strict(),
			signoffRequired: z
				.boolean()
				.describe("Require contributors to sign off on web-based commits."),
			socialPreview: z
				.boolean()
				.describe(
					"Custom social preview image is set. Check-only: no public API, upload in Settings.",
				),
			variables: z
				.array(z.string().min(1))
				.describe("Required Actions variable names (presence only)."),
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
		})
		.strict(),
);

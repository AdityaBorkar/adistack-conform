import * as z from "zod";

export const GithubSchema = z.compile(
	z
		.object({
			$schema: z
				.string()
				.describe("JSON Schema reference, e.g. ./config/github-manifest.json.")
				.optional(),
			"@description": z.string().describe("Human-readable blueprint description.").optional(),
			"@name": z.string().min(1).describe("Human-readable blueprint name.").optional(),
			actions: z
				.object({
					allowApprovePRs: z
						.boolean()
						.describe("Allow GitHub Actions to create and approve pull requests.")
						.default(false),
					allowed: z
						.enum(["all", "local_only", "selected"])
						.describe("Which actions and reusable workflows may run (GitHub API values).")
						.default("all"),
					approvalForExternal: z
						.boolean()
						.describe("Require approval for all external contributors (fork PR workflows).")
						.default(true),
					defaultWorkflowPermissions: z
						.enum(["read", "write"])
						.describe("Default GITHUB_TOKEN permissions.")
						.default("read"),
					oidcImmutableSubject: z
						.boolean()
						.describe("Use the immutable subject claim for OIDC. Check-only: no public fix API.")
						.default(true),
					retentionDays: z
						.number()
						.int()
						.min(1)
						.max(400)
						.describe("Artifact and log retention in days.")
						.default(90),
					shaPinningRequired: z
						.boolean()
						.describe("Require actions to be pinned to a full-length commit SHA.")
						.default(true),
				})
				.describe("GitHub Actions permissions and retention.")
				.strict()
				.prefault({}),
			agentSuggestions: z
				.enum(["full-control", "disabled"])
				.describe("Agent suggestions for issues. Check-only: no public API, verify in the UI.")
				.default("full-control"),
			archiveSettings: z
				.object({
					commitComments: z
						.boolean()
						.describe("Allow comments on individual commits.")
						.default(false),
					includeLfsInArchives: z
						.boolean()
						.describe("Include Git LFS objects in archives.")
						.default(false),
					pushUpdateLimit: z
						.number()
						.int()
						.min(1)
						.max(10_000)
						.describe("Max branches/tags updated in a single push. Omit to skip (no public API).")
						.optional(),
				})
				.describe("Repo archive/push toggles. Check-only: no public API, verify in Settings.")
				.strict()
				.prefault({}),
			checks: z
				.array(z.string().min(1))
				.describe("Required status check contexts on the default branch.")
				.default(["conform", "format", "lint", "types"]),
			codeowners: z
				.string()
				.min(1)
				.describe(
					"Required CODEOWNERS path, e.g. .github/CODEOWNERS. Omit to skip the presence check.",
				)
				.optional(),
			defaultBranch: z.string().min(1).describe("Default branch name.").default("stable"),
			environments: z
				.array(z.string().min(1))
				.describe("Deployment environments that must exist (created by fix when missing).")
				.default(["beta", "stable"]),
			features: z
				.object({
					discussions: z.boolean().default(false),
					issueTemplates: z
						.boolean()
						.describe("Require .github/ISSUE_TEMPLATE content.")
						.default(true),
					issues: z.boolean().default(true),
					projects: z.boolean().default(false),
					wiki: z.boolean().default(false),
				})
				.describe("Repo feature toggles.")
				.strict()
				.prefault({}),
			merge: z
				.object({
					autoMerge: z.boolean().default(true),
					deleteHeadBranches: z
						.boolean()
						.describe("Automatically delete head branches.")
						.default(true),
					mergeCommit: z.boolean().default(true),
					mergeMessage: z.enum(["blank", "pr-body", "pr-title"]).default("pr-body"),
					mergeTitle: z.enum(["merge-message", "pr-title"]).default("pr-title"),
					rebaseMerge: z.boolean().default(false),
					squashMerge: z.boolean().default(true),
					squashMessage: z.enum(["blank", "commit-messages", "pr-body"]).default("pr-body"),
					squashTitle: z.enum(["commit-title", "pr-title"]).default("pr-title"),
				})
				.describe("Merge methods, commit message defaults, and PR automation.")
				.strict()
				.prefault({}),
			releasesImmutable: z
				.boolean()
				.describe("Disallow modifying release assets and tags.")
				.default(true),
			reviews: z
				.object({
					dismissStale: z.boolean().default(true),
					requireCodeOwner: z.boolean().default(true),
					requireConversationResolution: z.boolean().default(true),
					requireSignedCommits: z.boolean().default(false),
					requiredApprovals: z.number().int().min(0).max(10).default(1),
					restrictPushes: z
						.boolean()
						.describe("Limit pushes to users explicitly granted read or higher access.")
						.default(true),
				})
				.describe("Default-branch code review and push restrictions.")
				.strict()
				.prefault({}),
			rulesets: z
				.array(z.string().min(1))
				.describe(
					"Ruleset names that must exist and be active. Fix is manual (author JSON in the UI).",
				)
				.default([]),
			secrets: z
				.array(z.string().min(1))
				.describe("Required Actions secret names (presence only; values are write-only).")
				.default([]),
			security: z
				.object({
					copilotAutofix: z
						.boolean()
						.describe("Copilot Autofix. Check-only: no public API, verify in the UI.")
						.default(false),
					dependabot: z.boolean().describe("Dependabot security updates.").default(true),
					dependencyAutoSubmit: z.boolean().default(true),
					dependencyGraph: z.boolean().default(true),
					privateVulnerabilityReporting: z.boolean().default(true),
					pushProtection: z.boolean().default(true),
					secretProtection: z.boolean().default(true),
				})
				.describe("Advanced Security toggles.")
				.strict()
				.prefault({}),
			signoffRequired: z
				.boolean()
				.describe("Require contributors to sign off on web-based commits.")
				.default(false),
			socialPreview: z
				.boolean()
				.describe(
					"Custom social preview image is set. Check-only: no public API, upload in Settings.",
				)
				.default(true),
			variables: z
				.array(z.string().min(1))
				.describe("Required Actions variable names (presence only).")
				.default([]),
		})
		.strict(),
);

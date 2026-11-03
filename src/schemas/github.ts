import * as v from "valibot";

// Desired GitHub repo state, stored as preset files referenced by each blueprint
// manifest's `github` key (e.g. projects/$presets/github-configs/*.json).
// Every field maps to a GitHub REST endpoint; fields with no public API are
// reported as skipped/manual with a UI hint instead of failing forever.
export const GithubSchema = v.object({
	$schema: v.optional(
		v.pipe(
			v.string(),
			v.description("JSON Schema reference, e.g. ./configuration_schema/github.json."),
		),
	),
	actions: v.optional(
		v.pipe(
			v.object({
				allowApprovePRs: v.optional(
					v.pipe(
						v.boolean(),
						v.description("Allow GitHub Actions to create and approve pull requests."),
					),
					false,
				),
				allowed: v.optional(
					v.pipe(
						v.picklist(["all", "local-only", "selected"]),
						v.description("Which actions and reusable workflows may run."),
					),
					"all",
				),
				approvalForExternal: v.optional(
					v.pipe(
						v.boolean(),
						v.description("Require approval for all external contributors (fork PR workflows)."),
					),
					true,
				),
				defaultWorkflowPermissions: v.optional(
					v.pipe(v.picklist(["read", "write"]), v.description("Default GITHUB_TOKEN permissions.")),
					"read",
				),
				oidcImmutableSubject: v.optional(
					v.pipe(
						v.boolean(),
						v.description(
							"Use the immutable subject claim for OIDC. Check-only: no public fix API.",
						),
					),
					true,
				),
				retentionDays: v.optional(
					v.pipe(
						v.number(),
						v.integer(),
						v.minValue(1),
						v.description("Artifact and log retention in days."),
					),
					90,
				),
				shaPinningRequired: v.optional(
					v.pipe(
						v.boolean(),
						v.description("Require actions to be pinned to a full-length commit SHA."),
					),
					true,
				),
			}),
			v.description("GitHub Actions permissions and retention."),
		),
		{},
	),
	agentSuggestions: v.optional(
		v.pipe(
			v.picklist(["full-control", "disabled"]),
			v.description("Agent suggestions for issues. Check-only: no public API, verify in the UI."),
		),
		"full-control",
	),
	archiveSettings: v.optional(
		v.pipe(
			v.object({
				commitComments: v.optional(
					v.pipe(v.boolean(), v.description("Allow comments on individual commits.")),
					false,
				),
				includeLfsInArchives: v.optional(
					v.pipe(v.boolean(), v.description("Include Git LFS objects in archives.")),
					false,
				),
				pushUpdateLimit: v.optional(
					v.pipe(
						v.number(),
						v.integer(),
						v.minValue(1),
						v.description(
							"Max branches/tags updated in a single push. Omit to skip (no public API).",
						),
					),
				),
			}),
			v.description("Repo archive/push toggles. Check-only: no public API, verify in Settings."),
		),
		{},
	),
	checks: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Required status check contexts on the default branch."),
		),
		["conform", "format", "lint", "types"],
	),
	codeowners: v.optional(
		v.pipe(
			v.string(),
			v.minLength(1),
			v.description(
				"Required CODEOWNERS path, e.g. .github/CODEOWNERS. Omit to skip the presence check.",
			),
		),
	),
	defaultBranch: v.optional(
		v.pipe(v.string(), v.minLength(1), v.description("Default branch name.")),
		"stable",
	),
	environments: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Deployment environments that must exist (created by fix when missing)."),
		),
		["beta", "stable"],
	),
	features: v.optional(
		v.pipe(
			v.object({
				discussions: v.optional(v.pipe(v.boolean()), false),
				issueTemplates: v.optional(
					v.pipe(v.boolean(), v.description("Require .github/ISSUE_TEMPLATE content.")),
					true,
				),
				issues: v.optional(v.pipe(v.boolean()), true),
				projects: v.optional(v.pipe(v.boolean()), false),
				wiki: v.optional(v.pipe(v.boolean()), false),
			}),
			v.description("Repo feature toggles."),
		),
		{},
	),
	merge: v.optional(
		v.pipe(
			v.object({
				autoMerge: v.optional(v.pipe(v.boolean()), true),
				deleteHeadBranches: v.optional(
					v.pipe(v.boolean(), v.description("Automatically delete head branches.")),
					true,
				),
				mergeCommit: v.optional(v.pipe(v.boolean()), true),
				mergeMessage: v.optional(v.pipe(v.picklist(["blank", "pr-body", "pr-title"])), "pr-body"),
				mergeTitle: v.optional(v.pipe(v.picklist(["merge-message", "pr-title"])), "pr-title"),
				rebaseMerge: v.optional(v.pipe(v.boolean()), false),
				squashMerge: v.optional(v.pipe(v.boolean()), true),
				squashMessage: v.optional(
					v.pipe(v.picklist(["blank", "commit-messages", "pr-body"])),
					"pr-body",
				),
				squashTitle: v.optional(v.pipe(v.picklist(["commit-title", "pr-title"])), "pr-title"),
			}),
			v.description("Merge methods, commit message defaults, and PR automation."),
		),
		{},
	),
	releasesImmutable: v.optional(
		v.pipe(v.boolean(), v.description("Disallow modifying release assets and tags.")),
		true,
	),
	reviews: v.optional(
		v.pipe(
			v.object({
				dismissStale: v.optional(v.pipe(v.boolean()), true),
				requireCodeOwner: v.optional(v.pipe(v.boolean()), true),
				requireConversationResolution: v.optional(v.pipe(v.boolean()), true),
				requireSignedCommits: v.optional(v.pipe(v.boolean()), false),
				requiredApprovals: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 1),
				restrictPushes: v.optional(
					v.pipe(
						v.boolean(),
						v.description("Limit pushes to users explicitly granted read or higher access."),
					),
					true,
				),
			}),
			v.description("Default-branch code review and push restrictions."),
		),
		{},
	),
	rulesets: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description(
				"Ruleset names that must exist and be active. Fix is manual (author JSON in the UI).",
			),
		),
		[],
	),
	secrets: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Required Actions secret names (presence only; values are write-only)."),
		),
		[],
	),
	security: v.optional(
		v.pipe(
			v.object({
				copilotAutofix: v.optional(
					v.pipe(
						v.boolean(),
						v.description("Copilot Autofix. Check-only: no public API, verify in the UI."),
					),
					false,
				),
				dependabot: v.optional(
					v.pipe(v.boolean(), v.description("Dependabot security updates.")),
					true,
				),
				dependencyAutoSubmit: v.optional(v.pipe(v.boolean()), true),
				dependencyGraph: v.optional(v.pipe(v.boolean()), true),
				privateVulnerabilityReporting: v.optional(v.pipe(v.boolean()), true),
				pushProtection: v.optional(v.pipe(v.boolean()), true),
				secretProtection: v.optional(v.pipe(v.boolean()), true),
			}),
			v.description("Advanced Security toggles."),
		),
		{},
	),
	signoffRequired: v.optional(
		v.pipe(v.boolean(), v.description("Require contributors to sign off on web-based commits.")),
		false,
	),
	socialPreview: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				"Custom social preview image is set. Check-only: no public API, upload in Settings.",
			),
		),
		true,
	),
	variables: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1))),
			v.description("Required Actions variable names (presence only)."),
		),
		[],
	),
});

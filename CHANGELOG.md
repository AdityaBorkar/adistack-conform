# @adistack/conform

## 0.2.0

### Minor Changes

- c477fc9: Add `--strict` and align the machine manifest with the rewritten ADRs and glossary

  - New `--strict` on `check` and `fix`: undeclared machine packages (extras) become fixable drift (removal) instead of skipped
  - **Breaking:** drop the unused `params` and `system` fields from the machine manifest schema
  - ADRs rewritten and renumbered (0001–0013) in pipeline order; glossary reduced to concepts

- c477fc9: Fix secret leaks, never-converging fixes, and subdirectory runs

  - Never print decrypted template secrets in `check`, `--json`, or `fix` diffs
  - Keep file modes on `.conform.bak` backups and write templated files with their declared mode, so secrets are never world-readable
  - Count a declared pacman package installed as a dependency as installed (its fix could never succeed)
  - Resolve project targets against the directory that owns `conform.json`, not the cwd
  - Send branch-protection allowances as login/slug lists so the GitHub fix no longer fails with HTTP 422
  - A `--*-only` flag naming an unconfigured scope exits 2
  - Reject a leading `/` in project blueprint `source` paths (same rule as machine sources)
  - Rename the generated consumer schema to `config/conform.json`, as documented
  - Drop the `untildify` dependency

- c477fc9: Load `conform.json` and `registry.json` from the cwd only (no directory walking)
- c477fc9: Close fix-flow security holes and tighten secrets templates

  - **Security:** a file fix refuses a symlinked target before taking its backup, so a planted link (e.g. `AGENTS.md -> ~/.ssh/id_ed25519`) can no longer copy its target into the workspace
  - **Security:** non-TTY `fix --all` judges "inside the project" by real path, so a symlinked parent directory cannot carry a write outside the project; link fixes outside the project are refused like file writes
  - **Security, breaking:** a secrets template substitutes only the secrets listed in its `secrets`, and its `mode` defaults to `0600` (enforced by `check`, applied by `fix`); secrets fixes keep one `.conform.bak` instead of piling up decrypted copies
  - **Security, breaking:** machine package and allowlist names must match `[A-Za-z0-9@_+][A-Za-z0-9@._+/-]*`; pacman fixes pass `--` before names
  - After `fix`, a GitHub auth skip or machine domain error on the re-check no longer reads as "fixed": the previous failure stands
  - A link whose target is a directory is manual (the fix could never replace it); link fixes write the exact bytes the check compared and swap the link atomically instead of running `ln -sfn`
  - `secrets.yaml` keys may contain `.` and `-` (e.g. `npm-token`)
  - `pacman -Q`, `bun pm -g ls` and `sops --decrypt` time out after 60s instead of hanging `check`
  - **Breaking:** secrets-template IDs are `machine:<blueprint>:secrets-template:<name>` (was `…:template:…`), matching the glossary
  - The PR preview comment finds its previous comment on PRs with over 100 comments

- c477fc9: Flat GitHub manifest (breaking).

  The `general`, `code_planning_automation`, `security_and_quality`, and `community` wrappers are gone: their fields now live at the manifest top level in Settings-sidebar order (`default_branch`, `rulesets`, `actions`, `advanced_security`, `codeowners`, …). Only `access` and `integrations` stay grouped. Old nested blueprints fail `validate`/`check` with unrecognized-key errors until moved. Run `bun dev validate` in the tech-stack repo after migrating.

- c477fc9: Cover the full GitHub Settings sidebar in the GitHub scope, in UI nesting order

  - New optional blueprint fields (all backward compatible): General identity (`description`, `homepage`, `topics`, `visibility`, `isTemplate`, `allowForking`, `allowUpdateBranch`, `archived`, `hasPullRequests`), `access` (collaborators, teams), `tagProtection` (check-only, legacy API closing down — use rulesets), `pages`, `autolinks`, `community` files, `deployKeys` (manual), `codespacesSecrets`/`dependabotSecrets`/`environmentSecrets`, `interactionLimits` (manual), `requiredWorkflows` (manual), `notificationEmail` (skipped with UI hint), `selectedPatterns` for selected-actions, and security `nonProviderPatterns`/`aiDetection`
  - New checks: `access`, `access-limits`, `community`, `tag-protection`, `required-workflows`, `pages`, `deploy-keys`, `autolinks`, `notifications`; `general` now covers topics via `PUT /topics`; `secrets` now covers Codespaces/Dependabot/per-environment secrets (manual via `gh secret set`)
  - Manual where the API has no write path (or is closing down/time-boxed/high-risk): community files, deploy keys, tag protection, required workflows, interaction limits; `notifications` always skips with a Settings → Notifications hint
  - Intentionally not fields: repo name/transfer/delete (destructive or breaks target), self-hosted runners (ephemeral), merge queue (enforce via rulesets)

- c477fc9: Require every GitHub settings property explicitly and pass disabled checks

  - `github-settings` schema no longer applies defaults: every domain property must be defined (`[]`, `""`, `false`, or `null` disables a check)
  - `codeowners` uses `""` to disable; `archiveSettings.pushUpdateLimit` uses `null` to skip
  - Disabled or empty upstreams now pass instead of skipping (`codeowners: ""`, `issueTemplates: false`, empty `rulesets`/`environments`/`secrets`/`variables`, `oidcImmutableSubject: false`, check-only items when off)
  - Check-only items (social preview, archive toggles, Copilot Autofix, dependency auto-submit, agent suggestions, OIDC) skip only when on; auth and unreadable-API skips are unchanged

- c477fc9: GitHub settings manifest v2: nested by the Settings sidebar (breaking, ADR 0015)

  The `github` manifest is now a tree in Settings-sidebar order: `general` → `access?` → `codePlanningAutomation` → `securityAndQuality` → `integrations?` → `community?`. Every leaf's schema description names its UI path and whether conform fixes it (API), only reads it (READ, manual), or cannot see it (UI, passes when off/default, else skipped with the exact Settings path). Old flat blueprints fail `validate`/`check` with unrecognized-key errors until moved. Run `bun dev validate` (or `bunx @adistack/conform validate`) in the tech-stack repo after migrating.

  | v1 key                                                                                                             | v2 path                                                                                                                                        |
  | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | `description`, `homepage`, `topics`, `defaultBranch`, `socialPreview`, `customProperties`, `releases`              | `general.*` (same names)                                                                                                                       |
  | `isTemplateRepo` (earlier `isTemplate`)                                                                            | `general.templateRepository`                                                                                                                   |
  | `features.wiki`                                                                                                    | `general.features.wikis.enabled`                                                                                                               |
  | `features.issues` (earlier boolean `issues`), `features.sponsorships`, `features.discussions`, `features.projects` | `general.features.*`                                                                                                                           |
  | `features.issueTemplates`                                                                                          | `community.issueTemplates`                                                                                                                     |
  | `pullRequests` (earlier `merge` + `features.pullRequests`)                                                         | `general.pullRequests` (unchanged object)                                                                                                      |
  | `signoffRequired`                                                                                                  | `general.commits.signoffRequired`                                                                                                              |
  | `archiveSettings.commitComments` / `.includeLfsInArchives` / `.pushUpdateLimit`                                    | `general.commits.commentsAllowed` / `general.archives.includeLfsObjects` / `general.pushes.updateLimit`                                        |
  | `visibility`, `allowForking`, `archived`                                                                           | `general.dangerZone.*`                                                                                                                         |
  | `access.collaborators`, `access.teams`                                                                             | `access.collaborators`, `access.teams`                                                                                                         |
  | `interactionLimits`                                                                                                | `access.moderation.interactionLimits` (values `contributors` → `contributors_only`, `collaborators` → `collaborators_only`; optional `expiry`) |
  | `pullRequestLimits`                                                                                                | `access.moderation.pullRequestLimits`                                                                                                          |
  | `checks`                                                                                                           | `codePlanningAutomation.branches.requiredStatusChecks`                                                                                         |
  | `reviews`                                                                                                          | `codePlanningAutomation.branches.reviews` (`branches` is optional: omit it when rulesets protect the branch)                                   |
  | `tagProtection`                                                                                                    | removed (endpoint gone): use a ruleset with `target: "tag"`                                                                                    |
  | `rulesets` (names), `mergeQueue`, `requiredWorkflows`                                                              | `codePlanningAutomation.rulesets[]` full objects (merge queue = `rules.mergeQueue`; required workflows dropped, org-only)                      |
  | `actions.allowed`, `.shaPinningRequired`, `.retentionDays`                                                         | `codePlanningAutomation.actions.general.*`                                                                                                     |
  | `actions.approvalForExternal`                                                                                      | `actions.general.forkPrApproval` (`true` → `"all_external_contributors"`, `false` → `"first_time_contributors"`)                               |
  | `actions.defaultWorkflowPermissions` / `.allowApprovePRs`                                                          | `actions.general.workflowPermissions.default` / `.canApprovePullRequests`                                                                      |
  | `actions.selectedPatterns`                                                                                         | `actions.general.selected.patterns`                                                                                                            |
  | `actions.oidcImmutableSubject`                                                                                     | `actions.oidc.immutableSubject` (with `useDefault`)                                                                                            |
  | `runners`, `actionsPolicies`                                                                                       | `actions.runners`, `actions.policies`                                                                                                          |
  | `webhooks`                                                                                                         | `codePlanningAutomation.webhooks`                                                                                                              |
  | `copilot.*` booleans                                                                                               | `codePlanningAutomation.copilot` subtree (`codeReview`, `cloud`, `internetAccess`, `mcp`, `memory`, `dreaming`)                                |
  | `planning`                                                                                                         | `codePlanningAutomation.planning` (no `"disabled"`: that option does not exist)                                                                |
  | `environments` + `environmentProtection` + `environmentSecrets`                                                    | `codePlanningAutomation.environments` record (`{}` = must exist; `secrets` per environment)                                                    |
  | `codespaces`, `pages`                                                                                              | `codePlanningAutomation.codespaces`, `codePlanningAutomation.pages`                                                                            |
  | `codespacesSecrets`                                                                                                | `securityAndQuality.secrets.codespaces`                                                                                                        |
  | `security.secretProtection` / `.pushProtection` / `.nonProviderPatterns` / `.aiDetection`                          | `securityAndQuality.advancedSecurity.secretProtection.enabled` / `.pushProtection` / …                                                         |
  | `security.dependabot`                                                                                              | `advancedSecurity.dependabot.securityUpdates` (new required `dependabot.alerts`)                                                               |
  | `security.dependencyGraph`                                                                                         | `advancedSecurity.dependencyGraph`                                                                                                             |
  | `security.dependencyAutoSubmit`                                                                                    | `advancedSecurity.automaticDependencySubmission` (`true` → `"enabled"`, `false` → `"disabled"`)                                                |
  | `security.privateVulnerabilityReporting`                                                                           | `advancedSecurity.privateVulnerabilityReporting.enabled`                                                                                       |
  | `security.copilotAutofix`                                                                                          | `advancedSecurity.codeScanning.copilotAutofix`                                                                                                 |
  | `deployKeys` (titles)                                                                                              | `securityAndQuality.deployKeys[]{title, readOnly?}`                                                                                            |
  | `secrets`, `variables` / `agentsSecrets`, `agentsVariables` / `dependabotSecrets`                                  | `securityAndQuality.secrets.actions.{secrets,variables}` / `.agents.{secrets,variables}` / `.dependabot`                                       |
  | `community.dependabotConfig`                                                                                       | `advancedSecurity.dependabot.versionUpdates`                                                                                                   |
  | `githubApps`, `autolinks`                                                                                          | `integrations.*`                                                                                                                               |
  | `notificationEmail`                                                                                                | `integrations.emailNotifications.addresses`                                                                                                    |
  | `codeowners`, `community.*`                                                                                        | `community.*` (`codeowners` now optional)                                                                                                      |

  Behaviour changes:

  - New fixable checks: `rulesets` (deep compare by name; POST missing, PUT drifted; undeclared rulesets ignored), `access-limits` (PUT/DELETE interaction limits), `actions-fork-pr-private`, `actions-access` (422 on public repos → skipped), `actions-cache` (402 → skipped), `actions-oidc` (subject template + immutable subject), `copilot-code-review`, `dependabot-runner` (404 → skipped), `code-scanning` (default setup), `ai-scan`; `actions-permissions` adds `enabled` and selected actions, `environment-protection` adds tag patterns, `general` adds PR creation permissions (`pull_request_creation_policy`, was UI-only `pr-permissions`), `security` adds delegated bypass/alert dismissal and Dependabot alerts, `webhooks` adds `insecureSsl`, `pages` adds `buildType`/`public`.
  - New READ (manual) checks: `copilot-cloud`, `dependabot-version-updates`; validity checks, custom patterns, environment admin bypass and custom protection rules, environment variables and deploy-key `readOnly` ride existing checks.
  - New UI-only ids: `wiki-editing`, `preserve-repository`, `branch-protection-disabled`, `code-review-limits`, `codespaces-prebuilds`, `pvr-settings`, `dependabot-rules`, `advanced-security-ui`.
  - Removed ids: `pr-permissions` (folded into `general`), `tag-protection`, `required-workflows`, `merge-queue`, and the `security-vuln-reporting`/`security-dependabot` auth notes (an auth failure skips the whole `security` check).
  - Fixed: the dependency graph was checked through `/vulnerability-alerts` (that is Dependabot alerts); it is now UI-only (passes when on for a public repo). Classic branch protection is optional, so ruleset-only repos no longer drift. Environment branch patterns were read without the `branch_policies` collection. Omitted optional sections now produce no result instead of a pass.
  - Check ids are otherwise unchanged (ADR 0012).

- c477fc9: Round out GitHub Settings coverage and order the schema by the Settings sidebar

  - New optional blueprint fields: `runners` (self-hosted runner presence audit, manual registration), `mergeQueue` (merge_queue rule details read from rulesets, manual authoring), `environmentProtection` (per-environment wait timer, self-review, required reviewers with ID resolution, and branch policy with patterns — fixable via the Environments API), `customProperties` (repo values, fixable via PATCH), `codespaces.devcontainerRequired` (manual file presence)
  - `src/schemas/github-settings.ts` top-level order now follows the Settings sidebar (General → Access → Branches → Tags → Rules → Actions → Webhooks → Environments → Codespaces → Pages → Security → Secrets → Community → Integrations → Other)
  - New checks wired in the same order: `custom-properties`, `codespaces`, `merge-queue`, `runners`, `environment-protection`
  - Attestations documented as intentionally field-less (per-artifact provenance, no repo toggle); Codespaces machine/access policies documented as org-level or UI-only

- c477fc9: Snake_case GitHub manifest fields (breaking).

  All `github` blueprint fields are now `snake_case` (`default_branch`, `pull_requests`, `social_preview`, `danger_zone`, `code_planning_automation`, `security_and_quality`, etc., including `review_on_push`/`review_draft_pull_requests` and `required_approvals`). Old camelCase blueprints fail `validate`/`check` with unrecognized-key errors until moved. Run `bun dev validate` in the tech-stack repo after migrating.

- c477fc9: Add `webhooks` management to the GitHub scope

  - New `github:<blueprint>:webhooks` check: declared webhooks (matched by payload URL) enforce `events[]`, `active`, and `contentType`; undeclared hooks are ignored
  - Missing hooks are fixable via `POST /hooks`, drifted hooks via `PATCH /hooks/{id}` (admin token, TTY only)
  - Empty `webhooks: []` passes; webhook secrets stay manual (the API never returns secret values)

- a66752e: Rename glossary-violating identifiers and strings

  BREAKING: the following names change — update configs and scripts accordingly.

  - `kind: preset` → `kind: project`
  - `unfixable` result → `manual`
  - `--config` flag → `--desired-state`
  - `GithubPreset` type → `GithubSettings`
  - `--json` output `configs` key → `desiredStates`
  - Rewrite ADRs 0001 and 0003 around Zod schemas and ignore-only compare
  - Document `validate`, `file_structure`, template, non-TTY, and recheck semantics

- c477fc9: Merge machine `links[]` + `templates[]` into a single `files[]` field

  - Machine manifests declare `files[]` (`name`, `source`, `target`, optional `mode` `0600`/`0644`, optional `secrets`); a file with `secrets` is a secrets template, without it a link
  - A secrets template's `mode` defaults to `0600`

- c477fc9: Point machine registry entries at manifest files

  BREAKING: `registry.json` machine entries must point at blueprint files.

  - Machine entries are plain `key/path` pairs like projects (e.g. `"main": "./machines/main.json"`); the `{ name, path }` directory form is rejected
  - The CLI fetches the manifest file directly instead of resolving `<dir>/machine.json`; display-name matching is gone (the name lives in the manifest `@name`)

- c477fc9: Remove nix remnants and the `machine.configuration` shim

  - `machine.configuration` is removed from `conform.json` (was accepted but ignored since the JSON manifest pipeline replaced the nix dry-run); configs still setting it now fail schema validation
  - Docs no longer mention `home-manager`/`nix`/`flake`/`homeConfigurations`: machine scope is manifest (`machines/<name>.json`) packages plus `files[]`, checked against installed packages and `$HOME`

- c477fc9: Replace the nix machine check with the JSON machine manifest pipeline

  - `check --machine-only` evaluates the machine manifest listed in `registry.json` `machines` (versioned `packages.pacman`/`packages.bun` maps plus `files[]`) against installed packages and `$HOME`; undeclared extras are skipped unless `--strict`; pinned-version drift is always drift
  - `fix` applies machine drift through the same TTY/`--all` gate as every other scope
  - `validate` reads each machine manifest and asserts every `files[]` source exists on disk
  - Machine results are per item: `machine:<blueprint>:<pacman|bun|link|secrets-template>:<name>`

- c477fc9: Rename the global `--desired-state <path>` flag to `--path <path>`
- c477fc9: Move `--path <path>` from a global flag to a per-command flag (`check --path`, `fix --path`, `validate --path`) with per-command help
- c477fc9: Nest `agentSuggestions` under a `planning` object in GitHub settings

  - `planning: { agentSuggestions: "full-control" | "disabled" }` replaces the top-level `agentSuggestions` key
  - Update blueprints: move the key and reship; the old top-level key is rejected

- c477fc9: Rename blueprint metadata keys from `@name`/`@description` to `$name`/`$description`

  - Applies to project, machine, and github-settings manifests; matches what the tech-stack repo already ships
  - Old `@`-prefixed keys are rejected (strict objects); update manifests and reship blueprints

- 80f82cf: Harden `check` and `fix` against untrusted blueprints and hostile input

  - Never forward `GITHUB_TOKEN` on cross-origin redirects
  - Reject `..` and empty segments in registry and blueprint `source` paths
  - Validate `owner/repo` and `ref` values before building URLs
  - Refuse symlink targets in file fixes; non-TTY `--all` refuses writes outside the project directory
  - Version backup files instead of overwriting them
  - Report `manual` instead of overwriting for `compare.ignore` on non-JSON files and array-root template upstreams
  - Match templates in linear time with a depth cap
  - Use strict `conform.json`, registry, and settings schemas with sane bounds
  - Share one repo read across GitHub checks, run at most 6-wide with retries, and report per-check auth skips
  - Print `validate` failures to stderr and check machine entry paths
  - Give `fix` its own timeout with SIGKILL escalation and detached stdin
  - Read `--version` from `package.json` at build time

- 3be9109: Drop `compare.required` in favour of automatic template detection

  - Any upstream containing `<...>` placeholders is now a template — no `required` flag needed
  - Placeholder slots accept any per-project value that is non-empty, contains no placeholders, and matches the surrounding text
  - Every other field must exactly match the upstream
  - Manifests are strict: unknown `required`, `pinned`, and `directories` keys are rejected instead of ignored

- 3be9109: Drop the directory blueprint layout

  BREAKING: `registry.json` project entries must point at blueprint files.

  - Point project entries at blueprint files (e.g. `./projects/cli-app.json`)
  - Keep `source` paths repo-relative
  - `./` and `../` sources are rejected, as is `<dir>/project-manifest.json` resolution

- 4d426e7: Drop unused project features and simplify `target` and `compare`

  BREAKING: the following project options are removed.

  - Removed `js` toolchain dependencies
  - Removed `compare.strip` and `compare.versioned`
  - Removed `docs:`, `~/`, and `%VAR%` targets, plus empty-upstream defaults
  - `target` is always a cwd-relative path
  - `compare` supports `ignore[]` only

- ee538e6: Add `validate` command for tech-stack authors (not consumers)

  - Validates the local tech-stack repo: `registry.json`, every blueprint in every section, every `files[]` source on disk
  - Run as `adistack-conform validate [path]` from the tech-stack repo's own `verify` script; never reads `conform.json`

- c477fc9: `validate` uses the global `--path` flag instead of its own `[path]` argument
- c477fc9: Glossary-compliance wire renames and explicit skipped state

  - Machine check kind is `machine` (was `nix`); IDs are `machine:<blueprint>:<section>:<name>`
  - `CheckResult.source` is now `upstream`
  - User-facing wording says fix (was apply)
  - Skipped results now carry `ok: false` with `skipped: true` but still exit 0; `--json` `failed` and exit codes exclude skips
  - New ADRs 0010 (fix safety) and 0012 (exit taxonomy and wire names)

### Patch Changes

- c477fc9: Fix command naming, exit-code docs, and missing machine page

  - Examples use `bunx @adistack/conform` (the published command), not `adistack-conform`; CLI help names the command `@adistack/conform`
  - Document the exit contract explicitly: a `registry.json` that cannot be fetched is exit 2, an invalid registry is exit 1 (exit 2 only when no registry file exists), and non-TTY `fix --all` refuses the whole run when even one fix runs a command, calls the GitHub API, or writes outside the project
  - Add the missing `machine` user page (packages, dotfile links, secrets templates) and link it from blueprints, concepts, and configuration
  - `api.md` no longer references the non-existent `gen:json-schema` script and drops the build/conventions section (lives in `AGENTS.md`); fix the stray `</Accordion>` in `blueprint-files.md`

- c477fc9: Expand the bundled `adistack-conform` skill: end-repo usage, result triage, fix safety, and a tech-stack authoring reference.
- bb25f68: Fix GitHub repo-settings checks to match the GitHub REST API

  - `actions.allowed` accepts API values (`all`, `local_only`, `selected`) instead of `local-only`
  - Fork PR approval compares real `approval_policy` values (`all_external_contributors`, `first_time_contributors`) and fixes via PUT
  - Private vulnerability reporting reads the `enabled` flag instead of treating response presence as enabled
  - Dependency graph is enforced via the `vulnerability-alerts` endpoint; it is no longer sent in the `security_and_analysis` PATCH, which the API rejects
  - Dependabot 404 is treated as disabled instead of an error
  - Copilot Autofix always reports a UI-hint skip since it has no API equivalent
  - Enabling push restrictions from scratch with an empty allowlist is manual — the API rejects empty actor lists

- c477fc9: `check` warns on stderr when the github scope runs without `GITHUB_TOKEN`, since those checks are skipped. When `GITHUB_TOKEN` is unset, the GitHub token now falls back to `gh auth token`.
- c477fc9: Harden machine link fixes and secrets-template placeholders

  - Dangling links (right dest, missing cache file) fail as fixable instead of passing
  - Link fixes materialize the upstream at `<target>.conform-src` before linking, so they never leave a dangling symlink
  - Link fixes back up a regular file to `.conform.bak` before replacing it
  - Unresolved `@@placeholders@@` of any case are reported as leftover instead of only `UPPER_CASE`
  - `mode` on a link entry (without `secrets`) is rejected by the manifest schema
  - Link upstreams are fetched as raw bytes so binary dotfiles compare correctly

- c477fc9: Tighten machine validation and registry lookup

  - `validate` also asserts the manifest-adjacent `secrets.yaml` exists on disk when any file declares `secrets`
  - Registry lookup is exact key plus repo-relative path only; basename-only matching no longer silently resolves typos to the wrong blueprint

- c477fc9: Replace hand-rolled utils with libraries: `jsonc-parser` for JSONC parsing, `p-limit` for concurrency, `p-retry` for fetch retries, `fast-deep-equal` for deep equality
- c477fc9: Call the `conform.json` `source` (tech-stack repo + ref) the "pin" in schema descriptions and error messages
- c477fc9: `validate` and `conform.json` loading now parse JSONC like `check` does, so a blueprint or registry with comments or trailing commas no longer fails `validate` while `check` accepts it. After `fix`, a re-checked result that comes back skipped (e.g. a GitHub 403 on one settings read) keeps its previous failure instead of being counted as fixed. Internally, every scope implements one check interface, project result ids are built in one place, blueprint kinds share one table between `check` and `validate`, and each fix kind's describe/preview/JSON/apply rules live in one table.
- c477fc9: A project blueprint can no longer use the same `name` in both `files[]` and `file_structure[]`. Both entries used to get the same result id, `project:<blueprint>:<name>`, so after `fix` the re-check could merge them or report the wrong one as resolved. The blueprint schema now rejects the shared name, and `check`/`validate` report it as an invalid blueprint. A scope run that still produces a repeated result id now fails as that scope's internal error instead of corrupting the re-check.

  Internally, `check`, `fix` and `validate` now read the pinned tech-stack repo through one module, with the same parsing and the same missing-file classification whether it is fetched or read from a local checkout. Every scope builds its result ids in one place. Result ids and output are unchanged.

Entries are generated from changesets on each release.

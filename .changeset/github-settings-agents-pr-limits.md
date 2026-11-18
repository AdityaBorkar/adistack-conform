---
"@adistack/conform": major
---

Nest Issues/PR audience settings under `features` for better reference (breaking: boolean `features.issues` becomes an object)

- `features.issues: boolean` → `features.issues: { enabled: boolean, permissions?: "all-users" | "collaborators-only", autoClose?: boolean }`
- `features.hasPullRequests?: boolean` → `features.pullRequests?: { enabled?: boolean, permissions?: "all-users" | "collaborators-only" }`
- Top-level `autoCloseLinkedIssues` / `issuePermissions` / `prPermissions` removed; use `features.issues.autoClose`, `features.issues.permissions`, `features.pullRequests.permissions`
- `releasesImmutable: boolean` → `releases: { immutable: boolean }` (General → Releases)
- `isTemplate` renamed to `isTemplateRepo` (same `is_template` PATCH field, clearer reference)
- New required `features.sponsorships: boolean` (General → Sponsorships → Sponsor button; check-only: pass when `false`, skipped with a UI hint when `true` — no public repo read API)
- Check ids are unchanged (`general`, `releases`, `auto-close`, `issue-permissions`, `pr-permissions`), so wire output and re-check narrowing are stable, except one addition: `sponsorships` (pass when `features.sponsorships` is `false`, skipped with a UI hint when `true`)
- Migration: `"issues": true` → `"issues": { "enabled": true }`; move the three audience keys inside; `"releasesImmutable": true` → `"releases": { "immutable": true }`; `"isTemplate"` → `"isTemplateRepo"`; add `"sponsorships": false` under `features`; old blueprints fail `validate`/`check` with the unrecognized-key error until moved

Also in this release (minor additions, optional and backward compatible):

- `planning.agentSuggestions` now accepts the live automation levels `full-control | cautious | balanced | full-automation | disabled` (Settings → Planning → Agent suggestions for issues; Cautious is the default). Check-only: `disabled` passes, the rest skip with a UI hint (no public read API)
- New optional `agentsSecrets[]` / `agentsVariables[]` presence checks via `GET /repos/{repo}/agents/secrets|variables` (Settings → Secrets → Agents); values are write-only so drift is manual (`gh secret set --app agents`)
- `pullRequestLimits{maxOpen,countDrafts,minAccountAgeDays,minMergedPRs}` under Access → Moderation (Settings → Interaction limits → Pull request limits); check-only skipped with a UI hint (no public repo read API), omit to skip
- New check-only General fields (skipped with UI hint when set, no public repo read API): `features.issues.autoClose`, `features.issues.permissions`, `features.pullRequests.permissions`
- New check-only Code/automation fields: `actionsPolicies[]` (Settings → Actions → Policies), `copilot{codeReview,codingAgent,internetAccessFirewall,mcp,memory}` (Settings → Copilot suite; dreaming has no repo toggle)
- New check-only `githubApps[]` (Settings → Integrations → GitHub Apps; install via UI/marketplace)
- `reviews.restrictPushes` now documented as enforcing Moderation → code review limits via branch protection restrictions
- Dialog mapping: rename-branch → `defaultBranch`, change-visibility → `visibility`, archive → `archived` (API fixes, no dialog needed); transfer/delete dialogs are destructive with no field — use the UI
- Docs: SKILL.md check list fixed (`variables` ride the `secrets` check — no separate id; added missing `social-preview/archive-settings/agent-suggestions/copilot-autofix/dependency-auto-submit` ids) and tech-stack reference updated

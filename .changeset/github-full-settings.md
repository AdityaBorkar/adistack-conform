---
"@adistack/conform": minor
---

Cover the full GitHub Settings sidebar in the GitHub scope, in UI nesting order

- New optional blueprint fields (all backward compatible): General identity (`description`, `homepage`, `topics`, `visibility`, `isTemplate`, `allowForking`, `allowUpdateBranch`, `archived`, `hasPullRequests`), `access` (collaborators, teams), `tagProtection` (check-only, legacy API closing down — use rulesets), `pages`, `autolinks`, `community` files, `deployKeys` (manual), `codespacesSecrets`/`dependabotSecrets`/`environmentSecrets`, `interactionLimits` (manual), `requiredWorkflows` (manual), `notificationEmail` (skipped with UI hint), `selectedPatterns` for selected-actions, and security `nonProviderPatterns`/`aiDetection`
- New checks: `access`, `access-limits`, `community`, `tag-protection`, `required-workflows`, `pages`, `deploy-keys`, `autolinks`, `notifications`; `general` now covers topics via `PUT /topics`; `secrets` now covers Codespaces/Dependabot/per-environment secrets (manual via `gh secret set`)
- Manual where the API has no write path (or is closing down/time-boxed/high-risk): community files, deploy keys, tag protection, required workflows, interaction limits; `notifications` always skips with a Settings → Notifications hint
- Intentionally not fields: repo name/transfer/delete (destructive or breaks target), self-hosted runners (ephemeral), merge queue (enforce via rulesets)

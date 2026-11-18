---
"@adistack/conform": minor
---

Round out GitHub Settings coverage and order the schema by the Settings sidebar

- New optional blueprint fields: `runners` (self-hosted runner presence audit, manual registration), `mergeQueue` (merge_queue rule details read from rulesets, manual authoring), `environmentProtection` (per-environment wait timer, self-review, required reviewers with ID resolution, and branch policy with patterns — fixable via the Environments API), `customProperties` (repo values, fixable via PATCH), `codespaces.devcontainerRequired` (manual file presence)
- `src/schemas/github-settings.ts` top-level order now follows the Settings sidebar (General → Access → Branches → Tags → Rules → Actions → Webhooks → Environments → Codespaces → Pages → Security → Secrets → Community → Integrations → Other)
- New checks wired in the same order: `custom-properties`, `codespaces`, `merge-queue`, `runners`, `environment-protection`
- Attestations documented as intentionally field-less (per-artifact provenance, no repo toggle); Codespaces machine/access policies documented as org-level or UI-only

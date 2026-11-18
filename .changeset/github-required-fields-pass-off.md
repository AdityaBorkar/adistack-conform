---
"@adistack/conform": minor
---

Require every GitHub settings property explicitly and pass disabled checks

- `github-settings` schema no longer applies defaults: every domain property must be defined (`[]`, `""`, `false`, or `null` disables a check)
- `codeowners` uses `""` to disable; `archiveSettings.pushUpdateLimit` uses `null` to skip
- Disabled or empty upstreams now pass instead of skipping (`codeowners: ""`, `issueTemplates: false`, empty `rulesets`/`environments`/`secrets`/`variables`, `oidcImmutableSubject: false`, check-only items when off)
- Check-only items (social preview, archive toggles, Copilot Autofix, dependency auto-submit, agent suggestions, OIDC) skip only when on; auth and unreadable-API skips are unchanged

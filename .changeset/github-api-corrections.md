---
"@adistack/conform": patch
---

Fix GitHub repo-settings checks to match the GitHub REST API

- `actions.allowed` accepts API values (`all`, `local_only`, `selected`) instead of `local-only`
- Fork PR approval compares real `approval_policy` values (`all_external_contributors`, `first_time_contributors`) and fixes via PUT
- Private vulnerability reporting reads the `enabled` flag instead of treating response presence as enabled
- Dependency graph is enforced via the `vulnerability-alerts` endpoint; it is no longer sent in the `security_and_analysis` PATCH, which the API rejects
- Dependabot 404 is treated as disabled instead of an error
- Copilot Autofix always reports a UI-hint skip since it has no API equivalent
- Enabling push restrictions from scratch with an empty allowlist is manual — the API rejects empty actor lists

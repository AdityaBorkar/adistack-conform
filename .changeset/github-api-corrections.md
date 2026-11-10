---
"@adistack/conform": patch
---

Fix GitHub repo-settings IaC to match the GitHub REST API: `actions.allowed` uses API values (`local_only` instead of `local-only`); fork PR approval compares real `approval_policy` values (`all_external_contributors` / `first_time_contributors`) and is fixable via PUT; private vulnerability reporting reads the `enabled` flag instead of response presence; dependency graph is enforced via `vulnerability-alerts` (removed from the `security_and_analysis` PATCH which rejects it) and Dependabot 404 counts as disabled; Copilot Autofix always reports a UI-hint skip; enabling push restrictions from scratch is manual (the API rejects empty allowlists).

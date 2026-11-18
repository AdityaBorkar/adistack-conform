---
"@adistack/conform": minor
---

Snake_case GitHub manifest fields (breaking).

All `github` blueprint fields are now `snake_case` (`default_branch`, `pull_requests`, `social_preview`, `danger_zone`, `code_planning_automation`, `security_and_quality`, etc., including `review_on_push`/`review_draft_pull_requests` and `required_approvals`). Old camelCase blueprints fail `validate`/`check` with unrecognized-key errors until moved. Run `bun dev validate` in the tech-stack repo after migrating.

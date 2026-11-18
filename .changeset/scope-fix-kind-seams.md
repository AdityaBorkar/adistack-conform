---
"@adistack/conform": patch
---

`validate` and `conform.json` loading now parse JSONC like `check` does, so a blueprint or registry with comments or trailing commas no longer fails `validate` while `check` accepts it. After `fix`, a re-checked result that comes back skipped (e.g. a GitHub 403 on one settings read) keeps its previous failure instead of being counted as fixed. Internally, every scope implements one check interface, project result ids are built in one place, blueprint kinds share one table between `check` and `validate`, and each fix kind's describe/preview/JSON/apply rules live in one table.

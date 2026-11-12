---
"@adistack/conform": minor
---

Rename glossary-violating identifiers and strings

BREAKING: the following names change — update configs and scripts accordingly.

- `kind: preset` → `kind: project`
- `unfixable` result → `manual`
- `--config` flag → `--desired-state`
- `GithubPreset` type → `GithubSettings`
- `--json` output `configs` key → `desiredStates`
- Rewrite ADRs 0001 and 0003 around Zod schemas and ignore-only compare
- Document `validate`, `file_structure`, template, non-TTY, and recheck semantics

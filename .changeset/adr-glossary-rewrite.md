---
"@adistack/conform": minor
---

Merge `switch` into `fix` and align code with the rewritten ADRs and glossary

- **Breaking:** remove the `switch` command. Machine drift is fixed by `fix` through the same TTY/`--all` gate as every other scope.
- New `--strict` on `check` and `fix`: undeclared machine packages (extras) become fixable drift (removal) instead of skipped.
- **Breaking:** drop the unused `params` and `system` fields from the machine manifest schema.
- Post-fix re-check treats a selected ID that no longer exists (a removed extra) as resolved.
- ADRs rewritten (18 → 13, renumbered in pipeline order) and glossary reduced to concepts; rename `applyMachineFixes` → `fixSelectedAcrossScopes`, `TechStackRunOptions` → `ProjectCheckOptions`

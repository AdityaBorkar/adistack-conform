---
"@adistack/conform": minor
---

Add `--strict` and align the machine manifest with the rewritten ADRs and glossary

- New `--strict` on `check` and `fix`: undeclared machine packages (extras) become fixable drift (removal) instead of skipped
- **Breaking:** drop the unused `params` and `system` fields from the machine manifest schema
- ADRs rewritten and renumbered (0001–0013) in pipeline order; glossary reduced to concepts

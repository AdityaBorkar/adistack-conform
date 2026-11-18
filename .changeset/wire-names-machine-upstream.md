---
"@adistack/conform": minor
---

Glossary-compliance wire renames and explicit skipped state

- Machine check kind is `machine` (was `nix`); IDs are `machine:<blueprint>:<section>:<name>`
- `CheckResult.source` is now `upstream`
- User-facing wording says fix (was apply)
- Skipped results now carry `ok: false` with `skipped: true` but still exit 0; `--json` `failed` and exit codes exclude skips
- New ADRs 0010 (fix safety) and 0012 (exit taxonomy and wire names)

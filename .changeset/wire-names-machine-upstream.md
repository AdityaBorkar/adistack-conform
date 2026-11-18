---
"@adistack/conform": minor
---

Glossary-compliance wire renames and explicit skipped state

- Machine check kind and IDs are now `machine:<blueprint>` (was `nix:<blueprint>`)
- `CheckResult.source` is now `upstream`; the tech-stack host field is now `provider`
- `applyFix`/`applySelected` are now `fixResult`/`fixSelected`, user wording uses fix
- Skipped results now carry `ok: false` with `skipped: true` but still exit 0; `--json` `failed` and exit codes exclude skips
- New ADRs 0016 (fix safety) and 0017 (exit taxonomy); glossary adds Backup, Diff preview, Dry-run, Discovery, Scope filter, Hint, Re-check, Blueprint resolution, Configuration, Provider

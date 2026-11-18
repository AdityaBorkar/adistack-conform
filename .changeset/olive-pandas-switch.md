---
"@adistack/conform": minor
---

Replace the nix machine check with the JSON manifest pipeline and `switch`

- `check --machine-only` now evaluates `machines/<name>/machine.json` (versioned `packages.pacman`/`packages.bun` maps, links, templates) against live reality; undeclared extras are skipped, not drift; pinned-version drift fails both modes
- New `switch [--dry-run]` state manager: runs `inDrift` (extras fail), applies fixable remedies directly, then re-checks; exits 0 clean, 1 drift remains / dry-run with drift, 2 desired-state error
- `validate` fetches each machine manifest and asserts every `links[]`/`templates[]` source is fetchable
- Machine results are per-item (`machine:<blueprint>:<section>:<name>`); `recheckSelected` matches the `machine:<blueprint>:` prefix

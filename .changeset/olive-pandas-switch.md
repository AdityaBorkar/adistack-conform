---
"@adistack/conform": minor
---

Replace the nix machine check with the JSON machine manifest pipeline

- `check --machine-only` evaluates the machine manifest listed in `registry.json` `machines` (versioned `packages.pacman`/`packages.bun` maps plus `files[]`) against installed packages and `$HOME`; undeclared extras are skipped unless `--strict`; pinned-version drift is always drift
- `fix` applies machine drift through the same TTY/`--all` gate as every other scope
- `validate` reads each machine manifest and asserts every `files[]` source exists on disk
- Machine results are per item: `machine:<blueprint>:<pacman|bun|link|secrets-template>:<name>`

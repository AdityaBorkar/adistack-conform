---
"@adistack/conform": minor
---

Add `validate` command for tech-stack authors (not consumers)

- Validates the local tech-stack repo: `registry.json`, every blueprint in every section, every `files[]` source on disk
- Run as `adistack-conform validate [path]` from the tech-stack repo's own `verify` script; never reads `conform.json`

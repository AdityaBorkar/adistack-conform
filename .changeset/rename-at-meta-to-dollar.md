---
"@adistack/conform": minor
---

Rename blueprint metadata keys from `@name`/`@description` to `$name`/`$description`

- Applies to project, machine, and github-settings manifests; matches what the tech-stack repo already ships
- Old `@`-prefixed keys are rejected (strict objects); update manifests and reship blueprints

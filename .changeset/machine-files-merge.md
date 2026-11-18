---
"@adistack/conform": minor
---

Merge machine `links[]` + `templates[]` into a single `files[]` field

- Machine manifests now declare `files[]` (`name`, `source`, `target`, optional `mode` `0600`/`0644`, optional `secrets`); a file with `secrets` defined renders as a template, without it links
- Template `mode` is now optional (enforced and chmod-applied only when present); secretless templates skip `sops decrypt`
- Tech-stack `machines/main/machine.json` merged to `files[]` (21 links + 6 templated files)

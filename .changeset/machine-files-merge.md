---
"@adistack/conform": minor
---

Merge machine `links[]` + `templates[]` into a single `files[]` field

- Machine manifests declare `files[]` (`name`, `source`, `target`, optional `mode` `0600`/`0644`, optional `secrets`); a file with `secrets` is a secrets template, without it a link
- A secrets template's `mode` defaults to `0600`

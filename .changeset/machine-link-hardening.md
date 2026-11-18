---
"@adistack/conform": patch
---

Harden machine link fixes and secrets-template placeholders

- Dangling links (right dest, missing cache file) fail as fixable instead of passing
- Link fixes materialize the upstream at `<target>.conform-src` before linking, so they never leave a dangling symlink
- Link fixes back up a regular file to `.conform.bak` before replacing it
- Unresolved `@@placeholders@@` of any case are reported as leftover instead of only `UPPER_CASE`
- `mode` on a link entry (without `secrets`) is rejected by the manifest schema
- Link upstreams are fetched as raw bytes so binary dotfiles compare correctly

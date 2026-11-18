---
"@adistack/conform": patch
---

Harden machine link fixes and template placeholders

- Dangling links (right dest, missing cache file) now fail as fixable instead of passing
- `fix` materializes link caches like `switch` does, so link fixes no longer leave dangling symlinks
- `ln` fixes back up a regular file to `.conform.bak` before replacing it
- Unresolved `@@placeholders@@` of any case are reported as leftover instead of only `UPPER_CASE`
- `mode` on a link entry (without `secrets`) is rejected by the manifest schema
- Link upstreams are fetched as raw bytes so binary dotfiles compare correctly

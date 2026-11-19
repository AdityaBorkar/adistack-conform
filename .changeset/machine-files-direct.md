"@adistack/conform": minor
---

Replace machine symlink strategy with direct file checks and replacements

- Machine `files[]` without `secrets` now enforces a regular file matching the upstream (id `machine:<blueprint>:file:<name>`); fix overwrites in place with `.conform.bak`, replacing leftover symlinks without a backup
- Removes the `symlink` fix kind and `<target>.conform-src` materialization; delete stale `*.conform-src` siblings
- `overwrite-file` now replaces a symlink target (unlink, no backup) instead of refusing it

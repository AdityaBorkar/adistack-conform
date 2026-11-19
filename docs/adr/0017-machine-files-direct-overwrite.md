# Machine files are checked and fixed directly, without symlinks

Machine `files[]` entries without `secrets` used to enforce `target -> <target>.conform-src`: the check compared the symlink destination and the cache bytes, and the fix materialized upstream bytes next to the target and swapped the link in. That kept the check pure, but left two files per dotfile, broke tools that read through symlinks unexpectedly, and made diffs and backups harder to reason about.

Now a plain file entry checks the target's content directly against the upstream text and fixes by overwriting the target in place (`.conform.bak` for regular files, no backup when replacing a leftover symlink). Result ids move from `machine:<blueprint>:link:<name>` to `machine:<blueprint>:file:<name>`; the `symlink` fix kind is removed, and `overwrite-file` replaces a symlink target instead of refusing it. Stale `<target>.conform-src` siblings are orphaned and can be deleted.

## Considered Options

Keep the symlink cache and add a direct mode behind a flag (rejected: two enforcement modes for the same entries doubles the test surface and leaves the migration ambiguous).

## Consequences

`fix` converges old machines by replacing symlinks with regular files on the next run. File overwrites run before commands and API calls, and identical writes still dedupe. The `bytes` tech-stack fetch remains for validate existence checks; machine file checks use `text`.

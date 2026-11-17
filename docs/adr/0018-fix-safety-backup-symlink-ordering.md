# Fix safety: backup, symlink refusal, overwrite-first ordering

Fix writes a `.conform.bak` safety copy next to each target before overwriting (numbered `.conform.bak.N` when one exists, refusing after 100 to avoid clobbering history), refuses writes through symlinks, groups file overwrites before commands and API calls, dedupes identical writes to the same path, and aborts conflicting writes to the same path instead of last-writer-wins. Non-TTY `--all` additionally refuses command, API, and outside-project-dir file fixes.

## Consequences

Lost targets are recoverable from the adjacent backup; symlinked paths and conflicting blueprints fail loudly instead of corrupting. Review with `fix --dry-run` first; re-run in a terminal for risky or outside-dir fixes.

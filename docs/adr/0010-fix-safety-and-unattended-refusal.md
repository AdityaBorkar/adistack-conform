# Fix safety: backups, ordering, and refusal when unattended

Every fix that replaces an existing regular file first writes a numbered `.conform.bak` copy next to it. It refuses once the numbering is exhausted, so history is never overwritten. Fixes never write through a symlink, and a link fix never replaces a directory. File overwrites run before commands and API calls. Identical writes to the same path are deduplicated, and conflicting writes abort instead of last-writer-wins. (`src/core/fix.ts`)

Without a TTY, `--all` applies only file overwrites inside the project directory. It refuses commands, links, API calls, and writes outside the project, because those execute binaries, mutate shared repo state, or reach outside the repo, and a human should review them first.

## Consequences

Agents and CI preview with `--dry-run` (never writes, never prompts) and leave risky fixes for a terminal. A lost file is recoverable from its adjacent backup.

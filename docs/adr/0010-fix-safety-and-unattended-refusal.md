# Fix safety: backups, ordering, and refusal when unattended

Every fix that replaces an existing regular file first writes a numbered `.conform.bak` copy next to it. It refuses once the numbering is exhausted, so history is never overwritten. Fixes never write through a symlink, and the symlink check runs before the backup, so a planted link never copies its target anywhere. A link fix never replaces a directory (the check reports one as manual), and it writes the exact bytes the check compared. Secrets templates keep a single backup so decrypted copies do not pile up. File overwrites run before commands and API calls. Identical writes to the same path are deduplicated, and conflicting writes abort instead of last-writer-wins. (`src/core/fix.ts`)

Without a TTY, `--all` applies only file overwrites and links inside the project directory, judged by real path (symlinked parent directories resolved). It refuses commands, API calls, and writes outside the project, because those execute binaries, mutate shared repo state, or reach outside the repo, and a human should review them first.

## Consequences

Agents and CI preview with `--dry-run` (never writes, never prompts) and leave risky fixes for a terminal. A lost file is recoverable from its adjacent backup.

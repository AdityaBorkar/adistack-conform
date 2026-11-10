# Non-TTY `fix --all` refuses risky fixes

`fix --all` outside a TTY applies file overwrites but refuses `run-command` and `github-api` fixes (exit 2), because commands execute arbitrary binaries and API calls mutate shared repo state — both need a human at a terminal to review the diff preview first. In agents and CI, preview with `fix --dry-run` (never writes, never prompts) and run interactive `fix` in a terminal for the risky remainder.

## Consequences

Non-TTY automation is file-only by default; `fix` needs a TTY unless passed `--all`. `--dry-run` exits 1 when drift exists so it works as a preview, not a probe (`check --json` is the probe).

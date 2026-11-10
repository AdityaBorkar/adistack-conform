---
"@adistack/conform": minor
---

Harden check and fix against untrusted blueprints and hostile input: `GITHUB_TOKEN` is no longer forwarded on cross-origin redirects; registry/blueprint `source` paths reject `..`/empty segments; `owner/repo` and `ref` values are validated before building URLs; file fixes refuse symlink targets and non-TTY `--all` refuses writes outside the project dir; backups are versioned instead of overwritten; `compare.ignore` on non-JSON files and array-root template goldens report manual instead of overwriting; template matching is linear-time with a depth cap; `conform.json`, registry, and settings schemas are strict with sane bounds; GitHub checks share one repo read, run at most 6-wide with retries, and report per-check auth skips; `validate` prints failures to stderr and checks machine entry paths; `fix` uses its own timeout with SIGKILL escalation and stdin detached; `--version` comes from `package.json` at build time.

---
"@adistack/conform": minor
---

Fix secret leaks, never-converging fixes, and subdirectory runs

- Never print decrypted template secrets in `check`, `--json`, or `fix` diffs
- Keep file modes on `.conform.bak` backups and write templated files with their declared mode, so secrets are never world-readable
- Count a declared pacman package installed as a dependency as installed (its fix could never succeed)
- Resolve project targets against the directory that owns `conform.json`, not the cwd
- Send branch-protection allowances as login/slug lists so the GitHub fix no longer fails with HTTP 422
- A `--*-only` flag naming an unconfigured scope exits 2
- Reject a leading `/` in project blueprint `source` paths (same rule as machine sources)
- Rename the generated consumer schema to `config/conform.json`, as documented
- Drop the `untildify` dependency

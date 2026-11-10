# GitHub scope checks live repo settings via REST with API fixes

The `github` scope compares live repo settings against the settings file referenced by the conform.json `github` key via the GitHub REST API (`src/stack/github.ts`, schemas in `src/schemas/github.ts`), because repo settings have no filesystem representation to diff; drift is fixed by multi-step `github-api` calls instead of file overwrites. Public repos work unauthenticated until 401/403/rate-limit (then the scope skips, still exit 0); private repos need `GITHUB_TOKEN`, fixes need admin scope.

## Consequences

One result per golden key (`github:<blueprint>:<name>`, `kind: github`); items with no public API (social preview, archive toggles, Copilot Autofix, agent suggestions, OIDC-only checks) skip with a UI hint; non-TTY `fix --all` refuses `github-api`/`run-command` fixes; scope throw becomes `<scope>:internal-error` drift (exit 1).

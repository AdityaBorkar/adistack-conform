---
"@adistack/conform": minor
---

Harden `check` and `fix` against untrusted blueprints and hostile input

- Never forward `GITHUB_TOKEN` on cross-origin redirects
- Reject `..` and empty segments in registry and blueprint `source` paths
- Validate `owner/repo` and `ref` values before building URLs
- Refuse symlink targets in file fixes; non-TTY `--all` refuses writes outside the project directory
- Version backup files instead of overwriting them
- Report `manual` instead of overwriting for `compare.ignore` on non-JSON files and array-root template upstreams
- Match templates in linear time with a depth cap
- Use strict `conform.json`, registry, and settings schemas with sane bounds
- Share one repo read across GitHub checks, run at most 6-wide with retries, and report per-check auth skips
- Print `validate` failures to stderr and check machine entry paths
- Give `fix` its own timeout with SIGKILL escalation and detached stdin
- Read `--version` from `package.json` at build time

# One conform.json per run with walk-up discovery and scope filters

Each invocation loads a single `conform.json` — walking up from the cwd, or exactly one `--desired-state <path>` — and project targets resolve against the invocation cwd (`src/config.ts`, `src/index.ts`). `--project-only` / `--machine-only` / `--github-only` filter at run time; omitting a scope from `conform.json` is the permanent equivalent. Monorepos run once per package directory rather than discovering workspaces, so one package's drift never masks another's exit code.

## Consequences

No workspace discovery; in a monorepo `cd` into each package (targets follow the shell cwd, not the `conform.json` dir). The scope flags are mutually exclusive — passing two is a desired-state error (exit 2).

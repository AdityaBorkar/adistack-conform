---
title: Monorepo
description: Running one conform.json per package with shared registry fetches.
icon: SquareGrid2x2
---

No workspace discovery: each invocation loads a single `conform.json` (walks up from your cwd, or one `--desired-state <path>`), and project targets resolve against that invocation's cwd. In a monorepo, run the CLI once per package directory that owns a `conform.json`:

```bash
for d in packages/*; do (cd "$d" && adistack-conform check); done
# or: adistack-conform --desired-state ./packages/a/conform.json check
# (note: targets still resolve against your shell cwd, so prefer cd + default discovery)
```

Registries are fetched once per unique `repo@ref` within a single run and shared by every spec in that run, so repeated scopes with the same source cost one `registry.json` fetch.

## Patterns

- **One blueprint for all packages** — copy the same `conform.json` (`project.blueprint`, `source`) into each package. Drift in one package never masks another because each run reports its own exit code.
- **Mixed blueprints** — give each package its own `blueprint` (e.g. docs site vs CLI) while sharing `source.repo@ref`.
- **Machine scope once** — keep `machine` in at most one `conform.json` (or pass `--project-only` in packages and run `--machine-only` separately), since the machine check is global to `$HOME`, not per-package.

<Callout type="tip" title="CI recipe">

Run `check --json` per package and aggregate on the `failed` count; run `fix --dry-run --no-diff` first when output gets large.

</Callout>

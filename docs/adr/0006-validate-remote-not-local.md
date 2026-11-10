# `validate` checks the tech-stack source, not local drift

The `validate` command (`src/stack/validate.ts`) checks remote tech-stack validity — `registry.json` plus the blueprint file of every configured project/github blueprint at the pinned `source.repo@ref` (machine blueprints check the registry entry only) — instead of comparing local files against goldens, because a broken blueprint (bad JSON, schema violation, missing entry) fails every consumer and should be caught at the source.

## Consequences

One `✓`/`✗` line per file; exit 0 all valid, 1 any invalid, 2 desired-state error. Github blueprints validate through the project-manifest fetch path. Targets are grouped by `repo@ref` and fetched once per run.

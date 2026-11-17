# `validate` checks the tech-stack source, not local drift

The `validate` command (`collectValidateTargets`/`validateTargets` in `src/commands/validate.ts`) checks remote tech-stack validity — `registry.json` plus the blueprint file of every configured project/github blueprint at the pinned `source.repo@ref`, plus the machine manifest and every `files[]` source it references — instead of comparing local files against upstreams, because a broken blueprint (bad JSON, schema violation, missing entry) fails every consumer and should be caught at the source.

## Consequences

One `✓`/`✗` line per validated file/entry; exit 0 all valid, 1 any invalid, 2 desired-state error. GitHub blueprints validate through the dedicated `fetchGithubSettings` path. Targets are grouped by `repo@ref` and fetched once per run. Machine manifests also validate every referenced `source`, so invalid settings content is caught for machines.

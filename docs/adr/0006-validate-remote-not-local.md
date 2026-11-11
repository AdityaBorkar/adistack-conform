# `validate` checks the tech-stack source, not local drift

The `validate` command (`collectValidateTargets`/`validateTargets` in `src/stack/validate.ts`) checks remote tech-stack validity — `registry.json` plus the blueprint file of every configured project/github blueprint at the pinned `source.repo@ref` (machine blueprints check the registry entry only) — instead of comparing local files against upstreams, because a broken blueprint (bad JSON, schema violation, missing entry) fails every consumer and should be caught at the source.

## Consequences

One `✓`/`✗` line per validated file/entry (including the machine registry-entry line); exit 0 all valid, 1 any invalid, 2 desired-state error. GitHub blueprints validate through the project-manifest fetch path. Targets are grouped by `repo@ref` and fetched once per run. Gap (intentional): only the manifest is fetched — referenced GitHub settings-file content is not validated, so invalid settings JSON is not caught by `validate`.

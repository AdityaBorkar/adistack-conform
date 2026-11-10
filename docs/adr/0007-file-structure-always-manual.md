# `file_structure` entries are existence-only and always manual

Blueprint `file_structure[]` entries (`name` + `target` + `kind: file|dir`) assert existence only — content is per-project — because scaffolding content the CLI cannot author (a missing file gets a generate hint, a missing dir a `mkdir -p` hint) is safer than auto-creating wrong files. An entry whose `name` overlaps a `files[]` name is skipped in favor of the file check.

## Consequences

Missing entries are manual, never fixable (`// shortcut: manual for now` in `src/stack/check.ts` — upgrade to an ensure-dir fix only if dir auto-creation is wanted). IDs share the `project:<blueprint>:<name>` shape with `kind: project`.

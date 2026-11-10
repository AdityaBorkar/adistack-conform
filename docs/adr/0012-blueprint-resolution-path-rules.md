# Blueprint names resolve fuzzily, paths strictly

`conform.json` `blueprint` matches a `registry.json` entry by exact key, then display `name` (machines only), then normalized `path`, then path basename without `.json`, then the input's own basename (`findInPathMap`/`findMachineEntry`/`dirKey` in `src/stack/registry.ts`). Matching is case-sensitive with whitespace trimmed; unknown names fail with the available list (`MAX_LIST_SHOWN`). Manifest `source` paths must be repo-relative: leading `/` is stripped, `./` and `../` prefixes are rejected (`resolveSourceRel`).

## Consequences

Copy the entry name instead of retyping it. Blueprint `path` must point at the file for projects (`blueprintRel` rejects directories) and the flake directory for machines (`blueprintDirRel` normalizes trailing slashes). Strict `source` rules fail fast instead of fetching outside the repo.

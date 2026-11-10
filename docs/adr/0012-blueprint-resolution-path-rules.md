# Blueprint names resolve fuzzily, paths strictly

`conform.json` `blueprint` matches a `registry.json` entry by exact `name`, then normalized `path`, then path basename without `.json`, then the input's own basename (`src/stack/registry.ts`). Matching is case-sensitive with whitespace trimmed; unknown names fail with the available list. Manifest `source` paths must be repo-relative: leading `/` is stripped, `./` and `../` prefixes are rejected (`resolveSourceRel`).

## Consequences

Copy the entry name instead of retyping it. Blueprint `path` must point at the file for projects (directories rejected) and the flake directory for machines (trailing slash normalized). Strict `source` rules fail fast instead of fetching outside the repo.

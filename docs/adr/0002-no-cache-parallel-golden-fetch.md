# Fetch goldens fresh every run with no local cache

Each run fetches `registry.json` once per unique `repo@ref` shared by every spec (`fetchRegistries` in `src/index.ts`), then each blueprint file, then only needed goldens deduplicated by repo-relative path at 16-way parallelism (`GOLDEN_FETCH_CONCURRENCY` in `src/stack/index.ts` via `mapWithConcurrency`), because blueprints are versioned by git ref and a cache would need its own invalidation story for little gain.

## Consequences

`check` exits 0 when in sync (skips count as ok) and 1 on drift; missing goldens report as manual `<blueprint file missing>`; set `GITHUB_TOKEN` for private repos or rate limits. Note: `registry.json` is deduped per run, but blueprint manifests are fetched per spec/scope (`runProjectChecks` and `runGithubChecks` each fetch through the project-manifest path) — not deduped once.

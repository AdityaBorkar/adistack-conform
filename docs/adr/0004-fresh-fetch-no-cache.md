# Fetch upstreams fresh every run, with no local cache

Every run fetches `registry.json` once per unique `repo@ref`, then each configured blueprint file, then only the upstreams that blueprint needs, deduplicated and fetched in parallel (`src/core/upstream/`). Blueprints are already versioned by git ref, so a cache would need its own invalidation story and would only save a few hundred milliseconds.

## Consequences

`check` needs network access. Set `GITHUB_TOKEN` for private repos or rate limits. A fetch failure is drift in that scope, not a desired-state error. Blueprint manifests are fetched per scope and are not shared across scopes. That is acceptable because each scope reads a different file.

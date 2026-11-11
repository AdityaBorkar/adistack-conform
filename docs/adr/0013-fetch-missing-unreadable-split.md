# Fetch, missing, and unreadable failures stay distinct

An upstream that cannot be downloaded reports `<blueprint fetch failed>` (network/auth, manual with retry hint); an upstream absent from the repo reports `<blueprint file missing>` with the repo-relative path (manual, fix the manifest or add the file); a target that cannot be read reports `<unreadable>` (manual with a sudo hint). The three never merge, because each points at a different owner (network, blueprint author, local permissions). (`checkNeeded` in `src/stack/index.ts`, `checkProjectFileWithUpstream` in `src/stack/check.ts`.)

## Consequences

Missing targets stay fixable overwrites; missing upstreams and unreadable targets stay manual. Error strings name the failed path so the owner is obvious without re-running.

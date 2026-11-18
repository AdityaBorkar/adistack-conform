# `validate` checks the local tech-stack repo, not local drift

`validate` is a tech-stack author tool: run inside (or pointed at) a tech-stack repo, it checks the local `registry.json`, every blueprint file in every section, and every source those blueprints reference (each `files[]` source exists on disk, plus the manifest-adjacent `secrets.yaml` when any machine file declares `secrets`). It never reads `conform.json` and does not compare local files. A broken blueprint fails every consumer, so it should be caught at the source by its author, separately from a consumer's drift.

## Consequences

`validate` exits 0 when everything is valid, 1 when anything is invalid, and 2 when no registry is found. Tech-stack repos run it from their own `verify` script against their own checkout — no `conform.json`, no network fetch.

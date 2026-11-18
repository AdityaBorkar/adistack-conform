# `validate` checks the tech-stack source, not local drift

`validate` checks the tech-stack source at the pinned `repo@ref`: the registry, every configured blueprint file, and every source those blueprints reference. It does not compare local files. A broken blueprint fails every consumer, so it should be caught at the source by its author, separately from a consumer's drift.

## Consequences

`validate` exits 0 when everything is valid, 1 when anything is invalid, and 2 when nothing is configured or the desired state is broken. Tech-stack CI can run it against its own blueprints.

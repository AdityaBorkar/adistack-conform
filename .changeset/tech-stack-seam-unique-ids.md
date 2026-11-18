---
"@adistack/conform": patch
---

A project blueprint can no longer use the same `name` in both `files[]` and `file_structure[]`. Both entries used to get the same result id, `project:<blueprint>:<name>`, so after `fix` the re-check could merge them or report the wrong one as resolved. The blueprint schema now rejects the shared name, and `check`/`validate` report it as an invalid blueprint. A scope run that still produces a repeated result id now fails as that scope's internal error instead of corrupting the re-check.

Internally, `check`, `fix` and `validate` now read the pinned tech-stack repo through one module, with the same parsing and the same missing-file classification whether it is fetched or read from a local checkout. Every scope builds its result ids in one place. Result ids and output are unchanged.

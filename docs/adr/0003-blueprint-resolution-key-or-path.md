# Blueprint names resolve by exact key or path only

A desired-state blueprint name matches a registry entry by exact key (whitespace trimmed, case-sensitive) or by normalized repo-relative path, and by nothing else (`src/core/upstream/registry.ts`). Basename and fuzzy matching were removed on purpose: they silently resolved typos to the wrong blueprint. An unknown name fails and lists the available entries.

Registry entries must point at a blueprint **file**, not a directory. Manifest `source` paths must stay inside the tech-stack repo: no `./`, `../`, empty, or dot segments.

## Consequences

Copy entry names from the registry. A strict path fails fast instead of fetching outside the repo.

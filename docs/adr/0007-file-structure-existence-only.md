# `file_structure` entries are existence-only and always manual

Blueprint `file_structure[]` entries assert only that a file or directory exists. Their content is per-project, and the CLI cannot write it, so a missing entry is manual with a hint and is never auto-created. Creating a placeholder file would pass the check while hiding that the real content is missing.

An entry whose resolved target is also enforced by a `files[]` entry produces no result (the content check owns it). A second entry with the same target is skipped.

## Consequences

Making missing directories fixable (an ensure-dir fix) is the only extension considered safe. It is marked as a shortcut in `src/core/project/structure.ts`.

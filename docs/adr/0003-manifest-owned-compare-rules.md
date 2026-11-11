# Compare rules live in the manifest, never in code

Per-file `compare` semantics (`ignore[]` only) are declared by each manifest `files[]` entry and interpreted generically by `src/stack/check.ts`, so the CLI holds no per-file or tool-to-package tables and new blueprints change enforcement without a CLI release. Template detection is not a compare flag: any upstream holding `<...>` placeholders is a template by content.

## Consequences

Entries whose upstream holds `<...>` placeholders are templates: a missing templated target is manual (copy and adapt per-project fields); plain entries drift as fixable overwrites, with local `ignore` keys preserved by `fix`.

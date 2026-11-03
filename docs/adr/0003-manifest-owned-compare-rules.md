# Compare rules live in the manifest, never in code

Per-file `compare` semantics (`ignore`, `pinned`, `versioned`, `strip`) are declared by each manifest `files[]` entry and interpreted generically by `src/stack/check.ts`, so the CLI holds no per-file or tool-to-package tables and new blueprints change enforcement without a CLI release.

## Consequences

Entries with `pinned`/`versioned` are templates: drift merges golden keys over local content preserving local extras, and a missing templated target is manual (copy and adapt per-project fields); plain entries drift as fixable overwrites, with local `ignore` keys preserved by `fix`.

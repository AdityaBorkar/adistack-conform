# Zod schemas are the source of truth for configuration

`src/schemas/` declares every shape the CLI reads (`conform.json`, `registry.json`, project manifests, machine manifests, GitHub settings) in Zod, and the published JSON Schemas in `config/` are generated from them at build time. Validation, editor completion, and runtime parsing therefore can never disagree. Hand-written JSON Schemas (and the earlier Valibot schemas) drifted from the parser.

## Consequences

`config/*.json` is build output and is never hand-edited. A schema violation in local desired state is a desired-state error (exit 2); a violation in a fetched blueprint is drift in that scope, because the blueprint author owns it, not the user.

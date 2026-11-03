# Valibot schemas are the source of truth for configuration

`src/schemas/` declares `conform.json`, registry, and manifest shapes in Valibot, and `configuration_schema/*.json` plus the compiled CLI are regenerated from them on every `bun run build`, so validation, editor schemas, and runtime parsing can never diverge.

## Consequences

`check`/`fix` exit 2 on config errors (missing scope, wrong `conform.json` basename, unknown blueprint); never hand-edit `configuration_schema/` since `build` overwrites it.

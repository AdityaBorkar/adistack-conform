# Zod schemas are the source of truth for configuration

`src/schemas/` declares `conform.json`, registry, and manifest shapes in Zod (`import * as z from "zod"`, finals wrapped in `z.compile()`), and `configuration_schema/*.json` is regenerated from them via `bun run gen:json-schema` (also run by `bun run build`), so validation, editor schemas, and runtime parsing can never diverge. (Originally Valibot; migrated to Zod — the filename keeps the original number for history.)

## Consequences

`check`/`fix` exit 2 on desired-state errors (missing scope, invalid JSON/schema); unknown blueprints and fetch failures are drift reported as `<scope>:internal-error` (exit 1), never exit 2. Never hand-edit `configuration_schema/` since `gen:json-schema`/`build` overwrites it.

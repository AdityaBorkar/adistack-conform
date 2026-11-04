---
title: API
description: JSON output, CheckResult shape, schemas, and building from source.
icon: DocText
---

There is no library API — the interface is the CLI plus the JSON Schemas. (`src/index.ts` is the Commander entrypoint; `package.json` `exports` it for tooling, not for import.)

## Scripting with `--json`

Humans read lines; scripts read JSON:

```bash
adistack-conform check --json --project-only > report.json
```

Prints `{ configs, ok, passed, failed, skipped, total, results }`. Gate on `ok` / exit code (<Badge variant="success">0 sync</Badge> <Badge variant="warning">1 drift</Badge> <Badge variant="error">2 config error</Badge>). Each `CheckResult`:

```jsonc
{
	"id": "project:cli-app:Bun Config", // or "project:cli-app:deps:oxlint" or "nix:main" or "github:cli-app:general"
	"kind": "preset", // "preset" | "package" | "nix" | "github" | "internal"
	"scope": "project", // "project" | "machine" | "github"
	"source": "tech-stack:cli-app",
	"target": "bunfig.toml",
	"expected": "<golden>",
	"actual": "<local content | <missing> | <unreadable> | …>",
	"skipped": false, // true when skipped (counts as ok)
	"fix": { "kind": "overwrite-file", "filePath": "<abs>", "newContent": "…" },
	// or: "fix": { "kind": "run-command", "command": "…", "args": ["…"], "label": "…" },
	// or: "fix": { "kind": "github-api", …multi-step REST calls… },
	"hint": "only on manual failures",
}
```

<Callout type="tip" title="Probe vs preview">

`fix --dry-run` exits 1 when anything is fixable, so `check --json` is the better probe and `fix --dry-run` the better preview. Use each for what it is good at.

</Callout>

## Schemas (Valibot source of truth)

`src/schemas/` (`conform.ts`, `manifest.ts`, `registry.ts`, `github.ts`, `common.ts`, `import * as v from "valibot"`) generates `configuration_schema/*.json` via `bun run gen:json-schema` (also run by `bun run build`).

<Callout type="warning" title="Hands off the generated files">

Never hand-edit the generated files. Change the Valibot source and regen.

</Callout>

| Schema                                       | Validates                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| `configuration_schema/conform.json`          | Consumer `conform.json`                                     |
| `configuration_schema/project-manifest.json` | Blueprint `manifest.json` in the tech-stack repo            |
| `configuration_schema/registry.json`         | Tech-stack root `registry.json`                             |
| `configuration_schema/github.json`           | Preset file referenced by a blueprint manifest `github` key |

## Building

```bash
bun install
bun run dev              # run from source: bun ./src/index.ts
bun run verify           # format && check:lint && check:types && build (gate before pushing)
bun run build            # regen schemas + bun build --compile --minify --bytecode to .output/adistack-conform
```

Conventions: path alias `#/*` → `./src/*` with `.js` suffix on internal imports, `import type` for type-only, tabs + width 100, always `bun run <script>`. The `home-manager` / `nix` fallback, 30s fetch timeout, 10-minute switch timeout, and 16-way golden parallelism are fixed, not configurable.

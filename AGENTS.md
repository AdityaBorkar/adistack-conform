# AGENTS.md

## Stack

Bun-only TypeScript CLI (`bun build --compile` binary + npm `adistack-conform` bin) + Commander + @clack/prompts + Zod v4 + oxlint/oxfmt + tsrs. No CI, no README yet.

## Commands

```bash
bun install
bun run build            # bun build src/index.ts --compile --outfile dist/adistack-conform
bun run check:format     # bun oxfmt — writes in place (oxfmt defaults to --write, despite the name)
bun run check:lint       # bun oxlint
bun run check:types      # bun tsrs (Bun typechecker, not tsc)
bun run verify            # format && lint && types && build
```

## CLI (`adistack-conform [--config <path>] [--cwd <dir>]`)

```bash
adistack-conform init [--minimal] [--force] [--stdout] [--repo <path>] [--preset <names...>] [--blueprint <name>] [--exclude <names...>]  # scaffold conform.config.json from current state (+ optional tech-stack refs)
adistack-conform check [--json] [--project-only|--system-only]  # exit 0 ok, 1 drift, 2 config error
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only|--system-only]  # space to toggle, Select-all pseudo-option first, diff preview, per-item ok/error, re-checks after apply
```

## conform.config.json — `techStack` section (system-user desired state)

`check`/`fix` read file desired-state from the tech-stack project instead of
snapshotting ad-hoc. A conform project either references a pre-existing
blueprint/preset or defines its own blueprint inline via `presets`:

```json
{
	"version": 1,
	"techStack": {
		"repo": "../tech-stack",
		"blueprint": "main",
		"presets": ["git", "shell"],
		"exclude": ["wsl"],
		"fix": "overwrite"
	}
}
```

- `repo` — path to the tech-stack checkout (relative to the config file, `~` ok).
- `blueprint` — `machines/blueprints/<name>.json` in tech-stack (base preset list).
- `presets` — own blueprint: extra tech-stack preset names, merged over the blueprint.
- `exclude` — preset names dropped from the effective set.
- `fix: "overwrite"|"report"` — whether preset mismatches are auto-fixable (default `overwrite`).
- Effective set = (blueprint ∪ presets) − exclude. Unknown names fail with exit 2.
- Each preset resolves via `machines/presets/registry.json` (`path` → `target`).
  `docs:` targets, Windows `%...%` targets, and annotation-only targets are reported
  as skipped (exit 0); a leading `~/...` or `/...` token is used when the target
  carries a human annotation. `*.example` presets assert existence only (secret
  values are never compared). Empty presets pass when the target is absent
  (empty = defaults). Overwrites of `/etc/...` targets may fail without sudo —
  reported per-item as `✗ not fixed`.

- Always `bun run <script>`, not `npm`/`npx`.
- `verify` is the full pre-push gate.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`.
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100; sorts imports (`builtin`+`bun` / `external` / `internal` / `parent`+`sibling` / `style` / `unknown`). oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; no inline suppressions — all exceptions in `.oxlintrc.json` `overrides`.
- `bunfig.toml`: `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`.
- Config validation with Zod v4 (`import * as z from "zod"`).

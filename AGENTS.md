# AGENTS.md

## Stack

Bun-only TypeScript CLI (compiled binary in `.output/` + npm `adistack-conform` bin) + Commander + @clack/prompts + Zod v4 + oxlint/oxfmt + tsrs + knip. No CI, no root README, no test runner (`tests/` is empty).

## Commands

```bash
bun install
bun run dev              # run CLI from source: bun ./src/index.ts
bun run build            # regen JSON schemas, then bun build --compile to .output/adistack-conform
bun run format           # oxfmt — writes in place
bun run check:lint       # oxlint
bun run check:types      # tsrs (Bun typechecker, not tsc)
bun run review:knip      # knip (unused deps/exports/files) — NOT part of verify
bun run verify           # format && check:lint && check:types && build
bun run gen:json-schema  # regenerate configuration_schema/ from src/schemas/*
```

- Always `bun run <script>`, not `npm`/`npx`.
- `verify` is the full pre-push gate.
- Pre-commit hook runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt); commit messages must pass commitlint conventional-commit with the restricted types in `.commitlintrc.json`.

## Layout

- `src/index.ts` — Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/techstack.ts`, `src/diff.ts`, `src/output.ts` — flat modules, no subdirectories in use.
- `src/schemas/*` — Zod v4 source of truth (`import * as z from "zod"`). `configuration_schema/*.json` is generated — never hand-edit, it is overwritten by `build` / `gen:json-schema`.
- This repo dogfoods itself: `conform.project.json` (`cli-app` blueprint) and `conform.machine.json` (`main` blueprint) both track `AdityaBorkar/tech-stack@main`.

## CLI (`adistack-conform [--config <path>]`)

```bash
adistack-conform check [--json] [--no-cache] [--project-only|--machine-only]  # exit 0 ok, 1 drift, 2 config error
adistack-conform fix [--all] [--dry-run] [--no-diff] [--no-cache] [--project-only|--machine-only]  # space to toggle, Select-all pseudo-option first, diff preview, per-item ok/error, re-checks after apply
```

- Without `--config`, `check`/`fix` load `conform.project.json` and/or `conform.machine.json` from the cwd. With `--config`, kind comes from the filename, otherwise the content is schema-sniffed (project first).
- `--project-only` + `--machine-only` together is an error. `fix` needs a TTY unless `--all` or `--dry-run`.
- Project targets resolve against the cwd; machine targets resolve against `$HOME`.

## conform.project.json / conform.machine.json — preset desired state

```json
{
	"blueprint": "main",
	"presets": ["git", "shell"],
	"exclude": ["wsl"],
	"source": { "type": "github", "repo": "myorg/tech-stack", "ref": "main" }
}
```

- `source.type` — always `"github"`. `source.repo` — `"owner/repo"` holding blueprints/presets.
- `source.ref` — branch, tag, or commit (default `main`; pin a tag/commit for reproducibility).
- `source.branch` — overrides `source.ref` as the ref to download.
- `blueprint` — base preset list from `<registry-dir>/<name>/manifest.json` (dirs listed in the tech-stack root `registry.json`, per scope).
- `presets` — extra preset names, merged over the blueprint.
- `exclude` — preset names dropped from the effective set.
- Effective set = (blueprint ∪ presets) − (blueprint.exclude ∪ exclude). Unknown names fail with exit 2.
- The repo tarball is downloaded from codeload (`GITHUB_TOKEN` supported for private repos / rate limits) and cached under `~/.cache/adistack-conform/github/<owner>/<repo>/<ref>/` (`XDG_CACHE_HOME` respected, unsafe refs sanitized, `.conform-meta.json` guards freshness). `--no-cache` forces a re-download; a failed download falls back to the cache with a warning.
- Preset locations come from the root `registry.json` (`<scope>.presets` dirs, each with a `manifest.json` mapping `path` → `target`). `docs:` targets, Windows `%...%` targets, and annotation-only targets are reported as skipped (exit 0); a leading `~/...` or `/...` token is used when the target carries a human annotation. Only the project scope honors `./...`/`../...` targets (resolved against the cwd). `*.example` files assert existence only (secret values are never compared). Empty presets pass when the target is absent (empty = defaults). Unreadable targets (e.g. `/etc/...` without sudo) fail as non-fixable with a hint.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`.
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100; sorts imports (`builtin`+`bun` incl. `bun:*` custom group / `external` / `internal` / `parent`+`sibling` / `style` / `unknown`); sorts `package.json` scripts.
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` (case-sensitive, natural) and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — all exceptions in `.oxlintrc.json` `overrides` (currently only `no-await-in-loop` off in `src/index.ts`).
- `bunfig.toml`: `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`, binary lockfile (`saveTextLockfile=false`).

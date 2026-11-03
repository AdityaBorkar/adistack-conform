# AGENTS.md

## Stack

Bun-only TypeScript CLI (compiled binary in `.output/` + npm `adistack-conform` bin) + Commander + @clack/prompts + Valibot + oxlint/oxfmt + tsrs + knip. No tests, no CI, no root README (`www/README.md` is the user docs).

CLI runtime behavior (flags, exit codes, project/machine rules) is documented in `skills/adistack-conform/SKILL.md` and `www/*.md` — read those before touching `check`/`fix` logic, and update them when flags, results, or `conform.json` semantics change.

## Commands

```bash
bun install
bun run dev              # run CLI from source: bun ./src/index.ts
bun run build            # regen JSON schemas + bun build --compile --minify --bytecode to .output/adistack-conform (concurrently)
bun run format           # oxfmt — writes in place
bun run check:lint       # oxlint
bun run check:types      # tsrs (Bun typechecker, not tsc)
bun run review:knip      # knip (unused deps/exports/files) — NOT part of verify
bun run verify           # format && check:lint && check:types && build
bun run gen:json-schema  # regenerate configuration_schema/ from src/schemas/*
```

- Always `bun run <script>`, not `npm`/`npx`.
- `verify` is the full gate before pushing. `format` writes in place, so run it first.
- Pre-commit hook runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt); commit messages must pass commitlint conventional-commit with the restricted types in `.commitlintrc.json` (`release`, `chore`, `docs`, `feat`, `fix`, `refactor`, `revert`, `test`).

## Layout

- `src/index.ts` — Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`machine`/`registry`/`remote`) — plus `src/utils/` (`fs`, `output`, `concurrency`) and `src/schemas/`.
- `src/schemas/*` — Valibot source of truth (`import * as v from "valibot"`). `configuration_schema/*.json` is generated — never hand-edit, it is overwritten by `build` / `gen:json-schema`.
- `.output/` is gitignored build output.
- This repo dogfoods itself: `conform.json` (`cli-app` project blueprint + `main` nix blueprint) tracks `AdityaBorkar/tech-stack@main`.
- The tech-stack reference checkout lives at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read blueprints/registry directly instead of guessing.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/checks.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100, sorted imports / `package.json` scripts.
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — exceptions live in `.oxlintrc.json` (e.g. `no-await-in-loop` off in `src/index.ts`).
- `bunfig.toml`: `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`.

# AGENTS.md

## Stack

Bun-only TypeScript CLI (package `@adistack/conform`, bin `adistack-conform` compiled to `.output/`) + Commander + @clack/prompts + Valibot + oxlint/oxfmt + tsrs + knip. No CI, no root README (`www/README.md` is the user docs).

CLI runtime behavior (flags, exit codes, project/machine/github rules) lives in `skills/adistack-conform/SKILL.md` and `www/*.md` — read those before touching `check`/`fix` logic, and update them when flags, results, or `conform.json` semantics change. Use `GLOSSARY.md` terms (golden/source/target, fixable/manual, drift).

## Commands

```bash
bun install
bun run dev -- check         # run CLI from source (bun ./src/index.ts); pass check/fix args after --
bun test                     # all tests (src/**/*.test.ts); single file: bun test src/checks.test.ts
bun run build            # regen JSON schemas + compile --minify --bytecode to .output/adistack-conform
bun run format           # oxfmt — writes in place
bun run check:lint       # oxlint
bun run check:types      # tsrs (Bun typechecker, not tsc)
bun run review:knip      # knip (unused deps/exports/files) — NOT part of verify
bun run verify           # format && check:lint && check:types && test && build
```

- Always `bun run <script>`, not `npm`/`npx` (`bunfig.toml` sets `shell = "bun"`).
- `verify` is the full gate before pushing. `format` writes in place, so run it first.
- `build` always regens `configuration_schema/` via `scripts/build.ts` — never hand-edit those JSON files; `bun run gen:json-schema` regens schemas without compiling.
- Pre-commit hook runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt); commit messages must pass commitlint conventional-commit with the restricted types in `.commitlintrc.json` (`release`, `chore`, `docs`, `feat`, `fix`, `refactor`, `revert`, `test`).

## Layout

- `src/index.ts` — Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`deps`/`machine`/`github`/`registry`/`remote`), `src/utils/`, `src/schemas/`.
- `src/schemas/*` is the Valibot source of truth (`import * as v from "valibot"`); `configuration_schema/*.json` is generated output.
- `.output/` is gitignored build output.
- This repo dogfoods itself: `conform.json` (`cli-app` project blueprint + `main` nix blueprint) tracks `AdityaBorkar/tech-stack@main`.
- The tech-stack reference checkout lives at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read blueprints/registry directly instead of guessing.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/checks.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100, sorted imports / `package.json` scripts.
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — exceptions live in `.oxlintrc.json` (`no-await-in-loop` off in `index`/`fix`/`config`/`stack/github`).
- `bunfig.toml`: `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`.

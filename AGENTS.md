# AGENTS.md

## Stack

Bun-only TypeScript CLI (`@adistack/conform`, binary compiled to `.output/`) + Commander + @clack/prompts + Zod v4 (`import * as z from "zod"`, finals wrapped in `z.compile()`). Lint oxlint, format oxfmt, typecheck tsrs (not tsc), unused-code knip.

CLI runtime behavior (flags, exit codes, scopes, fix flow) lives in `skills/adistack-conform/SKILL.md` — read it before touching `check`/`fix` logic, and update it when flags, results, or `conform.json` semantics change. User docs live in `docs/www/` (start at `docs/www/README.md`). Use `GLOSSARY.md` terms (upstream/source/target, fixable/manual, drift).

## Commands

```bash
bun install                          # CI uses bun install --frozen-lockfile
bun run dev -- check                 # run CLI from source (bun ./src/index.ts); pass check/fix args after --
bun test                             # all tests (src/**/*.test.ts); single file: bun test src/utils/result.test.ts
bun run build                        # regen config/*.json from Zod schemas + compile --minify --bytecode to .output/
bun run verify                       # full gate before pushing (runs format, check:lint, check:types, test, check:knip, check:conform in parallel)
bun run check:conform                # dogfood self-check (bun dev check); also runs inside verify
```

- Always `bun run <script>`, never `npm`/`npx` (`bunfig.toml` sets `shell = "bun"`, plus `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`).
- CI (`preview.yml` on PRs to `main`) runs `bun run verify` plus `bun changeset status --since origin/main`.
- Never hand-edit `config/*.json` — generated from `src/schemas/*` by `scripts/generate-json-schema.ts` (runs inside `build`). There is no standalone `gen:json-schema` script.
- Pre-commit runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt). Commits must pass commitlint with types restricted to `chore docs feat fix refactor release revert test` (see `.commitlintrc.json`).

## Release

- Release branch is `main`. Every PR needs a `.changeset/*.md` entry or merging releases nothing (`changeset --empty` for no-release changes; `changedFilePatterns` covers `src/*`, `skills/*`, `package.json`, not tests). Merging to `main` opens/updates the `changeset-release/` version PR, whose merge publishes to npm (`release.yml`).
- `/conform.json`, `/package.json`, `/bun.lock` need owner review (`CODEOWNERS`).

## Layout

- `src/index.ts` — Commander wiring only; `src/commands/` (`check`, `fix/`, `validate`); `src/utils/config.ts` + generic helpers (`run`/`result`/`diff`/`jsonc`/`concurrency`/`fs`/`net`/`output`/`schema`); `src/stack/` scope implementations (`project`/`project-compare`/`machine`/`github`+`github-api`/`registry`/`remote`); `src/schemas/` (`config`/`registry`/`project-manifest`/`github-settings` — Zod source of truth).
- `.output/` is gitignored build output.
- This repo dogfoods itself: `conform.json` pins `AdityaBorkar/tech-stack@<ref>` — read it for the current scopes, don't assume. Reference blueprints/registry live at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read `registry.json`/blueprint files directly instead of guessing.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/utils/result.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100, sorted imports / `package.json` scripts (see `.oxfmtrc.json`).
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — overrides live in `.oxlintrc.json`.

# AGENTS.md

## Stack

Bun-only TypeScript CLI (`@adistack/conform`, bin compiled to `.output/`) + Commander + @clack/prompts + Zod v4 (`import * as z from "zod"`, finals wrapped in `z.compile()`). Lint oxlint, format oxfmt, typecheck tsrs (not tsc), unused-code knip.

CLI runtime behavior (flags, exit codes, scopes, fix flow) lives in `skills/adistack-conform/SKILL.md` — read it before touching `check`/`fix` logic, and update it when flags, results, or `conform.json` semantics change. User docs live in `docs/www/*.md` (root `README.md` is an empty stub). Use `GLOSSARY.md` terms (golden/source/target, fixable/manual, drift).

## Commands

```bash
bun install
bun run dev -- check        # run CLI from source (bun ./src/index.ts); pass check/fix args after --
bun test                    # all tests (src/**/*.test.ts); single file: bun test src/checks.test.ts
bun run build               # regen configuration_schema/ + compile --minify --bytecode to .output/
bun run gen:json-schema     # regen schemas only, without compiling
bun run format              # oxfmt — writes in place
bun run check:lint          # oxlint
bun run check:types         # tsrs (Bun typechecker, not tsc)
bun run review:knip         # knip (unused deps/exports/files) — NOT part of verify
bun run verify              # format && check:lint && check:types && test — full gate before pushing (no build; run build separately for the compiled binary)
```

- Run scripts with `bun run <script>` (repo shorthand `bun <script>` also appears in `package.json`), never `npm`/`npx` (`bunfig.toml` sets `shell = "bun"`). `bunfig.toml` also pins `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`.
- `verify` order matters: `format` first since it rewrites. CI (`pr.yml`) runs `bun run verify` on PRs to `stable`.
- Never hand-edit `configuration_schema/*.json` — generated from `src/schemas/*` by `scripts/generate-json-schema.ts` (via `build` or `gen:json-schema`).
- Pre-commit runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt). Commits must pass commitlint with types restricted to `chore docs feat fix refactor release revert test` (no `ci:`, `style:`, etc.).

## Release

- Release branch is `stable` (changesets `baseBranch: stable`). PRs target `stable`, not `main`.
- Every PR needs a `.changeset/*.md` entry or merging releases nothing (`changeset --empty` for no-release changes). Merging to `stable` opens/updates the `changeset-release/` version PR, whose merge publishes to npm (`publish.yml`).
- `/conform.json`, `/package.json`, `/bun.lock` need owner review (`CODEOWNERS`).

## Layout

- `src/index.ts` — Commander entrypoint (`check`, `fix`, `validate`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`; `src/stack/` (`index`/`check`/`machine`/`github`/`registry`/`remote`/`validate`); `src/utils/` (`concurrency`/`fs`/`net`/`output`/`schema`); `src/schemas/` (`conform`/`registry`/`project-manifest`/`github-settings` — Zod source of truth).
- `.output/` is gitignored build output.
- This repo dogfoods itself: `conform.json` tracks `AdityaBorkar/tech-stack@<ref>` — read it for the current scopes, don't assume. Reference blueprints/registry live at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read `registry.json`/blueprint files directly instead of guessing.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/checks.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100, sorted imports / `package.json` scripts.
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — exceptions live in `.oxlintrc.json` (`no-await-in-loop` off only in `src/index.ts`, `src/stack/github.ts`, `src/fix.ts`, `src/config.ts`; `prefer-top-level-await` off in `src/index.ts`).

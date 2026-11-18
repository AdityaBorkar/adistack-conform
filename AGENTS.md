# AGENTS.md

## Stack

Bun-only TypeScript CLI (`@adistack/conform`, binary compiled to `.output/`) + Commander + @clack/prompts + Zod v4 (`import * as z from "zod"`, finals wrapped in `z.compile()`). Lint oxlint, format oxfmt, typecheck tsrs (not tsc), unused-code knip.

CLI runtime behavior (flags, exit codes, scopes, fix flow) lives in `skills/adistack-conform/SKILL.md` — read it before touching `check`/`fix` logic, and update it plus `docs/www/` when flags, results, or `conform.json` semantics change. User docs start at `docs/www/README.md`. Use `GLOSSARY.md` terms (upstream/source/target, fixable/manual, drift) — except "Discovery", which still says walk-up: `src/core/config.ts` is cwd-only, trust the code.

## Commands

```bash
bun install                          # CI uses bun install --frozen-lockfile
bun dev check                        # run CLI from source (bun ./src/index.ts); pass check/fix args after dev
bun test                             # all tests (script adds --only-failures --parallel=4); single file: bun test src/core/result.test.ts
bun run build                        # regen config/*.json from src/schemas/* + compile --minify --bytecode to .output/
bun run verify                       # gate before pushing: format (writes, not --check) + check:lint + check:types + test + check:knip in parallel (scripts/verify.ts)
bun run check:conform                # dogfood self-check (bun dev check); NOT part of verify — run separately
```

- Always `bun run <script>`, never `npm`/`npx` (`bunfig.toml` sets `shell = "bun"`, plus `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`).
- CI (`preview.yml` on PRs to `main`) runs `bun run verify` and posts a release-preview comment derived from `.changeset/*.md`.
- Never hand-edit `config/*.json` — generated from `src/schemas/*` by `scripts/generate-json-schema.ts` (runs inside `build`). There is no standalone `gen:json-schema` script.
- Pre-commit runs `bun fmt --staged` (Bun builtin, not `bun run format` which is oxfmt). Commits must pass commitlint with types restricted to `chore docs feat fix refactor release revert test` (see `.commitlintrc.json`).
- No directory walking: `check`/`fix` read `./conform.json` in the cwd, `validate` reads `./registry.json` in the cwd; `--path <path>` overrides. Run from the directory that owns the file.
- Set `GITHUB_TOKEN` for private tech-stack repos, rate limits, and the `github` scope (public repos work unauthenticated until 401/403/rate-limit, then skip).

## Release

- Release branch is `main`. Every PR needs a `.changeset/*.md` entry or merging releases nothing. Write it by hand (there is no local changesets CLI): frontmatter `"@adistack/conform": patch|minor|major` plus a summary (`changedFilePatterns` covers `src/*`, `skills/*`, `package.json`, excludes `!**/*.test.ts`). Merging to `main` opens/updates the `changeset-release/` version PR, whose merge publishes to npm (`release.yml`).
- `/conform.json`, `/package.json`, `/bun.lock` need owner review (`CODEOWNERS`).

## Layout

- `src/index.ts` registers commands only; `src/commands/` one file per command (`check`/`fix`/`validate`), each exporting `{ name, configure, run }` — `run` takes plain options and returns the exit code.
- `src/core/` holds all domain logic, no Commander imports: pipeline at the top level (`config` (desired state + scope flags), `run`, `result`, `fix`, `select`, `validate`, `report`), shared `upstream/` access (`registry` lookup + path rules, `remote` fetches), and one folder per scope with an `index.ts` entry (`project/`, `machine/`, `github/`). Scope folders never import each other — only `run`/`fix`/`validate` wire them together. `src/utils/` is generic helpers with no domain knowledge (`process` runs commands with timeouts); `src/schemas/` is the Zod source of truth.
- Scope internals: `project/` (`compare`/`template`/`structure`), `machine/` (`links`/`templates` (secrets templates)/`packages`/`live` + `managers/` with one file per package manager: parser plus list/install/remove), `github/` (`api`/`target-repo`/`shared` + per-area checks). Tests colocate as `*.test.ts` next to source.
- `.output/` and `config/` are gitignored build output (config regen on every build).
- This repo dogfoods itself: `conform.json` pins `AdityaBorkar/tech-stack@<ref>` — read it for the current scopes, don't assume. Reference blueprints/registry live at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read `registry.json`/blueprint files directly instead of guessing.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/core/result.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100, sorted imports / `package.json` scripts (see `.oxfmtrc.json`).
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; prefer overrides in `.oxlintrc.json` over inline suppressions (sole exception: `no-control-regex` in `src/core/report.ts`).

# AGENTS.md

## Stack

Bun-only TypeScript CLI (compiled binary in `.output/` + npm `adistack-conform` bin) + Commander + @clack/prompts + Valibot + oxlint/oxfmt + tsrs + knip. No CI, no tests, no root README (only `www/README.md`).

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
- `verify` (`format` → `check:lint` → `check:types` → `build`) is the full gate before pushing. `format` writes in place, so run it first.
- Pre-commit hook runs `bun fmt --staged` (Bun's builtin formatter, not oxfmt); commit messages must pass commitlint conventional-commit with the restricted types in `.commitlintrc.json`.

## Layout

- `src/index.ts` — Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`machine`/`registry`/`remote`) — plus `src/utils/` (`fs`, `output`, `concurrency`) and `src/schemas/`.
- `src/schemas/*` — Valibot source of truth (`import * as v from "valibot"`). `configuration_schema/*.json` is generated — never hand-edit, it is overwritten by `build` / `gen:json-schema`.
- This repo dogfoods itself: `conform.json` (`cli-app` project blueprint + `main` nix blueprint) tracks `AdityaBorkar/tech-stack@main`.
- The tech-stack reference checkout lives at `~/repo/tech-stack` (`opencode.json` already allows `external_directory` there) — read blueprints/registry directly instead of guessing.

## CLI (`adistack-conform [--config <path>]`)

```bash
adistack-conform check [--json] [--project-only|--machine-only]  # exit 0 ok, 1 drift, 2 config error
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only|--machine-only]  # space to toggle, Select-all pseudo-option first, diff preview, per-item ok/error, re-checks after apply
```

- Without `--config`, `check`/`fix` load `conform.json` from the cwd. With `--config`, the filename must be exactly `conform.json` — anything else exits 2.
- `--project-only` + `--machine-only` together is an error. `fix` needs a TTY unless `--all` (or `--dry-run`, which never prompts).
- Project targets resolve against the cwd. Machine checks shell out to home-manager (which owns `$HOME`), so there are no machine file targets.

## conform.json — project + machine desired state

```jsonc
// conform.json
{
	"machine": { "blueprint": "main", "configuration": "adityab" },
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "myorg/tech-stack", "ref": "main" },
}
```

- `source.type` — always `"github"`. `source.repo` — `"owner/repo"` holding project blueprints and machine nix flakes.
- `source.ref` — branch, tag, or commit (default `main`; pin a tag/commit for reproducibility).
- At least one of `machine` / `project` is required; omit the other to track only one scope (`--project-only` / `--machine-only` also filter at run time).
- Project: `blueprint` — project blueprint matching a tech-stack root `registry.json` `projects[]` entry (by entry `name`, entry `path`, or directory basename, e.g. `cli-app`).
- Machine: `blueprint` — machine blueprint matching a `registry.json` `machines[]` entry (by entry `name`, entry `path`, or flake directory basename, e.g. `main`). `configuration` — optional `homeConfigurations` attribute to switch to (e.g. `adityab`); omitted means home-manager auto-select from `$USER`. Machines are entirely nix-managed.
- Remote fetch has no local cache: each run fetches `registry.json` once per unique `repo@ref` (shared by every spec), then each project blueprint's `manifest.json`, then only the golden files its `files[]` need (deduplicated by repo-relative path, 16-way parallel). Refs with `/` work — they are plain path segments in `raw.githubusercontent.com` URLs and `encodeURIComponent`-escaped in flake URLs.
- Project files come from each blueprint's `manifest.json` (`files[]` with `name`/`source`/`target`). `source` starting with `./` or `../` resolves against the manifest directory, otherwise it is repo-relative. `docs:` targets, Windows `%...%` targets, and annotation-only targets are reported as skipped (exit 0); a leading `~/...`, `/...`, or bare `~` token is used when the target carries a human annotation. Only the project scope honors `./...`/`../...` targets (resolved against the cwd). `*.example` sources assert existence only (secret values are never compared). Empty goldens pass when the target is absent (empty = defaults). Unreadable targets (e.g. `/etc/...` without sudo) fail as non-fixable with a hint.
- Machine blueprint dirs are explicit flake paths from `registry.json` (`machines[].path`). `check` runs `home-manager switch --flake git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>#<configuration> --dry-run --impure` (via the `home-manager` binary, else `nix run home-manager -- …`) and reports one `nix:<blueprint>` result; `fix` runs the same switch without `--dry-run` (a `run-command` fix, applied with inherited stdio). Nix fetches the flake into its own store — no repo download in this CLI. A dry-run that prints a nix error (unknown attribute, missing env, build failure) is reported as non-fixable with a hint, since a real switch fails the same way. When neither binary is available the check fails as non-fixable with a hint.

## Conventions

- Path alias `#/*` → `./src/*` (`package.json` `imports` + `tsconfig` `paths`). No `@/*`. Internal imports keep the `.js` suffix (e.g. `#/checks.js`).
- `verbatimModuleSyntax` on — `import type` for type-only. Strict `noUnusedLocals`/`noUnusedParameters` — unused vars fail typecheck.
- oxfmt: tabs, `printWidth` 100; sorts imports (`builtin`+`bun` incl. `bun:*` custom group / `external` / `internal` / `parent`+`sibling` / `style` / `unknown`); sorts `package.json` scripts.
- oxlint: `correctness`/`pedantic`/`perf`/`suspicious` as error; `sort-keys` (case-sensitive, natural) and `import/no-unassigned-import` as error; `https?://`, `npm:`, `jsr:` imports banned; no inline suppressions — exceptions live in `.oxlintrc.json` (currently no `overrides`).
- `bunfig.toml`: `ignore-scripts=true`, `exact=true`, `minimumReleaseAge=3d`, binary lockfile (`saveTextLockfile=false`).

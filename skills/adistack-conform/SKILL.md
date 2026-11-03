---
name: adistack-conform
description: Check and fix project/machine drift against tech-stack blueprints with adistack-conform. Use when running conform check or fix, editing conform.json, debugging a drift report, or developing this CLI repo itself.
---

# adistack-conform

Bun-only TypeScript CLI that checks the current directory (project files) and the current machine (nix home-manager flake) against golden blueprints in a tech-stack repo. Desired state lives in `conform.json`.

## Desired state (`conform.json`)

```jsonc
{
	"$schema": "./configuration_schema/conform.json",
	"machine": { "blueprint": "main", "configuration": "adityab" },
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

- At least one of `machine` / `project` is required; omit the other to track one scope.
- `source.type` is always `"github"`. `source.repo` is `owner/repo`. `source.ref` defaults to `main` (branch, tag, or commit; pin for reproducibility).
- `project.blueprint` matches a tech-stack root `registry.json` `projects[]` entry by `name`, `path`, or directory basename (e.g. `cli-app`).
- `machine.blueprint` matches a `registry.json` `machines[]` entry the same way (e.g. `main`). `machine.configuration` is the optional `homeConfigurations` attribute; omit it for home-manager `$USER` auto-select.
- Config discovery: without `--config`, the CLI loads `./conform.json` from the cwd. With `--config <path>`, the basename must be exactly `conform.json`, else exit 2. Project targets resolve against the cwd.

## Commands

Run from the directory that owns `conform.json` (project targets are cwd-relative):

```bash
adistack-conform check [--json] [--project-only | --machine-only]
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only]
# from source: bun ./src/index.ts check
```

- `check` exits 0 (in sync, skips count as ok), 1 (drift), 2 (config error).
- `--project-only` + `--machine-only` together is an error.
- `--json` prints a machine-readable summary (`{ configs, ok, passed, failed, skipped, total, results }`) — reach for it when parsing results programmatically.
- `fix` flow: reports unfixable items with hints, shows a diff preview (unless `--no-diff`), prompts with space-to-toggle multiselect (Select-all first), applies, then re-checks only the selected IDs. `fix` exits 0 when nothing remains failing, 1 when drift remains / cancelled / dry-run with drift, 2 on config error or no-TTY without `--all`.
- `fix` needs a TTY unless `--all` is passed. In agents/non-TTY runs use `fix --all` or `fix --dry-run` (dry-run never writes and never prompts). Prefer `fix --dry-run` before `fix --all` so the diff is reviewed first.
- Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits.

## What each scope checks

Project (one result per blueprint `manifest.json` `files[]`, id `project:<blueprint>:<name>`):

- Fetch order per unique `repo@ref`: `registry.json` once, then the blueprint `manifest.json`, then only needed golden files (deduplicated, 16-way parallel, no local cache). A `source` starting with `./`/`../` resolves against the manifest directory, otherwise it is repo-relative.
- Skipped (pass, exit 0): `docs:` targets, Windows `%VAR%` targets, annotation-only targets with no concrete path. Only the project scope resolves bare `./...`/`../...` targets (against the cwd); `~/...`, `/...`, and bare `~` expand against `$HOME`.
- `*.example` sources assert existence only (values stay secret; missing file is manual-fix with a copy-and-fill hint).
- Empty golden + absent target passes (empty = defaults). Missing target otherwise fails fixable (overwrite-file fix). Unreadable target (e.g. `/etc/...` without sudo) fails manual with a hint.

Machine (single result, id `nix:<blueprint>`):

- Resolves the flake dir from `registry.json` `machines[].path` and runs `home-manager switch --flake git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>#<configuration> --dry-run --impure` (via `home-manager` binary, else `nix run home-manager -- …`). Nix fetches the flake itself; the CLI downloads nothing.
- Exit 0 means in sync. Real drift is fixable; `fix` re-runs the same switch without `--dry-run` with inherited stdio.
- Manual (not drift): nix evaluation errors (unknown attribute → check `machine.configuration`; missing `GIT_NAME`/`GIT_EMAIL` env; build failures), missing `home-manager`/`nix` binaries, timeouts. The hint names the remedy.

## Agent workflow

1. Locate `conform.json` (cwd or `--config`). Confirm the `source.repo@ref` and which scopes are configured.
2. Run `check` (add `--json` for parsing, `--project-only`/`--machine-only` to narrow). Done when every non-`ok` result is classified fixable vs manual.
3. For drift, run `fix --dry-run` (plus `--no-diff` only to save tokens on huge files) to preview. Done when the would-fix list matches the fixable set.
4. Apply with `fix --all` (non-TTY) or interactive `fix` (TTY). Re-check output is authoritative: done when it reports 0 still failing.
5. Manual items are never auto-fixed: follow the `hint` (copy `.example` secrets without committing values, export missing env, fix `machine.configuration`, run switch by hand with sudo where noted).

## Developing this repo

```bash
bun install
bun run dev              # bun ./src/index.ts
bun run verify           # format && check:lint && check:types && build (gate before pushing)
```

- `src/index.ts` is the Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`machine`/`registry`/`remote`), `src/utils/`, `src/schemas/` (Valibot source of truth, `import * as v from "valibot"`).
- `configuration_schema/*.json` is generated — never hand-edit (regen via `bun run gen:json-schema` / `build`). Compiled binary lands in `.output/`.
- Conventions: `#/*` → `./src/*` with `.js` suffix on internal imports, `import type` where type-only, tabs + width 100, no `npm`/`npx` (always `bun run <script>`). Reference blueprints live at `~/repo/tech-stack` — read `registry.json`/manifests directly instead of guessing.

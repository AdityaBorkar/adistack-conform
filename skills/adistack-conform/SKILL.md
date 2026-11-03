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
	"github": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

- At least one of `machine` / `project` / `github` is required; omit the others to track fewer scopes.
- `github` is `{ "blueprint": "<name>", "repo"?: "owner/repo" }`. `repo` defaults to `$GITHUB_REPOSITORY`, then the git origin remote of the cwd.
- `source.type` is always `"github"`. `source.repo` is `owner/repo`. `source.ref` defaults to `main` (branch, tag, or commit; pin for reproducibility).
- `project.blueprint` matches a tech-stack root `registry.json` `projects[]` entry by `name`, `path`, or directory basename (e.g. `cli-app`).
- `machine.blueprint` matches a `registry.json` `machines[]` entry the same way (e.g. `main`). `machine.configuration` is the optional `homeConfigurations` attribute; omit it for home-manager `$USER` auto-select.
- Config discovery: without `--config`, the CLI walks up from the cwd to find `conform.json`. `--config <path>` accepts any path. Project targets resolve against the cwd.

## Commands

Run from the directory that owns `conform.json` (project targets are cwd-relative):

```bash
adistack-conform check [--json] [--verbose] [--project-only | --machine-only | --github-only]
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only | --github-only]
# from source: bun ./src/index.ts check
```

- `check` exits 0 (in sync, skips count as ok), 1 (drift), 2 (config error).
- `--project-only` + `--machine-only` + `--github-only` are mutually exclusive (passing two is an error).
- `--json` prints a machine-readable summary (`{ configs, ok, passed, failed, skipped, total, results }`) — reach for it when parsing results programmatically. `--verbose` also shows passing checks (default: failures only).
- `fix` flow: reports unfixable items with hints, shows a diff preview (unless `--no-diff`, diffs over ~200KB skipped), prompts with space-to-toggle multiselect (each option shows the fix command), applies in order, then re-checks only the selected IDs. `fix` exits 0 when nothing remains failing, 1 when drift remains / cancelled / dry-run with drift, 2 on config error, no-TTY without `--all`, or non-TTY `--all` with command/API fixes.
- `fix` needs a TTY unless `--all` is passed, and non-TTY `--all` refuses command/API fixes (re-run in a terminal). In agents/non-TTY runs use `fix --dry-run` (dry-run never writes and never prompts). Prefer `fix --dry-run` before `fix --all` so the diff is reviewed first.
- Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits. GitHub-scope checks/fixes always call the GitHub REST API, so they need `GITHUB_TOKEN` (admin scope for fixes); the target repo defaults to `$GITHUB_REPOSITORY`, then the cwd git origin remote (override with `github.repo`).

## What each scope checks

Project (one result per blueprint `manifest.json` `files[]`, id `project:<blueprint>:<name>`):

- Fetch order per unique `repo@ref`: `registry.json` once, then the blueprint `manifest.json`, then only needed golden files (deduplicated, 16-way parallel, no local cache). A `source` starting with `./`/`../` resolves against the manifest directory, otherwise it is repo-relative.
- Skipped (pass, exit 0): `docs:` targets, Windows `%VAR%` targets, annotation-only targets with no concrete path. Only the project scope resolves bare `./...`/`../...` targets (against the cwd); `~/...`, `/...`, and bare `~` expand against `$HOME`.
- Empty golden + absent target passes (empty = defaults). Missing target otherwise fails fixable (overwrite-file fix). Unreadable target (e.g. `/etc/...` without sudo) fails manual with a hint.
- Per-entry `compare` rules (declared in the manifest, never hardcoded): `ignore[]` keys are excluded from the compare with local values preserved by `fix` (e.g. linter `overrides`); `pinned[]` keys must match the golden (objects merge per key, local extras allowed); `versioned[]` sections pin shared package versions; `strip[]` keys are dropped before comparing. Entries declaring `pinned`/`versioned` are templates: a missing target is manual (copy + adapt per-project fields) since goldens hold placeholders.
- Existence-only entries from `manifest.json` `file_structure[]` (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`) must exist; missing files get a generate hint, missing dirs a `mkdir -p` hint (manual).
- Toolchain deps (`project:<blueprint>:deps:<pkg>`, kind `package`): the manifest `js` field pins required `dependencies` / `devDependencies` / `peerDependencies` to exact versions, plus the `pm` binary for hints. Missing, misplaced, or version-drifted packages fail manual with an install/move/update hint. The CLI holds no tool→package table — manifests are the only source of truth.

Machine (single result, id `nix:<blueprint>`):

- Resolves the flake dir from `registry.json` `machines[].path` and runs `home-manager switch --flake git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>#<configuration> --dry-run --impure` (via `home-manager` binary, else `nix run home-manager -- …`). Nix fetches the flake itself; the CLI downloads nothing.
- Exit 0 means in sync. Real drift is fixable; `fix` re-runs the same switch without `--dry-run` with inherited stdio.
- Manual (not drift): nix evaluation errors (unknown attribute → check `machine.configuration`; missing `GIT_NAME`/`GIT_EMAIL` env; build failures), missing `home-manager`/`nix` binaries, timeouts. The hint names the remedy.

GitHub (one result per golden key, id `github:<blueprint>:<name>`, kind `github`):

- Golden is the preset file referenced by the blueprint `manifest.json` `github` key (e.g. `../$presets/github-configs/<name>.json`); the CLI compares it against live repo settings via the GitHub REST API (needs `GITHUB_TOKEN`). Covers general/repo settings, immutable releases, CODEOWNERS, issue templates, required PR checks, code reviews/push restrictions, rulesets presence, Actions permissions/workflow/retention/OIDC, environments, Advanced Security, and secrets/variables presence.
- Fixes are kind `github-api` (multi-step REST calls, needs admin-scoped `GITHUB_TOKEN`).
- Skipped with a UI hint (still exit 0): items with no public API — social preview, archive toggles, Copilot Autofix, agent suggestions, OIDC fix. Follow the hint in the GitHub web UI.

## Agent workflow

1. Locate `conform.json` (cwd or `--config`). Confirm the `source.repo@ref` and which scopes are configured.
2. Run `check` (add `--json` for parsing, `--project-only`/`--machine-only`/`--github-only` to narrow). Done when every non-`ok` result is classified fixable vs manual.
3. For drift, run `fix --dry-run` (plus `--no-diff` only to save tokens on huge files) to preview. Done when the would-fix list matches the fixable set.
4. Apply with `fix --all` (non-TTY) or interactive `fix` (TTY). Re-check output is authoritative: done when it reports 0 still failing.
5. Manual items are never auto-fixed: follow the `hint` (export missing env, fix `machine.configuration`, run switch by hand with sudo where noted).

## Developing this repo

```bash
bun install
bun run dev              # bun ./src/index.ts
bun run verify           # format && check:lint && check:types && build (gate before pushing)
```

- `src/index.ts` is the Commander entrypoint (`check`, `fix`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`deps`/`machine`/`github`/`registry`/`remote`), `src/utils/` (`concurrency`/`fs`/`net`/`output`/`schema`), `src/schemas/` (`github.ts` included; Valibot source of truth, `import * as v from "valibot"`).
- `configuration_schema/*.json` is generated — never hand-edit (regen via `bun run gen:json-schema` / `build`). Compiled binary lands in `.output/`.
- Conventions: `#/*` → `./src/*` with `.js` suffix on internal imports, `import type` where type-only, tabs + width 100, no `npm`/`npx` (always `bun run <script>`). Reference blueprints live at `~/repo/tech-stack` — read `registry.json`/manifests directly instead of guessing.

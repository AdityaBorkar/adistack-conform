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
	"github": { "blueprint": "npm-package" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

- At least one of `machine` / `project` / `github` is required; omit the others to track fewer scopes.
- `github` is `{ "blueprint": "<name>", "repo"?: "owner/repo" }`. `repo` defaults to `$GITHUB_REPOSITORY`, then the git origin remote of the cwd.
- `source.type` is always `"github"`. `source.repo` is `owner/repo`. `source.ref` defaults to `main` (branch, tag, or commit; pin for reproducibility).
- `project.blueprint` matches a tech-stack root `registry.json` `projects` key by key, `path`, or path basename without `.json` (e.g. `cli-app` matches `./projects/cli-app.json`).
- `machine.blueprint` matches a `registry.json` `machines` key the same way (by key, display `name`, `path`, or flake directory basename, e.g. `main`). `machine.configuration` is the optional `homeConfigurations` attribute; omit it for home-manager `$USER` auto-select.
- Desired-state discovery: without `--desired-state`, the CLI walks up from the cwd to find `conform.json`. `--desired-state <path>` accepts any path. Project targets resolve against the cwd; leading `~` expands against `$HOME`, absolute paths pass through.

## Commands

Run from the directory that owns `conform.json` (project targets are cwd-relative):

```bash
adistack-conform check [--json] [--verbose] [--project-only | --machine-only | --github-only]
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only | --github-only]
adistack-conform validate
# from source: bun ./src/index.ts check
```

- `check` exits 0 (in sync, skips count as ok), 1 (drift), 2 (desired-state error).
- `--project-only` + `--machine-only` + `--github-only` are mutually exclusive (passing two is an error).
- `--json` prints a machine-readable summary (`{ desiredStates, ok, passed, failed, skipped, total, results }`) — reach for it when parsing results programmatically. `--json` ignores `--verbose` (JSON always carries every result). `--verbose` also shows passing results (default: failures only).
- `fix` flow: reports manual items with hints (fixable machine/github results may carry both `fix` and `hint`), shows a diff preview (unless `--no-diff`, diffs over ~200KB skipped), prompts with space-to-toggle multiselect (each option shows the fix command), applies `overwrite-file` fixes first then commands/API fixes, then re-checks only the selected IDs (full re-check fallback on error). `fix` exits 0 when nothing remains failing, 1 when drift remains / cancelled / dry-run with drift, 2 on desired-state error, no-TTY without `--all`, or non-TTY `--all` with command/API fixes.
- `fix` needs a TTY unless `--all` is passed, and non-TTY `--all` refuses command/API fixes (re-run in a terminal). In agents/non-TTY runs use `fix --dry-run` (dry-run never writes and never prompts). Prefer `fix --dry-run` before `fix --all` so the diff is reviewed first.
- `validate` checks the tech-stack `registry.json` plus the blueprint file (e.g. `projects/cli-app.json`) of every configured project blueprint and the settings file (e.g. `github-configs/npm-package.json`) of every configured github blueprint (machine blueprints check the registry entry only). Prints one `✓`/`✗` line per validated file/entry with the error detail, exits 0 when all valid, 1 when any invalid, 2 on desired-state error. The global `--desired-state` flag applies.
- Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits. GitHub-scope checks/fixes call the GitHub REST API: public repos work without a token until 401/403/rate-limit (then the scope skips, still exit 0); private repos or rate limits need `GITHUB_TOKEN` (admin scope for fixes); the target repo defaults to `$GITHUB_REPOSITORY`, then the cwd git origin remote (override with `github.repo`). Unresolvable repo (none of the three) is `github:internal-error` drift (exit 1).

## What each scope checks

Project (one result per blueprint `files[]`, id `project:<blueprint>:<name>`):

- Fetch order per unique `repo@ref`: `registry.json` once, then each desired state's blueprint file (project manifests, github settings files), then only needed golden files (deduplicated, 16-way parallel, no local cache). `source` is repo-relative (e.g. `projects/files/<group>/<file>`); leading `/` is stripped, `./` and `../` prefixes are rejected.
- Project `target` is resolved against the cwd (`~` expands, absolute passes through). Missing target fails fixable (overwrite-file fix). Unreadable target (e.g. `/etc/...` without sudo) fails manual with a hint.
- Per-entry `compare` rules (declared in the manifest, never hardcoded): `ignore[]` keys are excluded from the compare with local values preserved by `fix` (e.g. linter `overrides`). A golden is a template only when it parses as a JSON object (JSONC-tolerant) and holds `<...>` placeholders: each slot accepts any per-project value (non-empty, no `<...>` placeholders, matching the surrounding text) while every other field must match — extra local fields and array items allowed, placeholder keys fuzzy-match. Drift without a fix is manual. A missing template target is manual (copy the golden and adapt per-project fields). Templates never pass on byte equality — a verbatim copy fails manual until every golden `<...>` placeholder is replaced with per-project values. `<...>` in non-JSON goldens never counts.
- Existence-only entries from blueprint `file_structure[]` (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`) must exist; missing files get a generate hint, missing dirs a `mkdir -p` hint (manual). Overlapping `file_structure[]`/`files[]` names are dropped with no result (file check owns it).

Machine (single result, id `nix:<blueprint>`):

- Resolves the flake dir from `registry.json` `machines` entry `path` and runs `home-manager switch --flake git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>#<configuration> --dry-run --impure` (via `home-manager` binary, else `nix run home-manager -- …`). Nix fetches the flake itself; the CLI downloads nothing.
- Exit 0 means in sync. Real drift is fixable; `fix` re-runs the same switch without `--dry-run` with inherited stdio.
- Manual (not drift): nix evaluation errors (unknown attribute → check `machine.configuration`; missing `GIT_NAME`/`GIT_EMAIL` env; build failures), missing `home-manager`/`nix` binaries, timeouts. The hint names the remedy.

GitHub (fixed check list, id `github:<blueprint>:<name>`, kind `github`):

- Golden is the settings file listed in `registry.json` `github_configs` (e.g. `github-configs/<name>.json`); the CLI compares it against live repo settings via the GitHub REST API (needs `GITHUB_TOKEN`). Covers general/repo settings, immutable releases, CODEOWNERS, issue templates, required PR checks, code reviews/push restrictions, rulesets presence, Actions permissions/workflow (incl. fork PR approval)/retention/OIDC, environments, Advanced Security (incl. dependency graph via vulnerability alerts), and secrets/variables presence. `actions-oidc` always skips; OIDC 404 and goldens that do not require a check skip too.
- Fixes are kind `github-api` (multi-step REST calls, needs admin-scoped `GITHUB_TOKEN`).
- Skipped with a UI hint (still exit 0): items with no public API — social preview, archive toggles, Copilot Autofix, dependency auto-submit, agent suggestions, OIDC-only checks. Whole-scope or per-check 401/403 auth failures also skip. Follow the hint in the GitHub web UI. `internal-error` results carry no `source` (`target` is the scope name).

## Agent workflow

1. Locate `conform.json` (cwd or `--desired-state`). Confirm the `source.repo@ref` and which scopes are configured.
2. Run `check` (add `--json` for parsing, `--project-only`/`--machine-only`/`--github-only` to narrow). Done when every non-`ok` result is classified fixable vs manual.
3. For drift, run `fix --dry-run` (plus `--no-diff` only to save tokens on huge files) to preview. Done when the would-fix list matches the fixable set.
4. Apply with `fix --all` (non-TTY) or interactive `fix` (TTY). Re-check output is authoritative: done when it reports 0 still failing.
5. Manual items are never fixed automatically: follow the `hint` (export missing env, fix `machine.configuration`, run switch by hand with sudo where noted).

## Developing this repo

```bash
bun install
bun run dev              # bun ./src/index.ts
bun run verify           # format && check:lint && check:types && test (gate before pushing)
```

- `src/index.ts` is the Commander entrypoint (`check`, `fix`, `validate`); `src/config.ts`, `src/checks.ts`, `src/diff.ts`, `src/fix.ts`, `src/stack/` (`index`/`check`/`machine`/`github`/`registry`/`remote`/`validate`), `src/utils/` (`concurrency`/`fs`/`net`/`output`/`schema`), `src/schemas/` (`github.ts` included; Zod source of truth, `import * as z from "zod"`, finals wrapped in `z.compile()`).
- `configuration_schema/*.json` is generated — never hand-edit (regen via `bun run gen:json-schema` / `build`). Compiled binary lands in `.output/`.
- Conventions: `#/*` → `./src/*` with `.js` suffix on internal imports, `import type` where type-only, tabs + width 100, no `npm`/`npx` (always `bun run <script>`). Reference blueprints live at `~/repo/tech-stack` — read `registry.json`/blueprint files directly instead of guessing.

---
name: adistack-conform
description: Check and fix project/machine drift against tech-stack blueprints with adistack-conform. Use when running conform check or fix, editing conform.json, debugging a drift report, or developing this CLI repo itself.
---

# adistack-conform

Bun-only TypeScript CLI that checks the current directory (project files) and the current machine (JSON manifest state) against upstream blueprints in a tech-stack repo. Desired state lives in `conform.json`.

## Desired state (`conform.json`)

```jsonc
{
	"$schema": "./config/conform.json",
	"machine": { "blueprint": "main" },
	"project": { "blueprint": "cli-app" },
	"github": { "blueprint": "npm-package" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

- At least one of `machine` / `project` / `github` is required; omit the others to track fewer scopes.
- `github` is `{ "blueprint": "<name>", "repo"?: "owner/repo" }`. `repo` defaults to `$GITHUB_REPOSITORY`, then the git origin remote of the cwd.
- `source.type` is always `"github"`. `source.repo` is `owner/repo`. `source.ref` defaults to `main` (branch, tag, or commit; pin for reproducibility).
- `project.blueprint` matches a tech-stack root `registry.json` `projects` key, or an entry `path` (e.g. `projects/cli-app.json` matches `./projects/cli-app.json`). Basenames alone never match, so a typo cannot resolve to the wrong blueprint.
- `machine.blueprint` matches a `registry.json` `machines` key or entry `path` the same way (e.g. `main`).
- Desired-state discovery: without `--desired-state`, the CLI walks up from the cwd to find `conform.json`. `--desired-state <path>` accepts any path. Project targets resolve against the directory that owns `conform.json`; leading `~` expands against `$HOME`, absolute paths pass through.

## Commands

Run from anywhere inside the project: project targets resolve against the directory that owns `conform.json`.

```bash
adistack-conform check [--json] [--verbose] [--strict] [--project-only | --machine-only | --github-only]
adistack-conform fix [--all] [--dry-run] [--no-diff] [--strict] [--project-only | --machine-only | --github-only]
adistack-conform validate
# from source: bun ./src/index.ts check
```

- `check` exits 0 (in sync, skips are not drift), 1 (drift), 2 (desired-state error).
- `--project-only` + `--machine-only` + `--github-only` are mutually exclusive (passing two is an error). Naming a scope that `conform.json` does not configure exits 2.
- `--json` prints a machine-readable summary (`{ desiredStates, ok, passed, failed, skipped, total, results }`) — reach for it when parsing results programmatically. `--json` ignores `--verbose` (JSON always carries every result). `--verbose` also shows passing results (default: failing results only).
- `fix` flow: reports manual items with hints (fixable machine/github results may carry both `fix` and `hint`), shows a diff preview (unless `--no-diff`, diffs over ~200KB skipped; at most 20 diffs shown), prompts with space-to-toggle multiselect (each option shows the fix command), fixes `overwrite-file` first (each writes a `.conform.bak` backup next to the target with the same file mode, numbered `.conform.bak.N` when one already exists; secrets templates keep a single `.conform.bak`; a symlink or non-regular target is refused before anything is read or copied) then links/commands/API fixes (commands time out after 10 minutes), then re-checks the selected IDs (project narrows to them, machine and github re-check whole; full re-check fallback on error). A selected ID missing from the re-check counts as fixed (e.g. a removed extra) only when that scope's re-check hit no new failure — a GitHub auth skip or a machine domain error keeps the previous failure. `fix` exits 0 when nothing remains failing, 1 when drift remains / cancelled / dry-run with drift, 2 on desired-state error, no-TTY without `--all`, or non-TTY `--all` with command/API fixes or file fixes outside the project dir.
- `fix` needs a TTY unless `--all` is passed, and non-TTY `--all` refuses command/API fixes and file or link fixes outside the project dir (symlinked parent dirs are resolved first, so `.github -> /elsewhere` counts as outside) (run again in a terminal). In agents/non-TTY runs use `fix --dry-run` (dry-run never writes and never prompts). Prefer `fix --dry-run` before `fix --all` so the diff is reviewed first.
- `validate` checks the tech-stack `registry.json` plus the blueprint file (e.g. `projects/cli-app.json`) of every configured project blueprint, the settings file (e.g. `github-configs/npm-package.json`) of every configured github blueprint, and the machine manifest (e.g. `machines/main.json`) of every configured machine blueprint including fetchability of every `files[]` source (plus the manifest-adjacent `secrets.yaml` when any file declares `secrets`). Prints one `✓` line per valid file/entry to stdout and `✗` lines with the error detail to stderr, exits 0 when all valid, 1 when any invalid, 2 on desired-state error. The global `--desired-state` flag applies.
- Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits. GitHub-scope checks/fixes call the GitHub REST API: public repos work without a token until 401/403/rate-limit (then the scope skips, still exit 0); private repos or rate limits need `GITHUB_TOKEN` (admin scope for fixes); the target repo defaults to `$GITHUB_REPOSITORY`, then the cwd git origin remote (override with `github.repo`). Unresolvable repo (none of the three) is `github:internal-error` drift (exit 1).

## What each scope checks

Project (one result per blueprint `files[]`, id `project:<blueprint>:<name>`):

- Fetch order per unique `repo@ref`: `registry.json` once, then each desired state's blueprint file (project manifests, machine manifests, github settings files), then only needed upstream files (deduplicated, 16-way parallel, no local cache). `source` is repo-relative (e.g. `projects/files/<group>/<file>`); a leading `/`, `./`/`../` prefixes, empty or dot segments, and `\\` fail the blueprint schema (same rule for machine sources).
- Project `target` is resolved against the directory that owns `conform.json` (`~` expands, absolute passes through). Missing target fails fixable (overwrite-file fix). Unreadable target (e.g. `/etc/...` without sudo) fails manual with a hint. Three upstream/target errors stay distinct because each has a different owner: `<blueprint fetch failed>` (network/auth, retry), `<blueprint file missing>` (blueprint author: fix the manifest or add the file), `<unreadable>` (local permissions).
- Per-entry `compare` rules (declared in the manifest, never hardcoded): `ignore[]` keys are excluded from the compare with local values preserved by `fix` (e.g. linter `overrides`). An upstream is a template only when it parses as a JSON object or array (JSONC-tolerant) and holds `<...>` placeholders: each slot accepts any per-project value (non-empty, no `<...>` placeholders, matching the surrounding text) while every other field must match — extra local fields and array items allowed, placeholder keys fuzzy-match. Drift without a fix is manual. A missing template target is manual (copy the upstream and adapt per-project fields). Templates never pass on byte equality — a verbatim copy fails manual until every upstream `<...>` placeholder is replaced with per-project values. `<...>` in non-JSON upstreams never counts.
- Existence-only entries from blueprint `file_structure[]` (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`) must exist; missing files get a generate hint, missing dirs a `mkdir -p` hint (manual). An entry whose resolved target is also a `files[]` target is dropped with no result (file check owns it); a duplicate structure target is skipped.

Machine (one result per declared item, id `machine:<blueprint>:<section>:<name>`):

- Upstream is the machine manifest file listed in `registry.json` `machines` (e.g. `machines/main.json`); the CLI fetches it plus only needed `files/` sources (same order as project: `registry.json` → manifest → needed files). `source` is repo-relative (same rules as project); `target` resolves against `$HOME` (`~` expands, absolute passes through).
- Machine checks require every declared package/file present and correct. Extras (undeclared installs) are skipped, never drift, unless `--strict` is passed to `check` or `fix`, which makes them fixable drift (removal). A clean `check` with a dirty `check --strict` is normal — the machine holds extras the blueprint does not own.
- Package names in the manifest (`packages`, `allowlist`) must start with a letter, digit, `@`, `_` or `+` and use only `A-Za-z0-9@._+/-`; fixes pass `--` before names to `pacman`. Read-only probes (`pacman -Q`, `bun pm -g ls`, `sops --decrypt`) time out after 60s.
- Packages: a declared package counts as installed even when it came in as a dependency; extras are judged against explicitly installed packages only. One result per declared `packages.pacman`/`packages.bun` entry (`name: version|"latest"`) plus one result per undeclared install (extra), all with id `machine:<blueprint>:<manager>:<name>`. Missing and pinned-version drift are always fixable (install `name` or `name=version` / `name@version`); an extra is skipped unless `--strict` (then fixable removal). `allowlist` exempts distro-base names (e.g. `base`, `linux`) so a fresh Arch install does not flag its own base.
- Files without `secrets` link: `target` must be a symlink to the fetched upstream materialized at `<target>.conform-src`. Missing target, wrong dest, dangling link, or a regular file is fixable: the fix writes the exact bytes the check compared to the cache, backs a regular file up to `.conform.bak[.N]`, then swaps the link in atomically. A directory or special file at the target is manual. Extra files are never drift (links own paths, not dirs).
- Files with `secrets` are secrets templates (id `machine:<blueprint>:secrets-template:<name>`): rendered from `source` with one `sops --decrypt` of the manifest-adjacent `secrets.yaml` per run (flat `KEY: value` lines; keys `[A-Za-z_][A-Za-z0-9_.-]*`). Only the names listed in the file's `secrets` replace their `@@NAME@@` slots; other secrets never reach the file, and a slot for an unlisted name stays as a leftover. `mode` defaults to `0600` and is always enforced (the fix narrows the mode before writing, so the file is never wider). Rendered and live content never appears in `actual`/`expected`, `--json`, or diffs (shown as `<redacted ...>`). Missing `sops`/age key, a listed secret absent from `secrets.yaml`, or leftover placeholders is manual with a hint.

GitHub (fixed check list, id `github:<blueprint>:<name>`, kind `github`):

- Upstream is the settings file listed in `registry.json` `github_configs` (e.g. `github-configs/<name>.json`); the CLI compares it against live repo settings via the GitHub REST API (needs `GITHUB_TOKEN`). Covers general/repo settings, immutable releases, CODEOWNERS, issue templates, required PR checks, code reviews/push restrictions, rulesets presence, Actions permissions/workflow (incl. fork PR approval)/retention/OIDC, environments, Advanced Security (incl. dependency graph via vulnerability alerts), and secrets/variables presence. `actions-oidc` always skips; OIDC 404 and upstreams that do not require a check skip too.
- Fixes are kind `github-api` (multi-step REST calls, needs admin-scoped `GITHUB_TOKEN`).
- Skipped with a UI hint (still exit 0): items with no public API — social preview, archive toggles, Copilot Autofix, dependency auto-submit, agent suggestions, OIDC-only checks. Whole-scope or per-check 401/403 auth failures also skip. Follow the hint in the GitHub web UI. `internal-error` results carry no `upstream` (`target` is the scope name).

## Agent workflow

1. Locate `conform.json` (cwd or `--desired-state`). Confirm the `source.repo@ref` and which scopes are configured.
2. Run `check` (add `--json` for parsing, `--project-only`/`--machine-only`/`--github-only` to narrow). Done when every failing result (non-`ok`, non-skipped) is classified fixable vs manual.
3. For drift, run `fix --dry-run` (plus `--no-diff` only to save tokens on huge files) to preview. Done when the would-fix list matches the fixable set.
4. Run `fix --all` (non-TTY) or interactive `fix` (TTY). Re-check output is authoritative: done when it reports 0 still failing.
5. Manual items are never fixed automatically: follow the `hint`. To remove extras too, add `--strict` to `fix`.

## Developing this repo

```bash
bun install
bun run dev              # bun ./src/index.ts
bun run verify           # format + check:lint + check:types + test + check:knip in parallel (gate before pushing; check:conform runs separately)
```

- `src/index.ts` registers commands only; `src/commands/` one file per command (`check`/`fix`/`validate`); `src/core/` domain logic: pipeline (`config`/`run`/`result`/`fix`/`select`/`validate`/`report`), `upstream/` (`registry`/`remote`), and one folder per scope (`project/` (`index`/`compare`/`template`/`structure`), `machine/` (`index`/`links`/`templates`/`packages`/`managers/`/`live`), `github/` (`index`/`api`/`target-repo` + per-area checks)); `src/utils/` generic helpers; `src/schemas/` (`github-settings.ts` included; Zod source of truth, `import * as z from "zod"`, finals wrapped in `z.compile()`).
- `config/*.json` is generated — never hand-edit (regen via `bun run build`). Compiled binary lands in `.output/`.
- Conventions: `#/*` → `./src/*` with `.js` suffix on internal imports, `import type` where type-only, tabs + width 100, no `npm`/`npx` (always `bun run <script>`). Reference blueprints live at `~/repo/tech-stack` — read `registry.json`/blueprint files directly instead of guessing.

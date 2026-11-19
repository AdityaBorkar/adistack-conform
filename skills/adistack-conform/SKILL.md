---
name: adistack-conform
description: Use when running adistack-conform (@adistack/conform) check, fix, or validate; adding or editing conform.json; reading a drift report (fixable, manual, skipped, internal-error, exit 0/1/2); authoring or validating a tech-stack repo (registry.json, project/machine/github blueprints, templates, secrets templates); wiring conform into CI; or developing the conform CLI itself.
---

# adistack-conform

Desired-state enforcer. A consumer repo declares a **desired state** in `conform.json`: which **blueprints** (project / machine / github) it must match, and the **pin** (`source`: tech-stack `owner/repo@ref`) holding them. `check` compares reality to the pinned **upstreams** and reports **drift**; `fix` applies **fixable** remedies; `validate` lints a tech-stack repo before consumers pin it.

Two roles, never mixed:

| Role                          | Owns                                        | Runs           |
| ----------------------------- | ------------------------------------------- | -------------- |
| Consumer (end repo / machine) | `conform.json`                              | `check`, `fix` |
| Author (tech-stack repo)      | `registry.json` + manifests + payload files | `validate`     |

Vocabulary (GLOSSARY.md): pin, registry, blueprint, manifest, source (path inside tech-stack), upstream (fetched content), target (local thing enforced), scope, drift, fixable, manual, hint, skipped, extra, allowlist, strict, re-check, dry-run, backup. Use these words; avoid preset/golden/sync/apply.

## Running in an end repo

```bash
bun add -d @adistack/conform            # or run ad hoc
bunx @adistack/conform check            # bin of the package; this repo's source: bun dev check
```

Run from the dir owning `conform.json` (no directory walking; `--path <file>` overrides, `~` expands). `bunx @adistack/conform` runs the published package (verified: `bunx` resolves the scoped package to its single bin); this repo's source runs via `bun dev check`.

```bash
bunx @adistack/conform check [--json] [--verbose] [--strict] [--skip-secrets] [--project-only|--machine-only|--github-only] [--path p]
bunx @adistack/conform fix   [--all] [--dry-run] [--strict] [--project-only|--machine-only|--github-only] [--path p]
bunx @adistack/conform validate [--path <tech-stack dir | registry.json>]
```

### `conform.json`

```jsonc
{
	"$schema": "./node_modules/@adistack/conform/config/conform.json",
	"project": { "blueprint": "cli-app" }, // registry projects key or entry path
	"machine": { "blueprint": "main" }, // registry machines key; global to $HOME
	"github": { "blueprint": "npm-package", "repo": "owner/repo" }, // repo optional
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

- ≥1 scope required; omitting a scope = permanent scope filter. Strict schema: unknown keys → exit 2.
- `source.type` only `"github"`; `ref` default `main` (branch/tag/commit). Pin a tag/commit for reproducibility; `main` moves and there is no cache, so upstream pushes hit the next run.
- Blueprint resolution: exact key (case-sensitive, trimmed) or normalized entry path (`projects/cli-app.json` ≡ `./projects/cli-app.json`). No basename/fuzzy match. Unknown name → `<scope>:internal-error` listing available names (exit 1). Copy names from the registry.
- `github.repo` fallback: `$GITHUB_REPOSITORY` → cwd git `origin`. None → `github:internal-error`.
- Project targets resolve against the dir owning `conform.json`; machine targets against `$HOME`.
- Monorepo: one `conform.json` per package, run per package dir (`for d in packages/*; do (cd "$d" && bunx @adistack/conform check); done`). Put `machine` in at most one.

### Auth

`GITHUB_TOKEN` env, else `gh auth token`. Needed for: private tech-stack, rate limits, branch protection reads, all github-scope fixes (admin). Without token: public fetches work until 401/403 → github scope **skips** (exit 0) with `⚠ GitHub checks skipped` on stderr.

### Exit codes (public contract, ADR 0012)

| Code | `check`                                                                                                                 | `fix`                                                                  | `validate`                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| 0    | in sync (skips are ok)                                                                                                  | nothing left failing                                                   | all valid                         |
| 1    | drift (incl. `internal-error`, unknown blueprint, scoped-run fetch error)                                               | drift remains / cancelled / `--dry-run` found drift                    | registry or any blueprint invalid |
| 2    | desired-state error: missing/invalid `conform.json`, two scope flags, configured-scope mismatch, registry fetch failure | same + no TTY without `--all`, or non-TTY `--all` refusing risky fixes | no registry file at all           |

### Results

Id `<scope>:<blueprint>:<name>` (machine: `machine:<bp>:<section>:<name>`, section `apt|pacman|bun|file|secrets-template`; whole-scope failure: `<scope>:internal-error`, no `upstream`, `target` = scope name).

| Bucket         | Meaning                                                        | Action                         |
| -------------- | -------------------------------------------------------------- | ------------------------------ |
| ok             | matches upstream                                               | —                              |
| skipped        | not enforced (no API, auth 401/403, extras without `--strict`) | none; not drift                |
| fixable        | carries `fix`: `overwrite-file`, `run-command`, `github-api`   | `fix`                          |
| manual         | `hint` only                                                    | human follows hint             |
| internal-error | scope threw                                                    | read `actual`; counts as drift |

`--json` → `{ desiredStates, ok, passed, failed, skipped, total, results[] }`; result fields `id kind scope upstream target expected actual fix? hint? skipped?`. Gate on exit code or `ok`; exclude skips. `--json` ignores `--verbose`. Probe with `check --json`; preview with `fix --dry-run`.

### Fix flow and safety (ADR 0010/0011)

1. Lists manual items + hints. 2. Diff preview (≤20 diffs, skip >~200KB; commands/REST steps printed). 3. Multiselect (TTY) or `--all`. 4. Apply: `overwrite-file` first, then commands/API (commands 10-min timeout). 5. Re-check selected ids (project narrowed; machine/github whole; full fallback on error). Ends `Fixed X/Y. N still failing` — re-check is authoritative.

- Backup `<target>.conform.bak[.N]` before replacing a regular file (secrets templates keep one; symlinks are replaced without a backup). Non-regular target refused before reading. Conflicting writes to one path abort.
- Non-TTY `--all`: if even one fix runs a command, calls the GitHub API, or writes outside the project (real path, symlinked parents resolved), the whole run is refused with exit 2 ("Re-run in a terminal") — nothing is applied, risky fixes are not skipped-and-continued. Never try to work around this; hand those to a human.
- A selected id missing from re-check = resolved (e.g. removed extra) only if that scope's re-check had no new failure; a re-check skip never replaces a failure.

### Agent recipe

1. Read `conform.json`: pin, scopes. 2. `check --json` (narrow with `--*-only`). Classify every non-ok non-skipped result fixable vs manual. 3. `fix --dry-run`; confirm would-fix list = fixable set. 4. Non-TTY: `fix --all` only when every fixable is a project file (if even one runs a command, calls the GitHub API, or writes outside the project, the whole run is refused with exit 2); machine package installs, github API fixes → ask user to run `fix` in a terminal. 5. Manual → follow `hint` (edit file, fill template placeholders, mkdir, author fixes upstream). 6. Done when `check` exits 0.

Drift owner by `actual`: `<blueprint fetch failed>` → network/token, retry; `<blueprint file missing>` → tech-stack author (manifest `source` points nowhere); `<unreadable>` → local permissions. Fetched-blueprint schema violation is drift in that scope (author's bug), not exit 2. A `registry.json` that cannot be fetched at all is exit 2, not drift.

## What each scope enforces

### project (`files[]` + `file_structure[]`)

- Fetch per unique `repo@ref`: `registry.json` once → blueprint manifest → only needed upstreams (dedup, 16-way, 30s timeout, no cache).
- Plain upstream: byte compare. Missing/mismatch → fixable `overwrite-file`.
- JSON upstream (JSONC-tolerant): semantic compare; fix writes local indent style.
- `compare.ignore: ["key"]`: top-level keys excluded; `fix` preserves local values (e.g. oxlint/oxfmt `overrides`).
- Template = upstream parses as JSON object/array AND holds `<...>` placeholders. Each slot accepts any non-empty, placeholder-free per-project value; everything else must match; extra local fields/array items allowed; placeholder keys fuzzy-match. Template drift, missing template target, or verbatim copy (placeholders left) → manual. `<...>` in non-JSON (TS generics, HTML) never counts.
- `file_structure[]` (`kind: file|dir`): existence only, missing → manual (generate / `mkdir -p` hint). Never auto-created. Target also in `files[]` → dropped (content check owns it).

### machine (packages + `files[]`)

- Packages `packages.apt|pacman|bun: { name: version|"latest" }`. Auto-OS detection from `/etc/os-release`: Arch-based distros check `pacman`, Ubuntu/Debian-based distros check `apt` (the other system's packages are ignored), `bun` globals always run alongside. Unsupported distros check `bun` only plus a skipped `machine:<bp>:packages:system` warning (`It seems you have not defined any system packages OR your OS Distro is not supported.`). Missing or wrong pinned version → fixable install (`name=ver` for apt/pacman, `name@ver` for bun; apt/pacman get `--` before names). apt/pacman installs first refresh, upgrade, and autoremove (`apt-get update`, `upgrade -y`, `autoremove -y`; `pacman -Syu` plus orphan removal), then install. Dependency-installed counts as present.
- Extras = explicitly installed, undeclared, not in `allowlist` → skipped; `--strict` makes them fixable removals. Clean `check` + dirty `check --strict` is normal.
- File without `secrets` = **plain file**: `target` must be a regular file matching the upstream. Missing/mismatch → fixable (backed up, then overwritten). Symlink → fixable (replaced with a regular file). Directory/special file at target → manual. Extra files never drift.
- File with `secrets: [NAME…]` = **secrets template**: one `sops --decrypt` per run of manifest-adjacent `secrets.yaml` (flat `KEY: value`, `CAPITAL_CASING` keys); only listed names fill `$$NAME$$`; `mode` (`0600` default | `0644`) always enforced, narrowed before write. Content always `<redacted>` in output/JSON/diffs. Missing `sops`/age key, absent secret, leftover `$$…$$` → manual. `check --skip-secrets` skips decrypting: each `$$NAME$$` matches any value (regex structure check) plus existence/mode; mismatches are manual with no fix — re-run without the flag for the fixable diff.
- Probes (`apt-mark showmanual`, `dpkg-query -W`, `pacman -Q`, `bun pm -g ls`, `sops`) time out at 60s. Only the distro's system manager is listed (a manager whose tools are absent anyway contributes nothing); other domain failures → `machine:<bp>:<domain>` result.

### github (fixed check list via REST, ADR 0008)

Manifest is flat in Settings-sidebar order (ADR 0015): general fields → `access?` → code/planning/automation fields → security/quality fields → `integrations?` → community fields; every leaf's schema `describe` names its UI path and API/READ/UI handling. Ids `github:<bp>:<check>`, reported in sidebar order (API checks first, then UI-only): General → `general` (About, template, default branch, wikis/issues/projects/PR toggles + PR creation permissions + merge methods, commit signoff, danger_zone visibility/allow_forking/archived; Discussions is reported but toggled in the UI — no PATCH field), `releases`, `custom-properties`; Access → `access`, `access-limits` (interaction limits, fix PUT/DELETE); Rulesets → `rulesets` (matched by name, deep-compared after normalising live rules; fix POSTs missing, PUTs drifted; undeclared rulesets ignored; an absent rule key must not exist live); Branches (only when `branches` is set) → `pr-checks`, `reviews`; Actions → `actions-permissions` (enabled, allowed, sha pinning, selected actions), `actions-workflow` (workflow_permissions + fork_pr_approval enum), `actions-retention`, `actions-fork-pr-private`/`actions-access` (422 on public → skipped), `actions-cache` (402 → skipped), `runners` (manual), `actions-oidc` (use_default/include_claim_keys/immutable_subject fix); `webhooks` (incl. insecure_ssl); Copilot → `copilot-code-review` (PATCH), `copilot-cloud` (READ: cloud policies/automations/validation tools, cloud internet access, MCP config — drift manual with the Settings path); Environments → `environments` (existence, fix PUT), `environment-protection` (wait, reviewers, self-review, branch/tag patterns; admin_bypass and custom_protection_rules manual); `codespaces` (devcontainer file, manual); `pages` (incl. build_type, public); Security → `security` (secret protection incl. delegated bypass/dismissal, PVR, Dependabot alerts + security updates; validity_checks/custom_patterns manual), `security-dependency-graph` (no API: passes when on for a public repo, else skipped), `dependabot-version-updates` (dependabot.yml presence, manual), `dependabot-runner` (404 → skipped), `code-scanning` (default setup PATCH; languages are a subset), `ai-scan`, `deploy-keys` (title + read_only, manual), `secrets` (presence of Actions/Agents/Codespaces/Dependabot secrets+variables and per-environment secrets/variables, manual); Integrations → `autolinks`; Community → `community`, `codeowners`, `issue-templates`. UI-only ids (pass when off/default, else skipped naming the exact Settings path; no result when the field is omitted): `social-preview`, `wiki-editing`, `issue-permissions`, `sponsorships`, `preserve-repository`, `archive-settings` (commits.comments_allowed + archives + pushes), `auto-close`, `branch-protection-disabled`, `pull-request-limits`, `code-review-limits`, `actions-policies`, `copilot` (code-review UI toggles, sandbox, shared automations, code-review firewall, memory, dreaming), `agent-suggestions` (passes at `cautious`), `codespaces-prebuilds`, `pvr-settings`, `dependency-auto-submit` (passes at `disabled`), `dependabot-rules`, `copilot-autofix`, `advanced-security-ui`, `github-apps`, `notifications`. Conditional-only ids: `settings` (missing blueprint/file), `auth` (401/403). Optional sections/fields that are omitted produce no result; empty lists pass. Fixes are `github-api` (admin token, TTY only). Removed in v2: `tag-protection` (endpoint gone — use a `target: "tag"` ruleset), `required-workflows`, `merge-queue` (use the `merge_queue` ruleset rule), `security-vuln-reporting`/`security-dependabot` notes (an auth failure now skips the whole `security` check). Danger-zone dialog mapping: change visibility → `general.danger_zone.visibility`, archive → `general.danger_zone.archived` (API fixes), disable branch protection rules → `branch_protection_rules_disabled` (UI); transfer/delete are destructive with no field. Name is not a field (rename breaks the target).

## Authoring a tech-stack repo

Data-only repo: `registry.json` + manifests + payload files. Full field reference, examples, and the publish/rollout loop: [references/tech-stack.md](references/tech-stack.md). Minimum loop:

1. Add payload under `projects/files/<group>/<file>` (or `machines/files/…`).
2. Reference it from a manifest `files[]` entry (`name`, repo-relative `source`, `target`).
3. List the manifest in `registry.json` (key → file path, never a dir).
4. `bunx @adistack/conform validate` in the tech-stack root → exit 0.
5. Push / tag; consumers bump `source.ref`; consumer `check`.

## Developing this CLI repo

AGENTS.md is authoritative. Essentials: `bun dev check` runs from source; `bun run verify` gates (format, lint, types, test, knip); `bun run check:conform` dogfoods. `src/schemas/` (Zod) generates `config/*.json` on `bun run build` — never hand-edit `config/`. Scope folders `src/core/{project,machine,github}/` never import each other; upstream access via `src/core/upstream/tech-stack`. Result ids only from `checkBase`/`checkId`. Changing flags, results, exit codes, or `conform.json` semantics → update this skill + `docs/www/` + an ADR, and add a `.changeset/*.md`.

## Common mistakes

| Mistake                                               | Reality                                                 |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Running `check` from a subdir without `conform.json`  | exit 2; `cd` to owner or `--path`                       |
| `validate` in a consumer repo                         | `validate` reads `registry.json`; consumers use `check` |
| Treating skipped as failing / passing                 | Neither; excluded from drift and pass counts            |
| Fixing a manual template by copying upstream verbatim | Still manual until every `<...>` is replaced            |
| Forcing `fix --all` in CI for machine/github drift    | Refused (exit 2) by design; needs a TTY                 |
| Registry value `./machines/main/` (dir)               | Must point at the manifest file `./machines/main.json`  |
| Expecting extras to fail without `--strict`           | Skipped by default                                      |
| Hand-editing `config/*.json`                          | Edit `src/schemas/*`, `bun run build`                   |
| Typo'd blueprint expecting fuzzy match                | Exact key or path only                                  |

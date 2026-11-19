---
title: CLI
description: check and fix flags, exit codes, JSON output, and non-TTY behavior.
icon: Command
---

One binary, three verbs. Global shape first:

`bunx @adistack/conform <command> [--path <path>]`

Without `--path`, `check` / `fix` read `./conform.json` in your cwd and `validate` reads `./registry.json` in your cwd (no directory walking); `--path` accepts any path and goes after the command.

## `check`

Look, don't touch:

```bash
bunx @adistack/conform check [--path <path>] [--json] [--verbose] [--strict] [--skip-secrets] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--json`                                              | Print a machine-readable summary instead of human lines.                                     |
| `--verbose`                                           | Show passing results too (default: failing results only).                                    |
| `--strict`                                            | Report undeclared machine packages (extras) as drift.                                        |
| `--skip-secrets`                                      | Skip secret values: secrets templates check existence, mode, and structure only (no `sops`). |
| `--project-only` / `--machine-only` / `--github-only` | Run one scope. Passing two is an error.                                                      |

Output lists only drift (failing results) plus a per-scope summary (`project: N passed, M failed (K fixable), S skipped` — the `(K fixable)` part is omitted when nothing failed — with timing; `machine: in sync | drift (fixable) | manual`; `github: …` likewise). Skips print as `○ … skipped: <reason>` and count as ok. When the github scope runs without a token (`GITHUB_TOKEN`, else `gh auth token`), `check` also prints a `⚠ GitHub checks skipped` warning to stderr (branch protection needs auth even on public repos).

Exit codes: <Badge variant="success">0 everything ok</Badge> <Badge variant="warning">1 drift</Badge> <Badge variant="error">2 desired-state error</Badge>. Drift includes unknown blueprints and scoped-run fetch errors (reported as `<scope>:internal-error` with no `upstream`); top-level registry fetch errors outside the scoped run exit 2. Desired-state errors are a missing file, invalid JSON/schema, or passing two scope flags. An unresolvable GitHub target repo (no `github.repo`, no `$GITHUB_REPOSITORY`, no git origin) is drift (`github:internal-error`, exit 1), not a desired-state error.

`--json` shape:

```jsonc
{
	"desiredStates": ["<path>"],
	"ok": true,
	"passed": 9,
	"failed": 0,
	"skipped": 1,
	"total": 10,
	"results": [/* CheckResult[] */],
}
```

`--json` ignores `--verbose` (JSON always carries every result). Each result carries `id` (`project:<blueprint>:<name>`; machine uses `machine:<blueprint>:<section>:<name>` with section `apt`/`pacman`/`bun`/`file`/`secrets-template`, or `machine:<blueprint>:<domain>` when a whole domain cannot run; github uses `github:<blueprint>:<name>`; scope failures use `<scope>:internal-error`), `kind` (`project` | `machine` | `github` | `internal`), `scope` (`project` | `machine` | `github`), `target`, `expected`, `actual`, plus `upstream` (`tech-stack:<blueprint>`, omitted on `internal-error` where `target` is the scope name), `fix` (`overwrite-file` with `filePath`/`newContent`, `run-command` with `command`/`args`/`label` plus optional `preCommands[]` setup steps (run first), or `github-api` multi-step REST calls) and/or `hint` (manual always hints; fixable machine/github results may carry both), and `skipped: true` when skipped.

## `fix`

Change things, carefully:

```bash
bunx @adistack/conform fix [--path <path>] [--all] [--dry-run] [--strict] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--all`                                               | Apply all fixable items without prompting. Required for non-TTY use.                                     |
| `--dry-run`                                           | Show what would be fixed without writing. Never prompts, never writes. Implies exit 1 when drift exists. |
| `--strict`                                            | Also remove undeclared machine packages (extras).                                                        |
| `--project-only` / `--machine-only` / `--github-only` | Fix one scope. Passing two is an error.                                                                  |

<Steps>

<Step title="Triage">

`fix` reports the manual items first, each with its hint. Read these before anything changes — they need you, not the CLI.

</Step>

<Step title="Review the diff">

You get a unified diff preview (diffs over ~200KB are skipped; `run-command` fixes print every command — setup steps first — and `github-api` fixes print the REST steps instead of a diff).

</Step>

<Step title="Pick and apply">

A group-multiselect prompt lists each fix (each option shows the fix command; space toggles). `overwrite-file` fixes apply first, then commands and API fixes. Each `overwrite-file` fix writes a `.conform.bak` backup next to the target before writing (numbered `.conform.bak.N` when one already exists; secrets templates keep one; symlinks are replaced without a backup); a non-regular target is refused before anything is copied. Non-TTY `--all` refuses the whole run when any fixable writes outside the project directory (judged by real path, symlinked parent directories resolved first) — nothing is applied; re-run in a terminal instead.

</Step>

<Step title="Re-check">

Only the selected IDs are re-checked (falling back to a full re-check on error). The run ends with `Fixed X/Y. N still failing`.

</Step>

</Steps>

Exit codes: <Badge variant="success">0 nothing remains failing</Badge> <Badge variant="warning">1 drift remains / cancelled / dry-run found drift</Badge> <Badge variant="error">2 desired-state error</Badge> — including no-TTY use without `--all`, and non-TTY `--all` where even one fix runs a command, calls the GitHub API, or writes outside the project dir (the whole run is refused with `Re-run in a terminal …`, nothing is skipped-and-continued).

## `validate`

A tech-stack author tool — not a consumer check:

```bash
bunx @adistack/conform validate [--path <path>]
```

Validates the local tech-stack repo at `--path <path>` (a repo directory or a `registry.json` file; default `./registry.json` in the cwd): the `registry.json` schema, every blueprint file in every section (`projects`, `machines`, `github_configs`), every `files[]` source existing on disk, and the manifest-adjacent `secrets.yaml` existing when any machine file declares `secrets`. Prints one `✓` line per valid file to stdout and `✗` lines with the error detail to stderr. It never reads `conform.json` (for `validate`, `--path` points at the tech-stack repo directory or `registry.json` file instead) — consumers check their own drift with `check`. Tech-stack repos run it from their own `verify` script.

Exit codes: <Badge variant="success">0 all valid</Badge> <Badge variant="warning">1 invalid</Badge> <Badge variant="error">2 no registry found</Badge>. An invalid `registry.json` (bad JSON or schema violation) is exit 1; exit 2 is only when no registry file exists at all.

<Callout type="tip" title="Agents and CI">

Prefer `fix --dry-run` to review, then `fix --all` to apply. Keep `GITHUB_TOKEN` set (or log in with `gh auth login`; the env var wins) for private tech-stack repos or rate limits — the github scope works unauthenticated on public repos until 401/403/rate-limit (then it skips), and needs admin scope for fixes.

</Callout>

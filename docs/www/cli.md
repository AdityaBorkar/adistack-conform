---
title: CLI
description: check and fix flags, exit codes, JSON output, and non-TTY behavior.
icon: Command
---

One binary, three verbs. Global shape first:

`adistack-conform [--desired-state <path>] <command>`

Without `--desired-state`, the CLI walks up from your cwd to find `conform.json`; `--desired-state` accepts any path.

## `check`

Look, don't touch:

```bash
adistack-conform check [--json] [--verbose] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `--json`                                              | Print a machine-readable summary instead of human lines. |
| `--verbose`                                           | Show passing results too (default: failures only).       |
| `--project-only` / `--machine-only` / `--github-only` | Run one scope. Passing two is an error.                  |

Output lists only failures plus a per-scope summary (`project: N passed, M failed (K fixable), S skipped` with timing; `machine: in sync | drift (fixable) | manual`; `github: …` likewise). Skips print as `○ … skipped: <reason>` and count as ok.

Exit codes: <Badge variant="success">0 everything ok</Badge> <Badge variant="warning">1 drift</Badge> <Badge variant="error">2 desired-state error</Badge>. Drift includes unknown blueprints and scoped-run fetch failures (reported as `<scope>:internal-error` with no `source`); top-level registry fetch failures outside the scoped run exit 2. Desired-state errors are a missing file, invalid JSON/schema, or passing two scope flags. An unresolvable GitHub target repo (no `github.repo`, no `$GITHUB_REPOSITORY`, no git origin) is drift (`github:internal-error`, exit 1), not a desired-state error.

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

`--json` ignores `--verbose` (JSON always carries every result). Each result carries `id` (`project:<blueprint>:<name>`; github uses `github:<blueprint>:<name>`; scope failures use `<scope>:internal-error`), `kind` (`project` | `nix` | `github` | `internal`), `scope` (`project` | `machine` | `github`), `target`, `expected`, `actual`, plus `source` (`tech-stack:<blueprint>`, omitted on `internal-error` where `target` is the scope name), `fix` (`overwrite-file` with `filePath`/`newContent`, `run-command` with `command`/`args`/`label`, or `github-api` multi-step REST calls) and/or `hint` (manual always hints; fixable machine/github results may carry both), and `skipped: true` when skipped.

## `fix`

Change things, carefully:

```bash
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--all`                                               | Apply all fixable items without prompting. Required for non-TTY use.                                     |
| `--dry-run`                                           | Show what would be fixed without writing. Never prompts, never writes. Implies exit 1 when drift exists. |
| `--no-diff`                                           | Hide the unified diff preview (useful for huge files).                                                   |
| `--project-only` / `--machine-only` / `--github-only` | Fix one scope. Passing two is an error.                                                                  |

<Steps>

<Step title="Triage">

`fix` reports the manual items first, each with its hint. Read these before anything changes — they need you, not the CLI.

</Step>

<Step title="Review the diff">

Unless you passed `--no-diff`, you get a unified diff preview (diffs over ~200KB are skipped; `run-command` fixes print the command and `github-api` fixes print the REST steps instead of a diff).

</Step>

<Step title="Pick and apply">

A group-multiselect prompt lists each fix (each option shows the fix command; space toggles). `overwrite-file` fixes apply first, then commands/API fixes. Each `overwrite-file` fix writes a `.conform.bak` backup next to the target before writing (numbered `.conform.bak.N` when one already exists); writes through symlinks are refused. Non-TTY `--all` also refuses file fixes outside the project directory.

</Step>

<Step title="Re-check">

Only the selected IDs are re-checked (falling back to a full re-check on error). The run ends with `Fixed X/Y. N still failing`.

</Step>

</Steps>

Exit codes: <Badge variant="success">0 nothing remains failing</Badge> <Badge variant="warning">1 drift remains / cancelled / dry-run found drift</Badge> <Badge variant="error">2 desired-state error</Badge> — including no-TTY use without `--all`, and non-TTY `--all` with command/API fixes or file fixes outside the project dir (`Re-run in a terminal …`).

## `validate`

Check the tech-stack source itself, not your files:

```bash
adistack-conform validate
adistack-conform --desired-state ./packages/a/conform.json validate
```

Validates `registry.json` plus the blueprint file of every configured project blueprint and the settings file of every configured `github` blueprint (machine blueprints check the registry entry only, including path sanity) at the pinned `source.repo@ref`. Prints one `✓` line per valid file/entry to stdout and `✗` lines with the error detail to stderr. The global `--desired-state` flag applies here too.

Exit codes: <Badge variant="success">0 all valid</Badge> <Badge variant="warning">1 invalid</Badge> <Badge variant="error">2 desired-state error, or nothing configured</Badge>.

<Callout type="tip" title="Agents and CI">

Prefer `fix --dry-run` to review, then `fix --all` to apply. Keep `GITHUB_TOKEN` set for private tech-stack repos or rate limits — the github scope works unauthenticated on public repos until 401/403/rate-limit (then it skips), and needs admin scope for fixes.

</Callout>

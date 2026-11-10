---
title: CLI
description: check and fix flags, exit codes, JSON output, and non-TTY behavior.
icon: Command
---

One binary, two verbs. Global shape first:

`adistack-conform [--config <path>] <command>`

Without `--config`, the CLI walks up from your cwd to find `conform.json`; `--config` accepts any path.

## `check`

Look, don't touch:

```bash
adistack-conform check [--json] [--verbose] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `--json`                                              | Print a machine-readable summary instead of human lines. |
| `--verbose`                                           | Show passing checks too (default: failures only).        |
| `--project-only` / `--machine-only` / `--github-only` | Run one scope. Passing two is an error.                  |

Output lists only failures plus a per-scope summary (`project: N passed, M failed (K fixable), S skipped` with timing; `machine: in sync | drift (fixable) | error`; `github: …` likewise). Skips print as `○ … skipped: <reason>` and count as ok.

Exit codes: <Badge variant="success">0 everything ok</Badge> <Badge variant="warning">1 drift</Badge> <Badge variant="error">2 config error</Badge>. Drift includes unknown blueprints and registry/blueprint fetch failures (reported as `<scope>:internal-error`); config errors are a missing file, invalid JSON/schema, or both scope flags.

`--json` shape:

```jsonc
{
	"configs": ["<path>"],
	"ok": true,
	"passed": 9,
	"failed": 0,
	"skipped": 1,
	"total": 10,
	"results": [/* CheckResult[] */],
}
```

Each result carries `id` (`project:<blueprint>:<name>`, deps use `project:<blueprint>:deps:<pkg>`; github uses `github:<blueprint>:<name>`; scope failures use `<scope>:internal-error`), `kind` (`preset` | `package` | `nix` | `github` | `internal`), `scope` (`project` | `machine` | `github`), `source` (`tech-stack:<blueprint>`), `target`, `expected`, `actual`, plus `fix` (`overwrite-file` with `filePath`/`newContent`, `run-command` with `command`/`args`/`label`, or `github-api` multi-step REST calls) or `hint` when manual, and `skipped: true` when skipped.

## `fix`

Change things, carefully:

```bash
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--all`                                               | Apply all auto-fixable items without prompting. Required for non-TTY use.                                |
| `--dry-run`                                           | Show what would be fixed without writing. Never prompts, never writes. Implies exit 1 when drift exists. |
| `--no-diff`                                           | Hide the unified diff preview (useful for huge files).                                                   |
| `--project-only` / `--machine-only` / `--github-only` | Fix one scope. Passing two is an error.                                                                  |

<Steps>

<Step title="Triage">

`fix` reports the unfixable items first, each with its hint. Read these before anything changes — they need you, not the CLI.

</Step>

<Step title="Review the diff">

Unless you passed `--no-diff`, you get a unified diff preview (diffs over ~200KB are skipped; `run-command` fixes print the command and `github-api` fixes print the REST steps instead of a diff).

</Step>

<Step title="Pick and apply">

A group-multiselect prompt lists each fix (each option shows the fix command; space toggles). `overwrite-file` fixes apply first, then commands/API fixes.

</Step>

<Step title="Re-check">

Only the selected IDs are re-checked. The run ends with `Fixed X/Y. N still failing`.

</Step>

</Steps>

Exit codes: <Badge variant="success">0 nothing remains failing</Badge> <Badge variant="warning">1 drift remains / cancelled / dry-run found drift</Badge> <Badge variant="error">2 config error</Badge> — including no-TTY use without `--all`, and non-TTY `--all` with command/API fixes (`Re-run in a terminal …`).

## `validate`

Check the tech-stack source itself, not your files:

```bash
adistack-conform validate
```

Validates `registry.json` plus the blueprint file of every configured project/`github` blueprint (machine blueprints check the registry entry only) at the pinned `source.repo@ref`. Prints one `✓`/`✗` line per file with the error detail.

Exit codes: <Badge variant="success">0 all valid</Badge> <Badge variant="warning">1 invalid</Badge> <Badge variant="error">2 config error</Badge>.

<Callout type="tip" title="Agents and CI">

Prefer `fix --dry-run` to review, then `fix --all` to apply. Keep `GITHUB_TOKEN` set for private tech-stack repos or rate limits — the github scope works unauthenticated on public repos until 401/403/rate-limit (then it skips), and needs admin scope for fixes.

</Callout>

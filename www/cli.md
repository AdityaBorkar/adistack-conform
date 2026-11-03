---
title: CLI
description: check and fix flags, exit codes, JSON output, and non-TTY behavior.
---

Global: `adistack-conform [--config <path>] <command>`. Without `--config`, the CLI walks up from the cwd to find `conform.json`; `--config` accepts any path.

## `check`

```bash
adistack-conform check [--json] [--verbose] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `--json`                                              | Print a machine-readable summary instead of human lines. |
| `--verbose`                                           | Show passing checks too (default: failures only).        |
| `--project-only` / `--machine-only` / `--github-only` | Run one scope. Passing two is an error.                  |

Output lists only failures plus a per-scope summary (`project: N passed, M failed (K fixable), S skipped` with timing; `machine: in sync | drift (fixable) | error`; `github: …` likewise). Skips print as `○ … skipped: <reason>` and count as ok.

Exit codes: `0` everything ok, `1` drift, `2` config/loading error (missing file, invalid JSON/schema, both scope flags, fetch failures for registry/manifest).

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

Each result carries `id` (`project:<blueprint>:<name>`, deps use `project:<blueprint>:deps:<pkg>`; github uses `github:<blueprint>:<name>`), `kind` (`preset` | `package` | `nix` | `github`), `scope` (`project` | `machine` | `github`), `source` (`tech-stack:<blueprint>`), `target`, `expected`, `actual`, plus `fix` (`overwrite-file` with `filePath`/`newContent`, `run-command` with `command`/`args`/`label`, or `github-api` multi-step REST calls) or `hint` when manual, and `skipped: true` when skipped.

## `fix`

```bash
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only | --github-only]
```

| Flag                                                  | Meaning                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--all`                                               | Apply all auto-fixable items without prompting. Required for non-TTY use.                                |
| `--dry-run`                                           | Show what would be fixed without writing. Never prompts, never writes. Implies exit 1 when drift exists. |
| `--no-diff`                                           | Hide the unified diff preview (useful for huge files).                                                   |
| `--project-only` / `--machine-only` / `--github-only` | Fix one scope. Passing two is an error.                                                                  |

Flow: report unfixable items with hints → diff preview (unless `--no-diff`; diffs over ~200KB are skipped; `run-command` fixes print the command and `github-api` fixes print the REST steps instead of a diff) → group-multiselect prompt (each option shows the fix command, space to toggle) → apply in order → re-check selected IDs → print `Fixed X/Y. N still failing`.

Exit codes: `0` nothing remains failing, `1` drift remains / cancelled / dry-run found drift, `2` config error, no-TTY without `--all`, or non-TTY `--all` with command/API fixes (`Re-run in a terminal …`).

Tip: in agents and CI, prefer `fix --dry-run` (review) then `fix --all` (apply). Keep `GITHUB_TOKEN` set for private tech-stack repos — the github scope always needs it (admin scope for fixes).

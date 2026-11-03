---
title: CLI
description: check and fix flags, exit codes, JSON output, and non-TTY behavior.
---

Global: `adistack-conform [--config <path>] <command>`. `--config` must point at a file named exactly `conform.json`.

## `check`

```bash
adistack-conform check [--json] [--project-only | --machine-only]
```

| Flag                                | Meaning                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `--json`                            | Print a machine-readable summary instead of human lines. |
| `--project-only` / `--machine-only` | Run one scope. Passing both is an error.                 |

Output lists only failures plus a per-scope summary (`project: N passed, M failed (K fixable), S skipped` with timing; `machine: in sync | drift (fixable) | error`). Skips print as `○ … skipped: <reason>` and count as ok.

Exit codes: `0` everything ok, `1` drift, `2` config/loading error (missing file, wrong basename, invalid JSON/schema, both scope flags, fetch failures for registry/manifest).

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

Each result carries `id` (`project:<blueprint>:<name>`, deps use `project:<blueprint>:deps:<pkg>`), `kind` (`preset` | `package` | `nix`), `scope`, `source` (`tech-stack:<blueprint>`), `target`, `expected`, `actual`, plus `fix` (`overwrite-file` with `filePath`/`newContent`, or `run-command` with `command`/`args`/`label`) or `hint` when manual, and `skipped: true` when skipped.

## `fix`

```bash
adistack-conform fix [--all] [--dry-run] [--no-diff] [--project-only | --machine-only]
```

| Flag                                | Meaning                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--all`                             | Apply all auto-fixable items without prompting. Required for non-TTY use.                                |
| `--dry-run`                         | Show what would be fixed without writing. Never prompts, never writes. Implies exit 1 when drift exists. |
| `--no-diff`                         | Hide the unified diff preview (useful for huge files).                                                   |
| `--project-only` / `--machine-only` | Fix one scope. Passing both is an error.                                                                 |

Flow: report unfixable items with hints → diff preview (unless `--no-diff`; `run-command` fixes print the command instead of a diff) → group-multiselect prompt (`Select all` pseudo-option first, space to toggle) → apply in parallel → re-check selected IDs → print `Fixed X/Y. N still failing`.

Exit codes: `0` nothing remains failing, `1` drift remains / cancelled / dry-run found drift, `2` config error or no-TTY without `--all` (`Not a TTY: re-run with --all …`).

Tip: in agents and CI, prefer `fix --dry-run` (review) then `fix --all` (apply). Keep `GITHUB_TOKEN` set for private tech-stack repos.

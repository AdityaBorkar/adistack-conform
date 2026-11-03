---
title: Presets
description: manifest.json files, golden fetching, and per-target enforcement rules.
---

Each project blueprint has a `manifest.json` (`description` + `files[]`, optional `directories[]`) in its blueprint directory:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/project-manifest.json",
	"description": "CLI Application using Commander",
	"files": [{ "name": "Bun Config", "source": "../$presets/bunfig.toml", "target": "bunfig.toml" }],
}
```

Schema: `./configuration_schema/project-manifest.json` (generated, draft 2020-12).

## `source` resolution

Repo-relative path of the golden file for `raw.githubusercontent.com` fetches:

- Starts with `./` or `../` → resolved against the manifest directory (`../$presets/<file>` is the normal preset layout).
- Otherwise repo-relative as-is (leading `./` / `/` stripped).

Only needed goldens are fetched, deduplicated by repo-relative path, 16-way parallel. A missing golden is a manual failure (`<preset file missing>` with the repo-relative path).

## `target` classification

`target` is the enforcement destination (a leading `~/…`, `/…`, or bare `~` token is used when the line carries a human annotation). First token decides:

| Target                                   | Verdict                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs:…`                                 | Skipped (pass, exit 0) — docs-only, nothing to enforce                                    |
| Contains `%VAR%`                         | Skipped — Windows-only target                                                             |
| `~`, `~/…`, `/…`                         | Enforced at that absolute path (`~` expands against `$HOME`, respecting the env override) |
| Bare `./…` / `../…` (project scope only) | Enforced against the cwd                                                                  |
| Anything else, project scope             | Enforced as a cwd-relative path                                                           |
| No concrete path                         | Skipped with `no concrete target ("…")`                                                   |

Unmatched scopes are the common source of `○ … skipped` lines — they are in sync by definition.

## Per-file rules

- **Normal files** — byte-compared against the golden. Missing → fixable `overwrite-file`; mismatch → fixable `overwrite-file`; unreadable (e.g. `/etc/…` without sudo) → manual with a hint.
- **`compare` rules** (per `files[]` entry, JSONC-aware) — `ignore[]`: keys excluded from the compare, local values preserved by `fix` (the linter-`overrides` case); `pinned[]`: keys that must match the golden, objects merge per key so local extras survive; `versioned[]`: sections whose shared package versions must match; `strip[]`: keys dropped before comparing. Entries with `pinned`/`versioned` are templates: rest matches → pass; other drift → fixable merged overwrite; a missing target is manual (copy the golden and adapt per-project fields, since goldens hold placeholders).
- **Required paths** — `manifest.json` `required[]` must exist (content is per-project, existence only). Missing → manual (`Generate one for this project, then re-run check`).
- **Toolchain deps** — the manifest `js` field lists required packages per section (`dependencies` / `devDependencies` / `peerDependencies`) plus the `pm` binary used in hints. Missing or wrong section → manual with an install/move hint. IDs are `project:<blueprint>:deps:<pkg>`, `kind` is `package`.
- **Required dirs** — blueprint `manifest.json` `directories[]` entries must exist as directories. Missing → manual with a `mkdir -p` hint.
- **Empty goldens** — absent target passes (`absent (empty preset = defaults)`); present targets are still compared.

File, directory, and doc checks use IDs shaped `project:<blueprint>:<name>` (`name` is the manifest `name`, e.g. `project:cli-app:Bun Config`); `kind` is `preset`, `source` is `tech-stack:<blueprint>`. Toolchain dep checks use `project:<blueprint>:deps:<pkg>` with `kind` `package` and `target` `package.json`.

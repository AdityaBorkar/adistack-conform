---
title: Presets
description: manifest.json files, golden fetching, and per-target enforcement rules.
icon: Wrench
---

A project blueprint is a `manifest.json` (`description` + `files[]`, optional `file_structure[]`) sitting in its blueprint directory:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/project-manifest.json",
	"description": "CLI Application using Commander",
	"files": [{ "name": "Bun Config", "source": "../$presets/bunfig.toml", "target": "bunfig.toml" }],
}
```

Schema: `./configuration_schema/project-manifest.json` (generated, draft 2020-12).

## Where goldens come from

`source` is the golden file's repo-relative path, used for `raw.githubusercontent.com` fetches:

- Starts with `./` or `../` → resolved against the manifest directory (`../$presets/<file>` is the normal preset layout).
- Otherwise repo-relative as-is (leading `./` / `/` stripped).

Only the goldens you need are fetched, deduplicated by repo-relative path, 16-way parallel. A missing golden is a manual failure (`<preset file missing>` with the repo-relative path).

## Where targets land

`target` is the enforcement destination (a leading `~/…`, `/…`, or bare `~` token is used when the line carries a human annotation). The first token decides:

| Target                                   | Verdict                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs:…`                                 | Skipped (pass, exit 0) — docs-only, nothing to enforce                                    |
| Contains `%VAR%`                         | Skipped — Windows-only target                                                             |
| `~`, `~/…`, `/…`                         | Enforced at that absolute path (`~` expands against `$HOME`, respecting the env override) |
| Bare `./…` / `../…` (project scope only) | Enforced against your cwd                                                                 |
| Anything else, project scope             | Enforced as a cwd-relative path                                                           |
| No concrete path                         | Skipped with `no concrete target ("…")`                                                   |

<Callout type="info" title="Skips are the common case">

Unmatched scopes are the usual source of `○ … skipped` lines — they are in sync by definition. A quiet scope is a happy scope.

</Callout>

## How each file is judged

<Accordion title="Normal files — byte-compared">

Missing → fixable `overwrite-file`. Mismatch → fixable `overwrite-file`. Unreadable (e.g. `/etc/…` without sudo) → manual with a hint.

</Accordion>

<Accordion title="Compare rules — semantic, JSONC-aware">

Per `files[]` entry: `ignore[]` keys are excluded from the compare and your local values are preserved by `fix` (the linter-`overrides` case); `pinned[]` keys must match the golden, objects merge per key so local extras survive; `versioned[]` sections must share package versions for packages on both sides, while a golden-listed package missing locally is drift; `strip[]` keys are dropped before comparing. Entries with `pinned`/`versioned` are templates: rest matches → pass; other drift → fixable merged overwrite; a missing target is manual (copy the golden and adapt per-project fields, since goldens hold placeholders). Templates never pass on byte equality — a verbatim copy fails manual until every golden `<...>` placeholder (e.g. `package.json` `<package-name>`) is replaced.

</Accordion>

<Accordion title="File structure — existence only">

`manifest.json` `file_structure[]` entries (`name` + `target` + `kind: file|dir`) must exist; content is per-project. Missing file → manual with a generate hint; missing dir → manual with a `mkdir -p` hint.

</Accordion>

<Accordion title="Toolchain deps — pinned packages">

The manifest `js` field pins required packages per section (`dependencies` / `devDependencies` / `peerDependencies`) to exact versions (`"any"` means any installed version counts), plus the `pm` binary used in hints. Missing, wrong section, or version drift → manual with an install/move/update hint. IDs are `project:<blueprint>:deps:<pkg>`, `kind` is `package`.

</Accordion>

<Accordion title="Empty goldens — always pass">

Pass regardless of local content (`absent (empty preset = defaults)`; present targets are kept as-is).

</Accordion>

File, directory, and doc checks use IDs shaped `project:<blueprint>:<name>` (`name` is the manifest `name`, e.g. `project:cli-app:Bun Config`); `kind` is `preset`, `source` is `tech-stack:<blueprint>`. Toolchain dep checks use `project:<blueprint>:deps:<pkg>` with `kind` `package` and `target` `package.json`.

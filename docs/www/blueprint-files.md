---
title: Blueprint files
description: blueprint files, golden fetching, and per-target enforcement rules.
icon: Wrench
---

A project blueprint is a JSON file (e.g. `projects/cli-app.json`) with `@name`/`@description` + `files[]` and optional `file_structure[]`:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/project-manifest.json",
	"@name": "CLI",
	"@description": "CLI Application using Commander",
	"files": [
		{ "name": "Bun Config", "source": "projects/files/bunfig/base.toml", "target": "bunfig.toml" },
	],
}
```

Schema: `./configuration_schema/project-manifest.json` (generated, draft 2020-12).

## Where goldens come from

`source` is the golden file's repo-relative path, used for `raw.githubusercontent.com` fetches (e.g. `projects/files/<group>/<variant>`; a leading `/` is stripped). Paths starting with `./` or `../` are rejected — sources must be repo-relative.

Only the goldens you need are fetched, deduplicated by repo-relative path, 16-way parallel. A missing golden is a manual failure (`<blueprint file missing>` with the repo-relative path).

## Where targets land

`target` is the manifest-declared enforcement destination, resolved against your cwd. Leading `~` expands against `$HOME`; absolute paths pass through.

## How each file is judged

<Accordion title="Normal files — byte-compared">

Missing → fixable `overwrite-file`. Mismatch → fixable `overwrite-file`. Unreadable (e.g. `/etc/…` without sudo) → manual with a hint.

</Accordion>

<Accordion title="Compare rules — semantic, JSONC-aware">

Per `files[]` entry: `ignore[]` keys are excluded from the compare and your local values are preserved by `fix` (the linter-`overrides` case). A golden is a template only when it parses as a JSON object (JSONC-tolerant) and holds `<...>` placeholders: each slot accepts any per-project value (non-empty, no `<...>` placeholders, matching the surrounding text) while every other field must match — extra local fields and array items are allowed, placeholder keys fuzzy-match per-project names. Failures are manual. A missing template target is manual (copy the golden and adapt per-project fields). Templates never pass on byte equality — a verbatim copy fails manual until every golden `<...>` placeholder (e.g. `package.json` `<package-name>`) is replaced. `<...>` in non-JSON goldens (HTML, TS generics) never counts as a template.

</Accordion>

<Accordion title="File structure — existence only">

Blueprint `file_structure[]` entries (`name` + `target` + `kind: file|dir`) must exist; content is per-project. Missing file → manual with a generate hint; missing dir → manual with a `mkdir -p` hint. An entry whose `name` overlaps a `files[]` name is dropped with no result in favor of the file check.

</Accordion>

</Accordion>

File and directory checks use IDs shaped `project:<blueprint>:<name>` (`name` is the manifest `name`, e.g. `project:cli-app:Bun Config`); `kind` is `project`, `source` is `tech-stack:<blueprint>`.

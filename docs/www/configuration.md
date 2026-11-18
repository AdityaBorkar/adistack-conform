---
title: Configuration
description: conform.json reference — source, project, and machine sections plus loading rules.
icon: Gear
---

Your whole setup in one file. Most repos need fewer than ten lines:

```jsonc
{
	"$schema": "./config/conform.json",
	"machine": { "blueprint": "main" },
	"project": { "blueprint": "cli-app" },
	"github": { "blueprint": "npm-package" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

Validate against `./config/conform.json` (generated from Zod schemas — never hand-edit it, regen with `bun run build`).

## `source` <Badge variant="error">required</Badge>

Where your blueprints live.

| Field  | Required | Default  | Meaning                                                                   |
| ------ | -------- | -------- | ------------------------------------------------------------------------- |
| `type` | yes      | —        | Always `"github"`. Only github is supported.                              |
| `repo` | yes      | —        | `owner/repo` holding project and machine blueprints.                      |
| `ref`  | no       | `"main"` | Branch, tag, or commit to download. Pin a tag/commit for reproducibility. |

<Callout type="tip" title="Pin your ref">

Refs containing `/` work as plain path segments in `raw.githubusercontent.com` URLs. `main` moves; a tag does not. Pin a tag once you like what you see.

</Callout>

## `project` <Badge variant="muted">optional</Badge>

At least one of `project` / `machine` / `github` is required — omit the others to track fewer scopes.

| Field       | Meaning                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blueprint` | Project blueprint matching a tech-stack root `registry.json` `projects` key — by key or entry `path` (e.g. `cli-app`, or `projects/cli-app.json`). Basenames alone never match. |

Project targets resolve against the directory that owns `conform.json`, so you can run from any subdirectory. Leading `~` expands against `$HOME`; absolute `target` paths pass through.

## `machine` <Badge variant="muted">optional</Badge>

| Field       | Meaning                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `blueprint` | Machine blueprint matching a `registry.json` `machines` key — by key or entry `path` (e.g. `main`). |

Machine state is declared by the manifest file (packages plus `files[]`); there is no per-machine attribute to select. See [blueprints](./blueprints.md) for matching details.

## `github` <Badge variant="muted">optional</Badge>

| Field       | Required | Default                                              | Meaning                                                                   |
| ----------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `blueprint` | yes      | —                                                    | `github_configs` key whose settings file is checked (e.g. `npm-package`). |
| `repo`      | no       | `$GITHUB_REPOSITORY`, then the cwd git origin remote | `owner/repo` whose settings are checked.                                  |

The upstream is the settings file listed in `registry.json` `github_configs` (e.g. `github-configs/<name>.json`, validated by `configuration_schema/github.json`). Checks and fixes call the GitHub REST API: public repos work without a token until 401/403/rate-limit, then the scope skips (still exit 0); private repos or rate limits need `GITHUB_TOKEN` (admin scope for fixes); `GITHUB_REPOSITORY` selects the target repo in CI when `repo` is omitted. When no repo can be resolved (no `github.repo`, no `$GITHUB_REPOSITORY`, no git origin), the scope reports `github:internal-error` drift (exit 1).

## Loading rules

- Without `--path`, `check` / `fix` read `./conform.json` in your cwd (no directory walking); a missing file exits 2. `validate` never reads `conform.json` — without `--path` it reads `./registry.json` in your cwd instead.
- With `--path <path>`, any path is accepted. The path may use `~` (expands against `$HOME`) and resolves against your cwd.
- Invalid JSON or schema violations print a `zod` summary and exit 2.
- `--project-only` / `--machine-only` / `--github-only` filter at run time; omitting the other scopes from `conform.json` has the same effect permanently.

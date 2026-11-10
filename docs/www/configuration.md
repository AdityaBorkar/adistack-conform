---
title: Configuration
description: conform.json reference — source, project, and machine sections plus loading rules.
icon: Gear
---

Your whole setup in one file. Most repos need fewer than ten lines:

```jsonc
{
	"$schema": "./configuration_schema/conform.json",
	"machine": { "blueprint": "main", "configuration": "adityab" },
	"project": { "blueprint": "cli-app" },
	"github": { "blueprint": "npm-package" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

Validate against `./configuration_schema/conform.json` (generated from Zod schemas — never hand-edit it, regen with `bun run gen:json-schema`).

## `source` <Badge variant="error">required</Badge>

Where your blueprints live.

| Field  | Required | Default  | Meaning                                                                   |
| ------ | -------- | -------- | ------------------------------------------------------------------------- |
| `type` | yes      | —        | Always `"github"`. Only github is supported.                              |
| `repo` | yes      | —        | `owner/repo` holding project blueprints and machine nix flakes.           |
| `ref`  | no       | `"main"` | Branch, tag, or commit to download. Pin a tag/commit for reproducibility. |

<Callout type="tip" title="Pin your ref">

Refs containing `/` work — plain path segments in `raw.githubusercontent.com` URLs, `encodeURIComponent`-escaped in flake URLs. `main` moves; a tag does not. Pin a tag once you like what you see.

</Callout>

## `project` <Badge variant="muted">optional</Badge>

At least one of `project` / `machine` / `github` is required — omit the others to track fewer scopes.

| Field       | Meaning                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blueprint` | Project blueprint matching a tech-stack root `registry.json` `projects` key — by key, `path`, or path basename without `.json` (e.g. `cli-app`). |

Project targets resolve against your cwd, so run from the directory that owns `conform.json`. Leading `~` expands against `$HOME`; absolute `target` paths pass through.

## `machine` <Badge variant="muted">optional</Badge>

| Field           | Meaning                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `blueprint`     | Machine blueprint matching a `registry.json` `machines` key — by key, display `name`, `path`, or flake directory basename (e.g. `main`). |
| `configuration` | Optional `homeConfigurations` attribute to switch to (e.g. `adityab`). Omit it and `home-manager` auto-selects from `$USER`.             |

Machines are entirely nix-managed. See [blueprints](./blueprints.md) for matching details and flake-dir resolution.

## `github` <Badge variant="muted">optional</Badge>

| Field       | Required | Default                                              | Meaning                                                                   |
| ----------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `blueprint` | yes      | —                                                    | `github_configs` key whose settings file is checked (e.g. `npm-package`). |
| `repo`      | no       | `$GITHUB_REPOSITORY`, then the cwd git origin remote | `owner/repo` whose settings are checked.                                  |

The golden is the settings file listed in `registry.json` `github_configs` (e.g. `github-configs/<name>.json`, validated by `configuration_schema/github.json`). Checks and fixes call the GitHub REST API: public repos work without a token until 401/403/rate-limit, then the scope skips (still exit 0); private repos or rate limits need `GITHUB_TOKEN` (admin scope for fixes); `GITHUB_REPOSITORY` selects the target repo in CI when `repo` is omitted. When no repo can be resolved (no `github.repo`, no `$GITHUB_REPOSITORY`, no git origin), the scope reports `github:internal-error` drift (exit 1).

## Loading rules

- Without `--desired-state`, `check` / `fix` / `validate` walk up from your cwd to find `conform.json`; a missing file exits 2.
- With `--desired-state <path>`, any path is accepted. The path may use `~` (`untildify`) and resolves against your cwd.
- Invalid JSON or schema violations print a `zod` summary and exit 2.
- `--project-only` / `--machine-only` / `--github-only` filter at run time; omitting the other scopes from `conform.json` has the same effect permanently.

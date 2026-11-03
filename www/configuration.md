---
title: Configuration
description: conform.json reference — source, project, and machine sections plus loading rules.
---

```jsonc
{
	"$schema": "./configuration_schema/conform.json",
	"machine": { "blueprint": "main", "configuration": "adityab" },
	"project": { "blueprint": "cli-app" },
	"github": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

Validate with `./configuration_schema/conform.json` (generated from Valibot schemas — never hand-edit, regen via `bun run gen:json-schema`).

## `source` (required)

| Field  | Required | Default  | Meaning                                                                   |
| ------ | -------- | -------- | ------------------------------------------------------------------------- |
| `type` | yes      | —        | Always `"github"`. Only github is supported.                              |
| `repo` | yes      | —        | `owner/repo` holding project blueprints and machine nix flakes.           |
| `ref`  | no       | `"main"` | Branch, tag, or commit to download. Pin a tag/commit for reproducibility. |

Refs containing `/` work — plain path segments in `raw.githubusercontent.com` URLs, `encodeURIComponent`-escaped in flake URLs.

## `project` (optional, at least one of `project` / `machine` / `github` required)

| Field       | Meaning                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blueprint` | Project blueprint matching a tech-stack root `registry.json` `projects[]` entry — by entry `name`, entry `path`, or directory basename (e.g. `cli-app`). |

Project targets resolve against the cwd, so run from the directory that owns `conform.json`.

## `machine` (optional)

| Field           | Meaning                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `blueprint`     | Machine blueprint matching a `registry.json` `machines[]` entry — by entry `name`, entry `path`, or flake directory basename (e.g. `main`). |
| `configuration` | Optional `homeConfigurations` attribute to switch to (e.g. `adityab`). Omit it and home-manager auto-selects from `$USER`.                  |

Machines are entirely nix-managed. See [blueprints](./blueprints.md) for matching details and flake-dir resolution.

## `github` (optional)

| Field       | Required | Default                                              | Meaning                                                                                      |
| ----------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `blueprint` | yes      | —                                                    | Blueprint whose `manifest.json` `github` key points at the settings preset (e.g. `cli-app`). |
| `repo`      | no       | `$GITHUB_REPOSITORY`, then the cwd git origin remote | `owner/repo` whose settings are checked.                                                     |

The golden is the preset file referenced by the blueprint `manifest.json` `github` key (e.g. `../$presets/github-configs/<name>.json`, validated by `configuration_schema/github.json`). Checks and fixes call the GitHub REST API: public repos work without a token until 401/403/rate-limit, then the scope skips (still exit 0); private repos or rate limits need `GITHUB_TOKEN` (admin scope for fixes); `GITHUB_REPOSITORY` selects the target repo in CI when `repo` is omitted.

## Loading rules

- Without `--config`, `check` / `fix` walk up from the cwd to find `conform.json`; missing file exits 2.
- With `--config <path>`, any path is accepted. The path may use `~` (`untildify`) and resolves against the cwd.
- Invalid JSON or schema violations print a `valibot` summary and exit 2.
- `--project-only` / `--machine-only` / `--github-only` filter at run time; omitting the other scopes from `conform.json` has the same effect permanently.

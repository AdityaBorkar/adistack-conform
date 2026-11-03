---
title: Configuration
description: conform.json reference — source, project, and machine sections plus loading rules.
---

```jsonc
{
	"$schema": "./configuration_schema/conform.json",
	"machine": { "blueprint": "main", "configuration": "adityab" },
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

Validate with `./configuration_schema/conform.json` (generated from Valibot schemas — never hand-edit, regen via `bun run gen:json-schema`).

## `source` (required)

| Field    | Required | Default  | Meaning                                                                   |
| -------- | -------- | -------- | ------------------------------------------------------------------------- |
| `type`   | yes      | —        | Always `"github"`. Only github is supported.                              |
| `repo`   | yes      | —        | `owner/repo` holding project blueprints and machine nix flakes.           |
| `ref`    | no       | `"main"` | Branch, tag, or commit to download. Pin a tag/commit for reproducibility. |
| `branch` | no       | —        | Overrides `ref` as the ref to download when both are set.                 |

Refs containing `/` work — plain path segments in `raw.githubusercontent.com` URLs, `encodeURIComponent`-escaped in flake URLs.

## `project` (optional, at least one of `project` / `machine` required)

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

## Loading rules

- Without `--config`, `check` / `fix` load `./conform.json` from the cwd; missing file exits 2.
- With `--config <path>`, the basename must be exactly `conform.json` — anything else exits 2. The path may use `~` (`untildify`) and resolves against the cwd.
- Invalid JSON or schema violations print a `valibot` summary and exit 2.
- `--project-only` / `--machine-only` filter at run time; omitting the other scope from `conform.json` has the same effect permanently.

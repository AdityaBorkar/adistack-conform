---
title: Configuration
description: conform.json reference: every field, its type and default, and how the file is loaded.
icon: Gear
---

`conform.json` declares the desired state: which blueprints this project, machine, and GitHub repo must match, and the pin (`source`) that holds them. The schema is strict: an unknown key, invalid JSON, or a missing required field exits 2. The schema source is `src/schemas/config.ts`.

```jsonc
{
	"$schema": "./node_modules/@adistack/conform/config/conform.json",
	"project": { "blueprint": "cli-app" },
	"machine": { "blueprint": "main" },
	"github": { "blueprint": "npm-package" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

At least one of `project`, `machine`, or `github` is required. Leaving a scope out has the same effect as a permanent `--<scope>-only` filter on the others.

## Top-level fields

| Field     | Type     | Default | Required          | Description                                                               |
| --------- | -------- | ------- | ----------------- | ------------------------------------------------------------------------- |
| `$schema` | `string` | none    | no                | JSON Schema reference for editor completion. The CLI ignores it.          |
| `source`  | `object` | none    | yes               | The pin: the tech-stack repo and ref holding the registry and blueprints. |
| `project` | `object` | none    | one scope or more | Project desired state.                                                    |
| `machine` | `object` | none    | one scope or more | Machine desired state.                                                    |
| `github`  | `object` | none    | one scope or more | GitHub repo settings desired state.                                       |

The JSON Schema ships in the package at `config/conform.json`, generated from the Zod schema at build time.

## `source`

| Field  | Type       | Default  | Required | Description                                                               |
| ------ | ---------- | -------- | -------- | ------------------------------------------------------------------------- |
| `type` | `"github"` | none     | yes      | Provider hosting the pin. `github` is the only value.                     |
| `repo` | `string`   | none     | yes      | `owner/repo` of the tech-stack repo. Letters, digits, `_`, `.`, `-` only. |
| `ref`  | `string`   | `"main"` | no       | Branch, tag, or commit. Must not contain `?`, `#`, or `\`.                |

Every run fetches the pin from `raw.githubusercontent.com` with no local cache (ADR 0004), so a push to a branch ref reaches the next `check`. Pin a tag or commit to adopt blueprint changes deliberately.

## `project`

| Field       | Type     | Default | Required | Description                                                       |
| ----------- | -------- | ------- | -------- | ----------------------------------------------------------------- |
| `blueprint` | `string` | none    | yes      | Key or entry path in the registry `projects` map, e.g. `cli-app`. |

Project targets resolve against the directory that holds `conform.json`. A leading `~` expands to `$HOME`; an absolute target is used as is.

## `machine`

| Field       | Type     | Default | Required | Description                                                    |
| ----------- | -------- | ------- | -------- | -------------------------------------------------------------- |
| `blueprint` | `string` | none    | yes      | Key or entry path in the registry `machines` map, e.g. `main`. |

Machine targets resolve against `$HOME`, not the project. In a monorepo, declare `machine` in one `conform.json` only. See [machine](./machine.md) for packages, files, and secrets templates.

## `github`

| Field       | Type     | Default                                                   | Required | Description                                             |
| ----------- | -------- | --------------------------------------------------------- | -------- | ------------------------------------------------------- |
| `blueprint` | `string` | none                                                      | yes      | Key or entry path in the registry `github_configs` map. |
| `repo`      | `string` | `$GITHUB_REPOSITORY`, then the `origin` remote of the cwd | no       | `owner/repo` whose settings are checked.                |

When none of the three sources yields a repo, the scope reports `github:internal-error`, which is drift (exit 1).

## Blueprint resolution

A `blueprint` value matches a registry entry by exact key (case-sensitive, surrounding whitespace trimmed) or by entry path, where `projects/cli-app.json` and `./projects/cli-app.json` are equal. Basenames and near matches never resolve. An unknown name produces `<scope>:internal-error` with up to 10 available names in `actual` (exit 1). Source: `src/core/upstream/registry.ts`.

## Loading rules

- Without `--path`, `check` and `fix` read `./conform.json` in the current directory. They never search parent directories. A missing file exits 2.
- `--path <path>` loads that file instead. The path resolves against the current directory, and a leading `~` expands to `$HOME`.
- The file may contain comments and trailing commas (JSONC).
- A `--<scope>-only` flag naming a scope absent from `conform.json` exits 2.

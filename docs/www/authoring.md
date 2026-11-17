---
title: Authoring
description: Writing a tech-stack repo — registry, manifests, blueprint files, and versioning.
icon: Pencil
---

A tech-stack repo is data-only: `registry.json` + blueprint files + payload files. No build, no CI required. If you can write JSON and lay out folders, you can author one.

## Layout

<Files>

<File name="registry.json" />

<Folder name="projects">

<File name="{name}.json" />

<Folder name="files">

<File name="{group}/{variant} payload files" />

</Folder>

</Folder>

<Folder name="machines">

<File name="{name}.json" />

<Folder name="files">

<File name="{dotfile payloads}" />

</Folder>

</Folder>

</Files>

```text
registry.json
projects/<name>.json            # blueprint, e.g. projects/cli-app.json
projects/files/<group>/<file>   # payload files copied into generated projects
machines/<name>.json             # blueprint, e.g. machines/main.json
machines/files/                 # dotfile payloads (sops templates read from here)
```

Reference the blueprints in `registry.json` (`machines` + `projects` + `github_configs` maps as key/path pairs). Project blueprint `files[]` use `source` repo-relative (e.g. `projects/files/<group>/<file>`, leading `/` stripped, `./`/`../` rejected) and `target` as the enforcement target (cwd-relative, `~` expands, absolute passes through) in generated projects. A `files[]` entry may declare `compare` (`ignore[]`) for semantic compare/fix rules — upstreams are templates only when they parse as JSON objects (JSONC-tolerant) holding `<...>` placeholder slots with per-project values (e.g. `package.json` `<package-name>`); a verbatim copy fails the result until every placeholder is replaced, and non-JSON `<...>` never counts. Top-level `file_structure[]` lists existence-only entries (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`); overlapping `files[]` names are dropped in favor of the file check.

## Rules

<Callout type="error" title="Strict JSON, except where it isn't">

`registry.json` and every blueprint file are strict JSON — check with `python3 -m json.tool <file>`. Payload files under `projects/files/` are tool-consumed and not all strict JSON — don't "fix" those.

</Callout>

- `$schema` fields point at `https://stack.adityab.tech/conform/<VERSION>/schemas/<registry|project-manifest>.json`.
- Machine manifests (`machines/<name>.json`) declare `packages` (pacman/bun) plus `files[]` (`name` + `source` + `target`, optional `mode` and `secrets`). New dotfiles go under `machines/files/` + a `files[]` entry; entries with `secrets` render as templates from `source` with `@@NAME@@` placeholders whose real values live only in sops-encrypted `secrets.yaml`.

## Versioning and rollout

Consumers pin `source.ref` (branch, tag, or commit). Publish a tag for breaking blueprint changes and let repos adopt it deliberately; keep `main` moving for small fixes. Since the CLI has no local cache, pushing a blueprint change takes effect on the next `check`.

<Callout type="tip" title="After rollout">

Confirm generated-project order after rollout: `bun format && bun check:lint && bun check:types && bun test`.

</Callout>

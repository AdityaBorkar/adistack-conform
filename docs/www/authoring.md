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

<Folder name="machines/main">

<File name="flake.nix" />

<File name="home.nix" />

<Folder name="files">

<File name="{dotfile payloads}" />

</Folder>

</Folder>

</Files>

```text
registry.json
projects/<name>.json            # blueprint, e.g. projects/cli-app.json
projects/files/<group>/<file>   # payload files copied into generated projects
machines/main/{flake.nix,home.nix,…}
machines/main/files/            # dotfile payloads (sops templates read from here)
```

Reference the blueprints in `registry.json` (`machines[]` + `projects[]`, explicit `name`/`path` pairs). Project blueprint `files[]` use `source` repo-relative (e.g. `projects/files/<group>/<file>`) and `target` as the cwd-relative destination path in generated projects. A `files[]` entry may declare `compare` (`ignore[]`) for semantic compare/fix rules — goldens holding `<...>` placeholders are templates with per-project slots (e.g. `package.json` `<package-name>`); a verbatim copy fails the check until every placeholder is replaced. Top-level `file_structure[]` lists existence-only entries (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`).

## Rules

<Callout type="error" title="Strict JSON, except where it isn't">

`registry.json` and every blueprint file are strict JSON — check with `python3 -m json.tool <file>`. Payload files under `projects/files/` are tool-consumed and not all strict JSON — don't "fix" those.

</Callout>

- `$schema` fields point at `https://stack.adityab.tech/conform/<VERSION>/schemas/<registry|project-manifest>.json`.
- Machine edits: new dotfiles go under `machines/main/files/` + an entry in `home.nix` (`home.file`), except the six sops-templated files (AWS credentials, `gh/hosts.yml`, `.npmrc`, eas `user-settings.json`, opencode `opencode.json`, `.wakatime.cfg`) which are rendered by `sops.templates` and must not be added to `home.file`. Templates use `@@NAME@@` placeholders; real values live only in sops-encrypted `secrets.yaml`.
- The machine flake reads `GIT_NAME` / `GIT_EMAIL` via `getEnv` and throws without them — evaluation needs `--impure` plus those env vars, and `homeConfigurations` defaults to `$USER` when `machine.configuration` is omitted.

## Versioning and rollout

Consumers pin `source.ref` (branch, tag, or commit). Publish a tag for breaking blueprint changes and let repos adopt it deliberately; keep `main` moving for small fixes. Since the CLI has no local cache, pushing a blueprint change takes effect on the next `check`.

<Callout type="tip" title="After rollout">

Verify generated-project order after rollout: `bun format && bun check:lint && bun check:types && bun test`.

</Callout>

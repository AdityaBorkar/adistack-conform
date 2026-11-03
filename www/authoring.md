---
title: Authoring
description: Writing a tech-stack repo — registry, manifests, presets, and versioning.
---

A tech-stack repo is data-only: `registry.json` + blueprint directories. No build, no CI required.

## Layout

```text
registry.json
projects/<name>/manifest.json
projects/$presets/<payload files>   # literal `$` — quote it in shell
machines/main/{flake.nix,home.nix,…}
machines/main/files/                 # dotfile payloads (sops templates read from here)
```

Reference the blueprint directories in `registry.json` (`machines[]` + `projects[]`, explicit `name`/`path` pairs). Manifest `files[]` use `source` relative to the manifest dir (`../$presets/<file>`) and `target` as the destination path in generated projects. Top-level `js` pins the toolchain (`pm` plus per-section package→version maps). A `files[]` entry may declare `compare` (`ignore[]`, `strip[]`, `pinned[]`, `versioned[]`) for semantic compare/fix rules. Top-level `file_structure[]` lists existence-only entries (`name` + `target` + `kind: file|dir`, e.g. `src/`, `AGENTS.md`).

## Rules

- `registry.json` and every `manifest.json` are strict JSON — check with `python3 -m json.tool <file>`. Payload files under `$presets/` are tool-consumed and not all strict JSON (e.g. `biome.json` has a trailing comma) — don't "fix" those.
- `$schema` fields point at `https://stack.adityab.tech/conform/<VERSION>/schemas/<registry|project-manifest>.json`.
- Machine edits: new dotfiles go under `machines/main/files/` + an entry in `home.nix` (`home.file`), except the six sops-templated files (AWS credentials, `gh/hosts.yml`, `.npmrc`, eas `user-settings.json`, opencode `opencode.json`, `.wakatime.cfg`) which are rendered by `sops.templates` and must not be added to `home.file`. Templates use `@@NAME@@` placeholders; real values live only in sops-encrypted `secrets.yaml`.
- The machine flake reads `GIT_NAME` / `GIT_EMAIL` via `getEnv` and throws without them — evaluation needs `--impure` plus those env vars, and `homeConfigurations` defaults to `$USER` when `machine.configuration` is omitted.

## Versioning and rollout

Consumers pin `source.ref` (branch, tag, or commit). Publish a tag for breaking preset changes and let repos adopt it deliberately; keep `main` moving for small fixes. Since the CLI has no local cache, pushing a preset change takes effect on the next `check` — verify generated-project order after rollout: `bun format && bun check:lint && bun check:types && bun run build`.

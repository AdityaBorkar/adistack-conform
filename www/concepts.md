---
title: Concepts
description: Desired state, scopes, check results, and how fixes are classified.
---

## Desired state vs drift

`conform.json` declares desired state: which project blueprint and which machine blueprint the current directory and machine should match, plus which tech-stack repo (`owner/repo@ref`) holds the goldens. `check` compares reality against that state; any mismatch is drift.

## Two scopes

| Scope     | One result per                                                                                           | ID shape                                                              | What runs                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `project` | blueprint `manifest.json` `files[]` entry, plus required docs, required dirs, `package.json`, dep checks | `project:<blueprint>:<name>` (deps: `project:<blueprint>:deps:<pkg>`) | File content compared against the golden (byte, semantic, or templated — see [presets](./presets.md)) fetched from the tech-stack repo |
| `machine` | whole blueprint                                                                                          | `nix:<blueprint>`                                                     | `home-manager switch --flake <flake> --dry-run --impure` (via `home-manager`, else `nix run home-manager -- …`)                        |

Filter at runtime with `--project-only` / `--machine-only`. The machine check shells out to home-manager (which owns `$HOME`), so machines have no file targets. Nix fetches the flake itself; the CLI downloads nothing for this scope.

## Result lifecycle

Each check yields one `CheckResult`: `ok`, `skipped`, fixable (`fix: overwrite-file | run-command`), or manual (`hint`, no `fix`).

- **Pass** — target matches the golden (byte, semantic overrides-kept, or templated). Empty golden + absent target also passes (empty = defaults).
- **Skipped (still exit 0)** — `docs:` targets, Windows `%VAR%` targets, and annotation-only targets with no concrete path. Only the project scope resolves bare `./…` / `../…` targets (against the cwd).
- **Fixable** — missing file (overwrite with golden), content mismatch (overwrite, with local `overrides` / adapted `package.json` fields preserved), or real machine drift (re-run the switch without `--dry-run`). `fix` can apply these.
- **Manual** — `*.example` sources assert existence only (secret values are never compared); unreadable targets (e.g. `/etc/…` without sudo); missing preset files in the tech-stack repo; missing `AGENTS.md`/`README.md` (generate per-project content); missing required dirs (`mkdir -p`); missing/misplaced toolchain deps (`bun add -d <pkg>@<version>`); nix evaluation errors (unknown attribute, missing `GIT_NAME`/`GIT_EMAIL`, build failure); missing `home-manager`/`nix` binaries. Follow the `hint`.

## Fetch model

No local cache. Each run fetches `registry.json` once per unique `repo@ref` (shared by every spec), then each project blueprint's `manifest.json`, then only the golden files its `files[]` need — deduplicated by repo-relative path, 16-way parallel — plus the `$presets/package.json` golden for the templated `package.json` check and dep version hints. Machine blueprints skip golden downloads entirely.

After `fix` applies, the CLI re-checks only the selected IDs (falling back to a full re-check on error) and reports how many are still failing.

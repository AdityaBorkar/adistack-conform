---
title: Concepts
description: Desired state, scopes, check results, and how fixes are classified.
icon: Lightbulb
---

## Desired state vs drift

`conform.json` is your wish list: which project, machine, and github blueprints this directory, this machine, and this repo should match, plus which tech-stack repo (`owner/repo@ref`) holds the goldens. `check` compares that wish against reality. Anything that differs is drift — and drift is the whole game.

## The three scopes

Each scope answers one question: is this thing the way the blueprint says it should be?

| Scope     | One result per                                               | ID shape                     | What runs                                                                                                                              |
| --------- | ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `project` | blueprint `files[]` entry, plus required docs, required dirs | `project:<blueprint>:<name>` | File content compared against the golden (byte, semantic, or templated — see [presets](./presets.md)) fetched from the tech-stack repo |
| `machine` | whole blueprint                                              | `nix:<blueprint>`            | `home-manager switch --flake <flake> --dry-run --impure` (via `home-manager`, else `nix run home-manager -- …`)                        |
| `github`  | manifest `github` preset entry                               | `github:<blueprint>:<name>`  | Live repo settings compared against the golden via the GitHub REST API (needs `GITHUB_TOKEN`)                                          |

Run one scope at a time with `--project-only` / `--machine-only` / `--github-only`. The machine check shells out to `home-manager` (which owns `$HOME`), so machines have no file targets. Nix fetches the flake itself; the CLI downloads nothing for this scope.

## What a result means

Every check yields one `CheckResult`. Think of it as one of four buckets:

- <Badge variant="success">ok</Badge> — the target matches the golden (byte, semantic overrides-kept, or templated).
- <Badge variant="muted">skipped</Badge> — not applicable here, and that is fine (still exit 0). Github items with no public API (social preview, archive toggles, Copilot Autofix, agent suggestions, OIDC-only checks) skip with a UI hint — as do whole-scope or per-check 401/403 auth failures.
- <Badge variant="info">fixable</Badge> — `fix` can handle it: a missing file or content mismatch (overwrite with the golden, keeping your local `overrides` and adapted `package.json` fields), real machine drift (re-run the switch without `--dry-run`), or github repo-setting drift (`github-api` multi-step REST calls).
- <Badge variant="warning">manual</Badge> — needs you, with a `hint` and no `fix`: unreadable targets (e.g. `/etc/…` without sudo); missing preset files in the tech-stack repo; missing `file_structure[]` entries (generate hint for files, `mkdir -p` for dirs); nix evaluation errors (unknown attribute, missing `GIT_NAME`/`GIT_EMAIL`, build failure); missing `home-manager`/`nix` binaries. Follow the `hint`.

<Callout type="tip" title="Skips are good news">

A skipped check still exits 0. If your output is full of `○ … skipped` lines, that scope simply has nothing to enforce on this machine — in sync by definition.

</Callout>

## How fetching works

No local cache. Each run fetches `registry.json` once per unique `repo@ref` (shared by every spec), then each project blueprint file, then only the golden files its `files[]` need — deduplicated by repo-relative path, 16-way parallel. Machine blueprints skip golden downloads entirely.

After `fix` applies, the CLI re-checks only the selected IDs (falling back to a full re-check on error) and reports how many are still failing.

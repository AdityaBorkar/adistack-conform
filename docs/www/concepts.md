---
title: Concepts
description: Desired state, scopes, check results, and how fixes are classified.
icon: Lightbulb
---

## Desired state vs drift

`conform.json` is your wish list: which project, machine, and github blueprints this directory, this machine, and this repo should match, plus which tech-stack repo (`owner/repo@ref`) holds the upstreams. `check` compares that wish against reality. Anything that differs is drift — and drift is the whole game.

## The three scopes

Each scope answers one question: is this thing the way the blueprint says it should be?

| Scope     | One result per                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ID shape                               | What runs                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project` | blueprint `files[]` entry, plus `file_structure[]` existence entries                                                                                                                                                                                                                                                                                                                                                                                              | `project:<blueprint>:<name>`           | File content compared against the upstream (byte, semantic, or templated — see [blueprint files](./blueprint-files.md)) fetched from the tech-stack repo |
| `machine` | declared packages plus manifest `files[]` entries                                                                                                                                                                                                                                                                                                                                                                                                                 | `machine:<blueprint>:<section>:<name>` | Manifest fetched from the tech-stack repo, compared against installed packages and `$HOME` files (see [machine](./machine.md))                           |
| `github`  | fixed check list in Settings-sidebar order (`general`, `releases`, `custom-properties`, `access`, `access-limits`, `rulesets`, `pr-checks`, `reviews`, `actions-*`, `runners`, `webhooks`, `copilot-*`, `environments`, `environment-protection`, `codespaces`, `pages`, `security`, `dependabot-*`, `code-scanning`, `ai-scan`, `deploy-keys`, `secrets`, `autolinks`, `community`, `codeowners`, `issue-templates`, then UI-only ids — see the skill reference) | `github:<blueprint>:<name>`            | Live repo settings compared against the upstream via the GitHub REST API (needs `GITHUB_TOKEN`)                                                          |

Run one scope at a time with `--project-only` / `--machine-only` / `--github-only`. The machine check compares the manifest against installed packages and `$HOME` files; undeclared packages (extras) are skipped unless `--strict` makes them drift that `fix --strict` removes.

## What a result means

Every check yields one `CheckResult`. Think of it as one of four buckets:

- <Badge variant="success">ok</Badge> — the target matches the upstream (byte, semantic overrides-kept, or templated).
- <Badge variant="muted">skipped</Badge> — not applicable here, and that is fine (still exit 0). Omitted optional github sections and fields produce no result; empty lists pass. Github items with no public API (UI-only) pass when off/default and skip naming the exact Settings path when on; endpoints unavailable for the repo (422 public repo, 402 billing, 404 feature off) skip with the reason — as do whole-scope or per-check 401/403 auth failures. READ-only github items (community files, devcontainer, deploy keys, runners, Copilot cloud config, validity checks, custom patterns, environment custom protection rules, Dependabot version updates, Discussions toggle, environment admin bypass) carry a `hint` with no `fix`.
- <Badge variant="info">fixable</Badge> — `fix` can handle it: a missing file or content drift (overwrite with the upstream, keeping your local `overrides` and adapted `package.json` fields), machine drift (missing/wrong links, secrets-template content or mode, or packages), or github repo-setting drift (`github-api` multi-step REST calls). Fixable machine/github results may also carry a `hint` alongside the `fix`.
- <Badge variant="warning">manual</Badge> — needs you, with a `hint` and no `fix`: unreadable targets (e.g. `/etc/…` without sudo); missing blueprint files in the tech-stack repo; unfetchable machine `source` files; missing `file_structure[]` entries (generate hint for files, `mkdir -p` for dirs); undecryptable secrets (missing `sops`/age key) or leftover `@@SECRET@@` placeholders. Follow the `hint`. A `file_structure[]` entry whose target is also a `files[]` target is dropped with no result (the file check owns it).

<Callout type="tip" title="Skips are good news">

A skipped result still exits 0. If your output is full of `○ … skipped` lines, that scope simply has nothing to enforce on this machine — in sync by definition.

</Callout>

## How fetching works

No local cache. Each run fetches `registry.json` once per unique `repo@ref` (shared by every desired state), then each desired state's blueprint file (project manifests, machine manifests, github settings files), then only the upstream files its `files[]` need — deduplicated by repo-relative path, 16-way parallel.

After `fix` applies, the CLI re-checks only the selected IDs (falling back to a full re-check on error) and reports how many results are still failing.

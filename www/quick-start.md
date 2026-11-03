---
title: Quick start
description: Install the CLI, add conform.json, and run your first check and fix.
---

Run from the directory that owns `conform.json` — project targets resolve against the cwd.

## 1. Install

From source (Bun-only):

```bash
bun install
bun ./src/index.ts check
```

Or build the compiled binary (lands in `.output/adistack-conform`, also the `adistack-conform` npm bin):

```bash
bun run build
./.output/adistack-conform check
```

`verify` (`format` → `check:lint` → `check:types` → `build`) is the gate before pushing.

## 2. Add `conform.json`

```jsonc
{
	"$schema": "./configuration_schema/conform.json",
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

At least one of `project` / `machine` / `github` is required. Omit the others to track fewer scopes. `source.ref` defaults to `main`; pin a tag or commit for reproducibility. See [configuration](./configuration.md) for every field.

## 3. Check

```bash
adistack-conform check
adistack-conform check --project-only
adistack-conform check --machine-only
adistack-conform check --github-only
adistack-conform check --json   # machine-readable, for scripts
```

Exits: `0` in sync (skips count as ok), `1` drift, `2` config error. `--project-only` / `--machine-only` / `--github-only` are mutually exclusive.

## 4. Fix

```bash
adistack-conform fix --dry-run  # preview diffs, never writes, never prompts
adistack-conform fix            # interactive: space to toggle, enter to apply
adistack-conform fix --all      # apply everything fixable, no prompt
adistack-conform fix --no-diff  # skip the diff preview
```

`fix` reports unfixable items with hints first, then applies, then re-checks only the selected IDs. It needs a TTY unless you pass `--all`; `--dry-run` never prompts. Full flag and exit-code reference: [cli](./cli.md).

## Private repos and rate limits

Fetches use `raw.githubusercontent.com` (30s timeout, no local cache). For private repos or HTTP 401/403 rate limits:

```bash
GITHUB_TOKEN=ghp_... adistack-conform check
```

The `github` scope calls the GitHub REST API, so public repos work without a token until 401/403/rate-limit (then it skips); set `GITHUB_TOKEN` for private repos or rate limits (admin scope for `fix`).

Next: [concepts](./concepts.md) explains what each result means.

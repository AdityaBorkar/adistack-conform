---
title: Quick start
description: Install the CLI, add conform.json, and run your first check and fix.
icon: Rocket
---

Run everything from the directory that owns `conform.json` — project targets resolve against your current directory.

<Steps>

<Step title="Install">

Pick whichever suits you:

<Tabs>

<Tab title="Run from source">

Best while you are still exploring. Needs [Bun](https://bun.sh):

```bash
bun install
bun ./src/index.ts check
```

</Tab>

<Tab title="Compiled binary">

One self-contained file. It lands in `.output/adistack-conform` and is also the `adistack-conform` npm bin:

```bash
bun run build
./.output/adistack-conform check
```

</Tab>

</Tabs>

<Callout type="tip" title="Gate before pushing">

`verify` (`format` → `check:lint` → `check:types` → `test`) is the gate before pushing. Run `bun run build` separately for the compiled binary.

</Callout>

</Step>

<Step title="Add conform.json">

```jsonc
{
	"$schema": "./config/conform.json",
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

You need at least one of `project` / `machine` / `github`. Leave scopes out to track less. `source.ref` defaults to `main` — pin a tag or commit for reproducibility. Every field is documented in [configuration](./configuration.md).

</Step>

<Step title="Check">

```bash
adistack-conform check
adistack-conform check --project-only
adistack-conform check --machine-only
adistack-conform check --github-only
adistack-conform check --json   # machine-readable, for scripts
```

Exits: <Badge variant="success">0 in sync</Badge> (skips count as ok), <Badge variant="warning">1 drift</Badge>, <Badge variant="error">2 desired-state error</Badge>. The `--*-only` flags are mutually exclusive.

</Step>

<Step title="Fix">

```bash
adistack-conform fix --dry-run  # preview diffs, never writes, never prompts
adistack-conform fix            # interactive: space to toggle, enter to apply
adistack-conform fix --all      # apply everything fixable, no prompt
adistack-conform fix --no-diff  # skip the diff preview
```

`fix` shows the manual items with hints first, applies the rest, then re-checks only the selected IDs. It needs a TTY unless you pass `--all`; `--dry-run` never prompts. The full flag and exit-code reference lives in [cli](./cli.md).

</Step>

</Steps>

## Private repos and rate limits

Fetches use `raw.githubusercontent.com` (30s timeout, no local cache). For private repos or HTTP 401/403 rate limits:

```bash
GITHUB_TOKEN=ghp_... adistack-conform check
```

The `github` scope calls the GitHub REST API, so public repos work without a token until 401/403/rate-limit (then it skips); set `GITHUB_TOKEN` for private repos or rate limits (admin scope for `fix`).

<Callout type="success" title="You're up and running">

Next, [concepts](./concepts.md) explains what each result means — so your first red line reads as a to-do, not a mystery.

</Callout>

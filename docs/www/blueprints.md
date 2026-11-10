---
title: Blueprints
description: registry.json layout and how blueprint names resolve to files and flakes.
icon: Map
---

A tech-stack repo is just a directory of blueprints plus one index. That index is `registry.json` at the repo root, listing every blueprint as explicit `name`/`path` entries:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json",
	"machines": [{ "name": "Primary Developer Machine", "path": "./machines/main/" }],
	"projects": [{ "name": "CLI", "path": "./projects/cli-app.json" }],
}
```

Schema: `./configuration_schema/registry.json` (generated, draft 2020-12).

## How a name finds its blueprint

Your `conform.json` `blueprint` matches by the first hit:

<Steps>

<Step title="Exact entry name">

`"CLI"` matches the entry named `"CLI"`. Most readable — prefer this.

</Step>

<Step title="Normalized entry path">

`./projects/cli-app.json` ≡ `projects/cli-app.json`. Leading `./` doesn't matter (a trailing `/` marks a machine flake directory).

</Step>

<Step title="Path basename (`.json` ignored)">

`cli-app` matches the basename of an entry path, with a trailing `.json` stripped. Short and usually unambiguous.

</Step>

<Step title="Your string's own basename">

A full path you pass also resolves by its basename. Last resort, but it works.

</Step>

</Steps>

<Callout type="warning" title="No match, no mercy">

Unknown names fail the run with the available names listed (exit 1, reported as `<scope>:internal-error`). Matching is case-sensitive with whitespace trimmed — copy the name, don't retype it.

</Callout>

## Project blueprints

The entry `path` is the blueprint file: the CLI fetches it directly from the tech-stack repo. Directory entries are rejected — the path must point at the file (e.g. `./projects/cli-app.json`). See [blueprint files](./presets.md) for how its `files[]` plus `file_structure[]` entries are enforced.

## Machine blueprints

The entry `path` is the flake directory. Two things to know:

- Trailing slashes and leading `./` / `/` are normalized.
- The flake URL is `git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>[#<configuration>]` with each path segment `encodeURIComponent`-escaped. Nix fetches the flake into its own store — the CLI downloads nothing.

`check` runs `home-manager switch --flake <flake> --dry-run --impure` (via `home-manager`, else `nix run home-manager -- …`, 10-minute timeout); `fix` re-runs without `--dry-run` with inherited stdio.

<Callout type="info" title="Why --impure?">

`--impure` is required because the flake reads `$USER` / `GIT_NAME` / `GIT_EMAIL` via `getEnv`. Pure evaluation would throw before anything is checked.

</Callout>

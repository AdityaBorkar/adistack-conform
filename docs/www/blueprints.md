---
title: Blueprints
description: registry.json layout and how blueprint names resolve to files.
icon: Map
---

A tech-stack repo is just a directory of blueprints plus one index. That index is `registry.json` at the repo root, listing every blueprint as key/path pairs:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json",
	"machines": { "main": "./machines/main.json" },
	"projects": { "cli-app": "./projects/cli-app.json" },
	"github_configs": { "npm-package": "./github-configs/npm-package.json" },
}
```

Schema: `./config/registry.json` (generated, draft 2020-12).

## How a name finds its blueprint

Your `conform.json` `blueprint` matches by the first hit:

<Steps>

<Step title="Exact registry key">

`"cli-app"` matches the `projects` key `"cli-app"`. Most readable — prefer this. Machine keys match the same way (`"main"`).

</Step>

<Step title="Normalized entry path">

`./projects/cli-app.json` ≡ `projects/cli-app.json`. Leading `./` doesn't matter.

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

The map value is the blueprint file: the CLI fetches it directly from the tech-stack repo. Directory entries are rejected — the value must point at the file (e.g. `./projects/cli-app.json`). See [blueprint files](./blueprint-files.md) for how its `files[]` plus `file_structure[]` entries are enforced.

## Machine blueprints

The map value is the blueprint file: the CLI fetches it directly from the tech-stack repo. Directory entries are rejected — the value must point at the file (e.g. `./machines/main.json`). See the machine section of the [skill prompt](../../skills/adistack-conform/SKILL.md) for how its `packages` plus `files[]` entries are enforced.

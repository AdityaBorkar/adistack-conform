---
title: Blueprints
description: registry.json layout and how blueprint names resolve to directories and flakes.
---

`registry.json` at the tech-stack repo root lists every blueprint as explicit `name`/`path` entries:

```jsonc
{
	"$schema": "https://stack.adityab.tech/conform/<VERSION>/schemas/registry.json",
	"machines": [{ "name": "Primary Developer Machine", "path": "./machines/main/" }],
	"projects": [{ "name": "CLI", "path": "./projects/cli-app/" }],
}
```

Schema: `./configuration_schema/registry.json` (generated, draft 2020-12).

## Matching

`conform.json` `blueprint` matches by the first hit of:

1. Exact entry `name` (`"CLI"`),
2. Normalized entry `path` (`./projects/cli-app/` ≡ `projects/cli-app`),
3. Directory basename of the entry path (`cli-app`),
4. Basename of the requested string itself (so a full path also resolves).

Unknown names fail the run with the available names listed (exit 2). Matching is case-sensitive with whitespace trimmed.

## Project blueprints

The entry `path` is the manifest directory: the CLI fetches `<dir>/manifest.json` from the tech-stack repo. See [presets](./presets.md) for how its `files[]` (plus `file_structure[]` entries, `package.json`, and toolchain deps) are enforced.

## Machine blueprints

The entry `path` is the flake directory. Resolution:

- Trailing slashes and leading `./` / `/` are normalized.
- The flake URL is `git+https://github.com/<owner>/<repo>?ref=<ref>&dir=<path>[#<configuration>]` with each path segment `encodeURIComponent`-escaped. Nix fetches the flake into its own store — the CLI downloads nothing.
- `check` runs `home-manager switch --flake <flake> --dry-run --impure` (via `home-manager`, else `nix run home-manager -- …`, 10-minute timeout); `fix` re-runs without `--dry-run` with inherited stdio. `--impure` is required because the flake reads `$USER` / `GIT_NAME` / `GIT_EMAIL` via `getEnv`.

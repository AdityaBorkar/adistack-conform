---
title: Machine
description: Machine scope — packages, dotfile links, and secrets templates.
icon: Laptop
---

The machine scope keeps your machine — installed packages and `$HOME` dotfiles — matching the blueprint. Project targets resolve against the directory that owns `conform.json`; machine targets always resolve against `$HOME`.

```jsonc
{
	"machine": { "blueprint": "main" }, // registry machines key or entry path
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

```bash
bunx @adistack/conform check --machine-only
bunx @adistack/conform fix --machine-only
```

In a monorepo, declare `machine` in at most one `conform.json` — the check is global to `$HOME`, not per package.

## Packages

The manifest declares `packages.pacman` and `packages.bun` as `{ name: version | "latest" }`:

- Missing package or wrong pinned version → fixable install (`name=ver` / `name@ver`; pacman gets `--` before names). A dependency-installed package counts as present.
- Extra = explicitly installed, undeclared, not in `allowlist` → skipped by default. `check --strict` makes extras fixable removals (`fix --strict` removes them). A clean `check` plus a dirty `check --strict` is normal.
- `allowlist` names distro-base packages that are never reported as extras.

Each result uses `machine:<blueprint>:<manager>:<name>` (manager `pacman` / `bun`).

## Dotfile links

A `files[]` entry without `secrets` is a link: your `target` must be a symlink to the materialized upstream at `<target>.conform-src`.

- Missing, wrong, dangling, or regular file at the target → fixable (a regular file is backed up to `.conform.bak`, then the link is swapped in atomically).
- Directory or special file at the target → manual (move it aside, then re-check).
- Unreadable target or unfetchable upstream → manual.
- Extra files in `$HOME` are never drift.

Each result uses `machine:<blueprint>:link:<name>`.

## Secrets templates

A `files[]` entry with `secrets: [NAME…]` renders a template: the upstream holds `@@NAME@@` slots, filled once per run from the sops-encrypted `secrets.yaml` next to the manifest (flat `KEY: value`).

- Only the listed names are substituted; everything else in `secrets.yaml` never reaches the file.
- `mode` (`0600` default | `0644`) is always enforced.
- Rendered content is always `<redacted>` in output, diffs, and `--json`.
- Missing `sops`/age key, absent secret, leftover `@@…@@` slots, or an unreadable target → manual. Follow the `hint`.

Each result uses `machine:<blueprint>:secrets-template:<name>`.

## When the machine cannot be read

Package listing and `sops` probes time out at 60s. A domain that cannot run at all yields one manual result (`machine:<blueprint>:<domain>`) instead of per-item results — read its `actual` and `hint`, fix the cause (missing tool, permissions, network), then re-check.

<Callout type="warning" title="Machine fixes need a terminal">

Package installs run commands and dotfile writes land outside the project. `fix --all` without a TTY refuses the whole run (exit 2) when any fix does — run `fix` in a terminal instead. See [CLI](./cli.md).

</Callout>

---
title: Machine
description: Machine scope — packages, dotfiles, and secrets templates.
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

The manifest declares `packages.apt`, `packages.pacman`, and `packages.bun` as `{ name: version | "latest" }`. Auto-OS detection picks the system manager from `/etc/os-release`: Arch-based distros check `packages.pacman`, Ubuntu/Debian-based distros check `packages.apt` — the other system's packages are ignored, so an Arch host never flags declared apt packages as missing (and vice versa). `packages.bun` holds distro-agnostic globals and always runs alongside the system manager. On any other distro only `packages.bun` runs, plus a skipped warning: `It seems you have not defined any system packages OR your OS Distro is not supported.`

- Missing package or wrong pinned version → fixable install (`name=ver` for apt/pacman, `name@ver` for bun; apt/pacman get `--` before names). apt/pacman installs first refresh, upgrade, and autoremove (`apt-get update`, `upgrade -y`, `autoremove -y`; `pacman -Syu` plus orphan removal), then install. A dependency-installed package counts as present.
- Extra = explicitly installed, undeclared, not in `allowlist` → skipped by default. `check --strict` makes extras fixable removals (`fix --strict` removes them). A clean `check` plus a dirty `check --strict` is normal.
- `allowlist` names distro-base packages that are never reported as extras.

Each result uses `machine:<blueprint>:<manager>:<name>` (manager `apt` / `pacman` / `bun`); the unsupported-distro warning uses `machine:<blueprint>:packages:system`.

## Dotfiles

A `files[]` entry without `secrets` is a plain file: your `target` must be a regular file whose content matches the upstream.

- Missing or content drift → fixable (a regular file is backed up to `.conform.bak`, then overwritten with the upstream).
- Symlink at the target → fixable (replaced with a regular file; no backup for the link itself). Delete a stale `<target>.conform-src` sibling left by the previous symlink strategy.
- Directory or special file at the target → manual (move it aside, then re-check).
- Unreadable target or unfetchable upstream → manual.
- Extra files in `$HOME` are never drift.

Each result uses `machine:<blueprint>:file:<name>`.

## Secrets templates

A `files[]` entry with `secrets: [NAME…]` renders a template: the upstream holds `$$NAME$$` slots, filled once per run from the sops-encrypted `secrets.yaml` next to the manifest (flat `KEY: value`, keys `CAPITAL_CASING`).

- Only the listed names are substituted; everything else in `secrets.yaml` never reaches the file.
- `mode` (`0600` default | `0644`) is always enforced.
- Rendered content is always `<redacted>` in output, diffs, and `--json`.
- Missing `sops`/age key, absent secret, leftover `$$…$$` slots, or an unreadable target → manual. Follow the `hint`.
- `check --skip-secrets` never decrypts (no `sops`/age key needed): the target must exist as a regular file, each `$$NAME$$` slot matches any value (regex structure check), and `mode` must match. Mismatches are manual with no fix — re-run without the flag for the fixable diff. Useful in CI without secrets.

Each result uses `machine:<blueprint>:secrets-template:<name>`.

## When the machine cannot be read

Package listing and `sops` probes time out at 60s. Only the distro's system manager is listed (a manager whose tools are absent anyway contributes nothing instead of failing). A domain that cannot run at all yields one manual result (`machine:<blueprint>:<domain>`) instead of per-item results — read its `actual` and `hint`, fix the cause (missing tool, permissions, network), then re-check.

<Callout type="warning" title="Machine fixes need a terminal">

Package installs run commands and dotfile writes land outside the project. `fix --all` without a TTY refuses the whole run (exit 2) when any fix does — run `fix` in a terminal instead. See [CLI](./cli.md).

</Callout>

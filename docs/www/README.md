---
icon: House
---

# @adistack/conform

You describe the setup you want in `conform.json`. The CLI compares that against reality — your project files, your machine packages and dotfiles, your GitHub repo settings — and tells you what drifted. When something can be fixed automatically, `fix` applies it.

```jsonc
// conform.json
{
	"$schema": "./configuration_schema/conform.json",
	"machine": { "blueprint": "main" },
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

```bash
bunx @adistack/conform check          # exit 0 in sync, 1 drift, 2 desired-state error
bunx @adistack/conform fix --dry-run  # preview, never writes
bunx @adistack/conform fix --all      # apply all fixable items (non-TTY safe)
```

<Callout type="tip" title="New here? Read in this order">

[Quick start](./quick-start.md) gets you green in minutes. [Concepts](./concepts.md) explains what each result means. [Configuration](./configuration.md) documents every field, and [CLI](./cli.md) lists every flag.

</Callout>

<Cards>

<Card title="Quick start" href="/conform/quick-start">

Install, add `conform.json`, run your first check and fix.

</Card>

<Card title="Concepts" href="/conform/concepts">

Desired state, the three scopes, and how fixes are classified.

</Card>

<Card title="Configuration" href="/conform/configuration">

The `conform.json` reference — source, project, machine, and github sections.

</Card>

<Card title="CLI" href="/conform/cli">

Every `check` and `fix` flag, exit code, and the non-TTY story.

</Card>

</Cards>

Reference material:

- [Blueprints](./blueprints.md) — how names resolve to blueprint files.
- [Blueprint files](./blueprint-files.md) — per-file compare and fix rules.
- [Machine](./machine.md) — packages, dotfiles, and secrets templates.
- [Authoring](./authoring.md) — writing your own tech-stack repo.
- [API](./api.md) — JSON output and schemas.
- [Monorepo](./monorepo.md) — one `conform.json` per package.

<Callout type="info" title="Requirements">

You need [Bun](https://bun.sh) to run from source. Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits (falls back to `gh auth token` when unset).

</Callout>

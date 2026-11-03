# @adistack/conform

Check your project files and Nix machine against golden blueprints in a tech-stack repo. Desired state lives in `conform.json`; the CLI reports drift and fixes what it can.

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
adistack-conform check          # exit 0 in sync, 1 drift, 2 config error
adistack-conform fix --dry-run  # preview, never writes
adistack-conform fix --all      # apply all auto-fixable items (non-TTY safe)
```

Start with [quick-start](./quick-start.md). Core ideas are in [concepts](./concepts.md); the file format is in [configuration](./configuration.md) and the full flags in [cli](./cli.md).

Reference: [blueprints](./blueprints.md) (registry matching), [presets](./presets.md) (per-file rules), [authoring](./authoring.md) (writing your own tech-stack repo), [api](./api.md) (JSON output, schemas, building from source). Multi-package repos: [monorepo](./monorepo.md).

Requires [Bun](https://bun.sh) to run from source, plus `home-manager` or `nix` only for the machine scope. Set `GITHUB_TOKEN` when the tech-stack repo is private or fetches hit rate limits.

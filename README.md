# @adistack/conform

CLI that checks project files, machine state, and GitHub repo settings against tech-stack blueprints — and fixes drift.

You declare the desired state in `conform.json`. The CLI compares it against reality and reports what drifted. Fixable items can be applied with `fix`.

```jsonc
// conform.json
{
	"$schema": "./config/conform.json",
	"project": { "blueprint": "cli-app" },
	"source": { "type": "github", "repo": "AdityaBorkar/tech-stack", "ref": "main" },
}
```

```bash
adistack-conform check          # 0 in sync, 1 drift, 2 config error
adistack-conform fix --dry-run  # preview, never writes
adistack-conform fix            # interactive: space to select, enter to apply
adistack-conform fix --all      # apply all fixable items (non-TTY safe)
```

At least one of `project` / `machine` / `github` is required. Add `--project-only`, `--machine-only`, or `--github-only` to scope a run. Set `GITHUB_TOKEN` for private tech-stack repos or rate limits.

Full docs: [`docs/www/`](docs/www/README.md) — start with [quick-start](docs/www/quick-start.md), then [concepts](docs/www/concepts.md), [configuration](docs/www/configuration.md), and [CLI](docs/www/cli.md).

Requires [Bun](https://bun.sh) to run from source (`bun ./src/index.ts check`); `bun run build` produces the compiled binary in `.output/`.

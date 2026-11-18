# One desired state per run, discovered by walking up

Each run loads exactly one `conform.json`: either an explicit path, or the nearest one found by walking up from the invocation directory. Project targets resolve against the invocation directory, not the `conform.json` directory. Monorepos run once per package instead of the CLI discovering workspaces, so one package's drift never hides another package's exit code, and the CLI never has to understand any workspace tool.

Scope filters (project/machine/GitHub only) narrow a single run. Leaving a scope out of `conform.json` is the permanent version of the same filter.

## Considered Options

Workspace discovery (bun/pnpm workspaces): rejected because it couples the CLI to package managers and merges exit codes.

## Consequences

In a monorepo, `cd` into each package. The scope filters are mutually exclusive.

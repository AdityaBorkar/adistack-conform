# One desired state per run, read from the cwd only

Each run loads exactly one `conform.json`: the one passed with `--path`, or `./conform.json` in the invocation directory, with no directory walking (`src/core/config.ts`). A missing file is a desired-state error (exit 2). The loaded file is always the one at a known path. A parent package's `conform.json` in a monorepo can never load by accident. Agents and CI already run from the directory that owns the file. `validate` follows the same rule for `./registry.json`. Project targets resolve against the directory that owns `conform.json`.

Monorepos run once per package instead of the CLI discovering workspaces, so one package's drift never hides another package's exit code, and the CLI never has to understand any workspace tool.

Scope filters (project/machine/GitHub only) narrow a single run. Leaving a scope out of `conform.json` is the permanent version of the same filter.

## Considered Options

Walking up from the invocation directory to the nearest `conform.json` (the earlier behavior): rejected because which file loaded depended on where you stood, and a nested package without its own file silently ran its parent's desired state. Workspace discovery (bun/pnpm workspaces): rejected because it couples the CLI to package managers and merges exit codes.

## Consequences

Run from the directory that owns `conform.json`, or pass `--path`. In a monorepo, `cd` into each package. The scope filters are mutually exclusive.

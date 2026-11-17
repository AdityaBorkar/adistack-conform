# Exit taxonomy with explicit skipped state and machine-kind wire names

`check` exits 0 when in sync, 1 on drift, 2 on desired-state error; `fix` adds 2 for no-TTY without `--all` and for refused risky fixes, 1 for remaining drift, cancellation, or dry-run with drift; `validate` exits 0 when all valid, 1 when any invalid, 2 when nothing is configured or desired state is broken. Machine results use kind and IDs in the `machine` scope namespace, result content pointers are named `upstream`, the tech-stack host is named `provider`, and skipped results carry `ok: false` with `skipped: true` yet never cause drift exit — consumers must exclude `skipped` when computing pass, fail, and `ok`.

## Consequences

`--json` reports `{ desiredStates, ok, passed, failed, skipped, total, results }` where `failed` excludes skips and `ok` means zero non-skipped failures; human output shows skips as `○ skipped` and always lists them. Wire renames (`nix` to `machine`, `source` to `upstream`/`provider`, `apply` verbs to `fix` verbs) are breaking with no alias, recorded as pending v1-major.

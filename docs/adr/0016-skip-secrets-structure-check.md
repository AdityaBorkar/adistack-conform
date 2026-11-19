# `--skip-secrets` checks structure, never values

`check --skip-secrets` verifies machine secrets templates without decrypting: the target must exist as a regular file, each `$$NAME$$` slot matches any value (literals escaped, slots become `.*?`, anchored `^…$`), and the mode must match. `sops` is never invoked, so CI without the age key can still catch missing files and structural drift.

## Consequences

Skip-mode failures are manual with no fix (a fix would need the secret values): re-run `check` without the flag for the fixable diff. Live content stays `<redacted>` in output and JSON. The flag is check-only; `fix` always decrypts.

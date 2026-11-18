# The JSON machine manifest replaces the nix dry-run

The machine scope evaluates a JSON machine manifest (packages per manager, plus files that are either links or secrets templates) directly against the live machine, instead of shelling out to `home-manager --dry-run`. The nix path pushed every verdict through one opaque, slow flake evaluation that was untestable without a flake and could not report or fix items individually.

Machine drift is fixed by `fix`, like every other scope, through the same gate (ADR-0010). There is no separate apply command: one command fixes everything. **Extras** are skipped by default, because a working machine always holds packages no blueprint owns. A **strict** run (`--strict` on `check` and `fix`) treats them as removable drift instead. Removal is opt-in because it is destructive and the right answer depends on the machine.

## Considered Options

A separate `switch` command that applied machine drift without a prompt (rejected: it bypassed the fix gate, and two apply commands split the mental model). Always treating extras as drift (rejected: every machine fails `check` until its allowlist is exhaustive).

## Consequences

Secrets come from one decryption per run, shared by every template. Links point at a materialized copy of the upstream next to the target, so the check stays pure. Templates enforce their declared file mode after writing.

# Machine scope shells out to home-manager dry-run

The machine check resolves the flake dir from the registry and runs `home-manager switch --flake <flake> --dry-run --impure` (via `home-manager`, else `nix run home-manager`), letting nix fetch the flake into its own store, because the CLI cannot meaningfully diff a home-manager generation from files alone.

## Consequences

Dry-run exit 0 is the single `nix:<blueprint>` pass; real drift is fixable by re-running without `--dry-run`; evaluation errors (unknown attribute, missing `GIT_NAME`/`GIT_EMAIL`, build failures, missing binaries, timeouts) are manual with hints; `fix` needs a TTY unless passed `--all`, and `--dry-run` never writes.

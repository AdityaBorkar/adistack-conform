# Post-fix re-check is ID-scoped with a full-run fallback

After applying fixes, the CLI re-checks only the selected IDs (per scope: `project:`, `nix:`, `github:` via `recheckProjectSelected`/`recheckMachineSelected`/`recheckGithubSelected`) and merges the refreshed results by ID, because re-running every scope (nix dry-run, GitHub API fan-out) on each fix would be slow. If the scoped re-check throws, it falls back to a full re-check (`runAllChecks`) so the reported remainder is never stale by default.

## Consequences

`Fixed X/Y. N still failing` reflects the merged re-check; a partial scoped failure followed by a fallback may cost one full run. Unselected drift is reported from the pre-fix run, not re-fetched.

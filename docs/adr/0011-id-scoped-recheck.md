# Post-fix re-check is ID-scoped with a full-run fallback

After `fix` applies, only scopes holding a selected result are re-checked and merged back into the run. Project narrows the re-check to the selected IDs; machine (a few seconds) and GitHub (one batch of API reads) re-check whole, because narrowing them would hide a domain or auth failure. If the scoped re-check throws, a full run replaces it so the reported remainder is never stale.

## Consequences

Unselected drift is reported from the pre-fix run, not re-fetched. A selected ID missing from the re-check no longer exists (a removed extra), so it counts as resolved, but only when its scope's re-check produced no new failure. A new failure (a machine domain error, a GitHub auth skip) means the scope could not look, so the previous failure stands and is reported alongside it. Likewise a selected ID that comes back skipped (a per-check GitHub 403) could not be looked at, so the skip never replaces its previous failure.

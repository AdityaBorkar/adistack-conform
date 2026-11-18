# Post-fix re-check is ID-scoped with a full-run fallback

After `fix` applies, only the selected result IDs are re-checked and merged back into the run, because re-running every scope (live machine reads, GitHub API fan-out) after each fix is slow. If the scoped re-check throws, a full run replaces it so the reported remainder is never stale.

## Consequences

Unselected drift is reported from the pre-fix run, not re-fetched. A selected ID missing from the re-check no longer exists (a removed extra), so it counts as resolved. A scope error raised during the re-check is kept, so a failed re-check never looks like a resolution.

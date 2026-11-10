# Fix previews diffs with a --no-diff escape hatch

`fix` renders a unified diff per fixable item before prompting (`renderFixDiffs` in `src/utils/output.ts`, diff in `src/diff.ts`); `run-command` fixes print the command and `github-api` fixes print the REST steps instead of a diff. Diffs over ~200KB are skipped with a note (`MAX_DIFF_CHARS = 200_000`). `--no-diff` hides the preview for huge files or token-constrained agents; `--dry-run` implies the preview without writing.

## Consequences

Review first with `fix --dry-run`, then apply. `--no-diff` is a display-only optimization — it never changes which fixes apply.

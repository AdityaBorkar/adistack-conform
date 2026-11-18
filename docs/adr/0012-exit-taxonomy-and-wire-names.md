# Exit taxonomy, skipped results, and wire names are a public contract

Exit codes mean: 0 in sync, 1 drift (or a dry-run that found drift, or a cancelled fix), and 2 for a desired-state error or a refused or impossible fix. Scripts and agents branch on them, so the meanings are fixed.

A skipped result is neither a pass nor a failure: it never causes a drift exit. JSON consumers must exclude skips when computing pass, fail, and overall `ok`. A scope that throws becomes a single internal-error result that counts as drift, not a desired-state error, so one broken scope never hides the others.

Wire names follow `GLOSSARY.md` (`machine` not `nix`, `upstream`/`provider` not `source` on results, `fix` not `apply`). Renames are breaking and ship without aliases in a major release.

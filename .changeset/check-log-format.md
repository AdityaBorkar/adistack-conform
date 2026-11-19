"@adistack/conform": patch
---

Condense `check` human logs to title, fix, and diff

- Failing lines are now `✗ [Scope] Section: Name (/target with file link) [fixable|manual]`, followed by `fix: <fix> — <hint>` and a unified `diff:` instead of the old `target:/expected:/actual:` block
- Passing verbose lines and skips use the same `[Scope] Name (target)` heading; package and repo checks omit the target parens when there is no path
- Absolute paths carry an OSC8 file link so Ctrl+Click opens them; `--json` output is unchanged

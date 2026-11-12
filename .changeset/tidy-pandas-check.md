---
"@adistack/conform": minor
---

Drop unused project features and simplify `target` and `compare`

BREAKING: the following project options are removed.

- Removed `js` toolchain dependencies
- Removed `compare.strip` and `compare.versioned`
- Removed `docs:`, `~/`, and `%VAR%` targets, plus empty-upstream defaults
- `target` is always a cwd-relative path
- `compare` supports `ignore[]` only

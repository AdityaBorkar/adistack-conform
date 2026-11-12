---
"@adistack/conform": minor
---

Drop `compare.required` in favour of automatic template detection

- Any upstream containing `<...>` placeholders is now a template — no `required` flag needed
- Placeholder slots accept any per-project value that is non-empty, contains no placeholders, and matches the surrounding text
- Every other field must exactly match the upstream
- Manifests are strict: unknown `required`, `pinned`, and `directories` keys are rejected instead of ignored

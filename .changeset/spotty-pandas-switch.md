---
"@adistack/conform": minor
---

Drop `compare.required`: any golden holding `<...>` placeholders is now a template on its own. Placeholder slots accept any per-project value (non-empty, no placeholders, matching the surrounding text) while every other field must match the golden. Manifests are strict: unknown `required`/`pinned`/`directories` keys are rejected instead of ignored.

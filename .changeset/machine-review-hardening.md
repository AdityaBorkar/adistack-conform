---
"@adistack/conform": patch
---

Tighten machine validation and registry lookup

- `validate` also asserts the manifest-adjacent `secrets.yaml` exists on disk when any file declares `secrets`
- Registry lookup is exact key plus repo-relative path only; basename-only matching no longer silently resolves typos to the wrong blueprint

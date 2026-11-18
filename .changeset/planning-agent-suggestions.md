---
"@adistack/conform": minor
---

Nest `agentSuggestions` under a `planning` object in GitHub settings

- `planning: { agentSuggestions: "full-control" | "disabled" }` replaces the top-level `agentSuggestions` key
- Update blueprints: move the key and reship; the old top-level key is rejected

---
"@adistack/conform": patch
---

`check` warns on stderr when the github scope runs without `GITHUB_TOKEN`, since those checks are skipped. When `GITHUB_TOKEN` is unset, the GitHub token now falls back to `gh auth token`.

---
"@adistack/conform": minor
---

Add `webhooks` management to the GitHub scope

- New `github:<blueprint>:webhooks` check: declared webhooks (matched by payload URL) enforce `events[]`, `active`, and `contentType`; undeclared hooks are ignored
- Missing hooks are fixable via `POST /hooks`, drifted hooks via `PATCH /hooks/{id}` (admin token, TTY only)
- Empty `webhooks: []` passes; webhook secrets stay manual (the API never returns secret values)

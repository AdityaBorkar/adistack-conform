"@adistack/conform": minor
---

Add `check --skip-secrets` for machine secrets templates

- Secrets templates check existence, mode, and structure only: each `$$NAME$$` slot matches any value via regex, never decrypting `secrets.yaml` (no `sops`/age key needed)
- Mismatches are manual with no fix; re-run without the flag for the fixable diff

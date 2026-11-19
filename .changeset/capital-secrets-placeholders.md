"@adistack/conform": minor
---

Machine secrets use `$$CAPITAL_CASING$$` slots

- Secrets templates render `$$NAME$$` placeholders (`CAPITAL_CASING`, `^[A-Z][A-Z0-9_]*$`) instead of `@@name@@`
- `secrets` lists and `secrets.yaml` keys enforce the same alphabet; lowercase, dotted, or dashed keys fail validation/decrypt
- Secret values with `$` sequences render literally

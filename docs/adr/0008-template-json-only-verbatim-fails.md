# Template detection is JSON-object goldens only, and verbatim copies fail

A golden is a template only when it parses as a JSON object (JSONC-tolerant) and holds `<...>` placeholder slots (`goldenHasPlaceholders` in `src/stack/check.ts`): each slot accepts any non-empty per-project value matching the surrounding text while every other field must match exactly. Placeholders in non-JSON goldens (HTML comments, TS generics) never count. Templates never pass on byte equality — a verbatim copy still holds placeholders, so it fails manual until every slot is replaced.

## Consequences

Template failures are manual with the mismatched paths listed; extra local fields are allowed and placeholder keys fuzzy-match per-project names. Non-object or unparsable goldens fall back to byte compare (or manual when templated but uncomparable).

# Template detection is JSON-object upstreams only, and verbatim copies fail

An upstream is a template only when it parses as a JSON object (JSONC-tolerant) and holds `<...>` placeholder slots (`upstreamHasPlaceholders` in `src/stack/check.ts`): each slot accepts any non-empty per-project value matching the surrounding text while every other field must match exactly. Placeholders in non-JSON upstreams (HTML comments, TS generics) never count. Templates never pass on byte equality — a verbatim copy still holds placeholders, so it fails manual until every slot is replaced.

## Consequences

Template failures are manual with the mismatched paths listed; extra local fields are allowed and placeholder keys fuzzy-match per-project names. Non-object or unparsable upstreams fall back to byte compare (or manual when templated but uncomparable).

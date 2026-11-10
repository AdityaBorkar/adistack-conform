# JSONC-tolerant compare with indent-preserving fix

Project file compare parses JSONC (comments and trailing commas allowed) and `fix` serializes back preserving the local indent style (`stripJsonc`/`serializeJson`/`overlayResult` in `src/stack/check.ts`), because blueprints ship canonical JSON while repos carry comments. Non-object or unparsable goldens fall back to byte compare (or manual when templated but uncomparable).

## Consequences

Comment-only diffs do not drift; `fix` keeps local formatting instead of reformatting the file. Template detection still requires a JSON-object golden — placeholders elsewhere never count.

# Project compare semantics live in the manifest and the upstream

The CLI holds no per-file or per-tool knowledge. How a project file is compared comes only from its manifest entry (`compare.ignore[]` keys excluded from the compare and preserved by fix) and from the upstream content itself (`src/core/project/`). New blueprints change enforcement without a CLI release.

- **JSONC-tolerant.** JSON upstreams compare semantically (comments and trailing commas ignored), and fix writes back in the local indent style. Blueprints ship canonical JSON while repos carry comments.
- **Templates are detected by content.** An upstream that parses as JSON (object or array) and holds `<...>` placeholders is a template: each slot accepts any non-empty per-project value, and every other field must match. Placeholders in non-JSON upstreams (HTML comments, TS generics) never count. That is why detection is tied to JSON and is not a manifest flag.
- **Verbatim template copies fail.** A copy that still holds placeholders has not been adapted. A missing or unadapted template is manual, never fixable, because the CLI cannot invent per-project values.

## Considered Options

A per-file compare table in code (rejected: every new tool needs a CLI release). A `template: true` manifest flag (rejected: it can disagree with the content).

## Consequences

Non-JSON or unparsable upstreams fall back to byte compare. Plain (non-template) drift is a fixable overwrite.

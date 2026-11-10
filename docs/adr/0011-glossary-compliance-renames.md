# Glossary-compliance renames are breaking (v1 major)

Kind `preset` → `project`, `partitionResults.unfixable` / `reportUnfixable` → `manual` / `reportManual`, `--config` → `--desired-state`, `checkPresetFileWithGolden` → `checkProjectFileWithGolden`, `GithubPreset` / `fetchGithubPreset` → `GithubSettings` / `fetchGithubSettings`, and all user strings (`preset file` → `blueprint file`, `preset template` → `template`, content matches → `golden`) were renamed at once to comply with `GLOSSARY.md` Avoid rules, because the glossary is the shared language and the code was teaching three synonyms for every term.

## Consequences

Breaking: `--json` `kind` values and the `configs` → `desiredStates` summary field change; `--config` is removed (no alias); `conform.json` filename is kept (product name, not the `config` word). Requires a major version bump and migration notes (`--desired-state` replaces `--config`; `kind: preset` consumers match `kind: project`). Chosen over documenting synonyms because silently supporting both vocabularies doubles every future doc and error string. Status: bump still pending — version is `0.1.0` (`VERSION` in `src/index.ts`, `package.json`). Docs page `presets.md` renamed to `blueprint-files.md` to finish the rename.

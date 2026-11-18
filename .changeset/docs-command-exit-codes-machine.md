---
"@adistack/conform": patch
---

Fix command naming, exit-code docs, and missing machine page

- Examples use `bunx @adistack/conform` (the published command), not `adistack-conform`; CLI help names the command `@adistack/conform`
- Document the exit contract explicitly: a `registry.json` that cannot be fetched is exit 2, an invalid registry is exit 1 (exit 2 only when no registry file exists), and non-TTY `fix --all` refuses the whole run when even one fix runs a command, calls the GitHub API, or writes outside the project
- Add the missing `machine` user page (packages, dotfile links, secrets templates) and link it from blueprints, concepts, and configuration
- `api.md` no longer references the non-existent `gen:json-schema` script and drops the build/conventions section (lives in `AGENTS.md`); fix the stray `</Accordion>` in `blueprint-files.md`

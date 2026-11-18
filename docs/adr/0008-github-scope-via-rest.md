# The GitHub scope checks live repo settings via REST and fixes via API calls

Repo settings have no file on disk to diff, so the `github` scope reads live settings through the GitHub REST API, compares them against the blueprint's settings file, and fixes drift with API calls instead of file overwrites (`src/core/github/`). Public repos work unauthenticated until auth or rate limits stop them, and the scope then skips. Private repos need `GITHUB_TOKEN`, and fixes need admin rights.

## Consequences

Settings with no public API (social preview, some Copilot and OIDC toggles) are skipped with a UI hint, never guessed. API fixes count as risky under ADR-0010.

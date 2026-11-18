---
"@adistack/conform": minor
---

Close fix-flow security holes and tighten secrets templates

- **Security:** a file fix refuses a symlinked target before taking its backup, so a planted link (e.g. `AGENTS.md -> ~/.ssh/id_ed25519`) can no longer copy its target into the workspace
- **Security:** non-TTY `fix --all` judges "inside the project" by real path, so a symlinked parent directory cannot carry a write outside the project; link fixes outside the project are refused like file writes
- **Security, breaking:** a secrets template substitutes only the secrets listed in its `secrets`, and its `mode` defaults to `0600` (enforced by `check`, applied by `fix`); secrets fixes keep one `.conform.bak` instead of piling up decrypted copies
- **Security, breaking:** machine package and allowlist names must match `[A-Za-z0-9@_+][A-Za-z0-9@._+/-]*`; pacman fixes pass `--` before names
- After `fix`, a GitHub auth skip or machine domain error on the re-check no longer reads as "fixed": the previous failure stands
- A link whose target is a directory is manual (the fix could never replace it); link fixes write the exact bytes the check compared and swap the link atomically instead of running `ln -sfn`
- `secrets.yaml` keys may contain `.` and `-` (e.g. `npm-token`)
- `pacman -Q`, `bun pm -g ls` and `sops --decrypt` time out after 60s instead of hanging `check`
- **Breaking:** secrets-template IDs are `machine:<blueprint>:secrets-template:<name>` (was `…:template:…`), matching the glossary
- The PR preview comment finds its previous comment on PRs with over 100 comments

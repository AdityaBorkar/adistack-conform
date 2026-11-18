---
"@adistack/conform": minor
---

Remove nix remnants and the `machine.configuration` shim

- `machine.configuration` is removed from `conform.json` (was accepted but ignored since the JSON manifest pipeline replaced the nix dry-run); configs still setting it now fail schema validation
- Docs no longer mention `home-manager`/`nix`/`flake`/`homeConfigurations`: machine scope is manifest (`machines/<name>.json`) packages plus `files[]`, checked against installed packages and `$HOME`

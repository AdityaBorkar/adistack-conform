---
"@adistack/conform": minor
---

Point machine registry entries at manifest files

BREAKING: `registry.json` machine entries must point at blueprint files.

- Machine entries are plain `key/path` pairs like projects (e.g. `"main": "./machines/main.json"`); the `{ name, path }` directory form is rejected
- The CLI fetches the manifest file directly instead of resolving `<dir>/machine.json`; display-name matching is gone (the name lives in the manifest `@name`)

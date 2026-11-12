---
"@adistack/conform": minor
---

Drop the directory blueprint layout

BREAKING: `registry.json` project entries must point at blueprint files.

- Point project entries at blueprint files (e.g. `./projects/cli-app.json`)
- Keep `source` paths repo-relative
- `./` and `../` sources are rejected, as is `<dir>/project-manifest.json` resolution

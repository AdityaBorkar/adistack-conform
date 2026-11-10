---
"@adistack/conform": minor
---

feat!: drop the directory blueprint layout; `registry.json` project entries must point at blueprint files (e.g. `./projects/cli-app.json`) with repo-relative `source` paths, `./`/`../` sources and `<dir>/project-manifest.json` resolution are rejected

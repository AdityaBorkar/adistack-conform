"@adistack/conform": minor
---

Support `apt` as a machine package manager

- Machine manifests accept `packages.apt` and `allowlist.apt` (`{ name: version | "latest" }`)
- `check` lists via `apt-mark showmanual` + `dpkg-query -W`; `fix` installs with `sudo apt-get install -y -- <name>[=<version>]` and removes with `sudo apt-get remove -y -- <name>`

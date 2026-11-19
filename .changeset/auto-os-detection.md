"@adistack/conform": minor
---

Auto-detect the OS for machine system packages from `/etc/os-release`

- Arch-based distros check `packages.pacman`, Ubuntu/Debian-based distros check `packages.apt`; the other system's packages are ignored instead of reported missing
- `packages.bun` globals always run alongside the active system manager
- Unsupported distros check `packages.bun` only plus a skipped `machine:<blueprint>:packages:system` warning

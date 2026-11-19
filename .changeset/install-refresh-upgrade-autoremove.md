"@adistack/conform": minor
---

Refresh, upgrade, and autoremove before apt/pacman installs

- `run-command` fixes gain optional `preCommands[]` setup steps (run in order before the main command; shown in prompts, previews, and `--json`)
- apt installs now run `apt-get update`, `apt-get upgrade -y`, and `apt-get autoremove -y` first; pacman installs run `pacman -Syu --noconfirm` plus orphan removal first

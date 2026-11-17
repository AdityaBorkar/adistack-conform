# Machine manifest replaces nix dry-run

`conform check --machine-only` and `switch` evaluate the JSON machine manifest
(`machines/<name>.json`, Zod source of truth
`src/schemas/machine-manifest.ts`) against live reality (`pacman -Qqe` +
`pacman -Q`, `bun pm -g ls`, `readlink`/bytes, rendered templates)
instead of shelling out to `home-manager --dry-run`, because the nix eval path
forced every machine verdict through one opaque flake switch that was slow,
untestable without a flake, and unable to report per-item fixes. Packages are
versioned maps (`packages.pacman` / `packages.bun`, `name: version|"latest"`).

## Consequences

Two modes share one reality: `conform` (`check`: extras skipped) and
`drift` (`switch`: extras failFixable with remove); links and templates
coincide in both modes. One `sops decrypt` per run feeds all
templates; link upstreams materialize at `<target>.conform-src` before
`ln -sfn`; template overwrites back up to `.conform.bak[.N]` and `chmod` to
the declared mode after writing. `validate` fetches the manifest and asserts
every `files[]` source is fetchable. Machine IDs are per-item
(`machine:<blueprint>:<section>:<name>`); `recheckSelected` matches the
`machine:<blueprint>:` prefix.

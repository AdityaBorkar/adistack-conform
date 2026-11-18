---
"@adistack/conform": patch
---

Harden the machine pipeline internals (no CLI flag changes)

- Machine live-system access (`stat`, secrets decrypt, default reality) moves to `src/stack/machine-live.ts`; `machine.ts` keeps orchestration only, with one `runMachine(state, registry, mode)` entry point instead of near-duplicate conform/drift runners
- `fix` and `switch` share one `applyMachineFixes` ritual (materialize link upstreams, apply fixes, enforce template modes) so template modes cannot be skipped by a caller
- Link-fix parsing lives in one place (`isLinkFix`/`parseLinkFix`) instead of positional `args[1]`/`args[2]` reads in two modules
- `validate` also asserts the manifest-adjacent `secrets.yaml` is fetchable when any file declares `secrets`
- Registry lookup is exact key plus repo-relative path only; basename-only matching no longer silently resolves typos to the wrong blueprint

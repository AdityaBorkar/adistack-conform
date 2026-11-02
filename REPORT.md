# Machine placeholders + encrypted R2 vault

> Status (Nov 2026): `git`, `gh/config.yml`, `shell/bashrc+profile`,
> `ssh/config`, `aws/config`, `docker/config.json`, `htop/htoprc`,
> `systemd/*`, `shell/bash_logout`, `ssh/known_hosts`,
> `vscode`/`zed` settings, and `opencode` content files have since been
> migrated into `tech-stack/machine/blueprints/*/nix/home.nix` (inline
> `home.file` text, `programs.*`, `systemd.user.services`) and removed from
> `machine/presets/*`. Sections 1 and 8 below describe the pre-migration
> state; the R2 vault design (sections 3-5) still applies to the remaining
> secret `.example` files.

Scope: `tech-stack` machine presets only. Project presets stay deterministic and
never prompt. This report proposes a `@clack/prompts` input flow and a
client-side-encrypted Cloudflare R2 vault, and compares it with well-known
alternatives.

## 1. Current state (verified)

- `adistack-conform` already depends on `@clack/prompts@1.8.1`
  (`package.json:70`) and uses it for fix selection (`src/fix.ts:10`) and
  cancel outro (`src/index.ts:150`).
- Secret files use the `.example` convention: `checkPresetFile`
  (`src/techstack-check.ts:98`) treats any `presetRelPath` ending in
  `.example` as existence-only via `checkExampleOutcome`
  (`src/techstack-check.ts:54`): never compares values, never auto-fixes
  content. Hint is `Copy <preset> to <target> and fill in secret values
  (never commit).`
- Machine manifest (`tech-stack/machine/presets/manifest.json`) declares seven
  `.example` sources:
  `aws/credentials.example`, `eas/user-settings.json.example`,
  `gh/hosts.yml.example`, `npm/npmrc.example`,
  `opencode/opencode.json.example`, `psql/pg_service.conf.example`,
  `wakatime/wakatime.cfg.example`.
- Only two of those paths exist on disk:
  `machine/presets/opencode/opencode.json.example`,
  `machine/presets/wakatime/wakatime.cfg.example`.
  The other five exist only in the non-`.example` form (`aws/credentials`,
  `eas/user-settings.json`, `gh/hosts.yml`, `npm/npmrc`,
  `psql/pg_service.conf`). With `--no-cache` (sparse fetch,
  `src/techstack-sparse.ts:238`) or cached-disk checks, a missing golden makes
  the check fail as `<preset file missing>`. Fix the manifest or add the
  missing `.example` files before building on top of it.
- Placeholder styles actually in the repo (from `grep -RIn REDACTED`):
  - Bare `REDACTED`: `aws/credentials`, `npm/npmrc`,
    `eas/user-settings.json`, `opencode.json.example` (`ctx7sk_REDACTED`).
  - `REDACTED_RUN_<cmd>`: `wakatime.cfg.example`
    (`api_key = REDACTED_RUN_wakatime_login`), `gh/hosts.yml`
    (`oauth_token: REDACTED_RUN_gh_auth_login`).
  - `YOUR_*`: `gh/hosts.yml` (`YOUR_GITHUB_USER` twice).
- `gh/hosts.yml` mixes both styles in one file, which is why a single
  whole-file rule is insufficient once you want partial rendering.

## 2. Constraint: machine-only prompting

- Machine targets resolve against `$HOME` (`src/utils/fs.ts`,
  `resolveTargetPath`); project targets resolve against `cwd`. Secrets belong
  to the former.
- Rule: placeholder expansion runs only when `scope === "machine"`
  (`src/techstack.ts:64`, `src/techstack-check.ts:11`). Project scope keeps
  byte-exact comparison; a `{{ ... }}` token in a project golden is a manifest
  error, never a prompt.
- `check` never prints secret values (including `--json`). `fix --dry-run`
  renders `***` for secret fields.

## 3. Placeholder model

Three viable grammars, in increasing power:

1. Whole-file `.example` (status quo). No templating; user copies and fills
   manually. Cheapest, but no per-field prompts, no vault round-trip, and
   mixed files like `gh/hosts.yml` cannot distinguish public from secret
   fields.
2. Inline tokens in `.example` templates (recommended). Canonical form:
   `{{ secrets.NAME }}`. Keep backward-compatible detectors for legacy
   `REDACTED`, `REDACTED_RUN_<cmd>`, `YOUR_*` during `scan`, but normalize new
   templates to the one form. Example:
   `api_key = {{ secrets.WAKATIME_API_KEY }}`.
3. Manifest-declared `vars` per file (schema change to
   `src/schemas/common.ts:makePresetManifestSchema`). Explicit but duplicates
   what the template already says; only worth it if you need types,
   enums, or `RUN:` provisioners per field.

Recommended: option 2. The `.example` file stays the template, the target
file is the rendered output, and `check` for a rendered file compares the
rendered golden (not the raw template).

Optional `RUN:` escape hatch for the existing `REDACTED_RUN_*` convention:
`{{ run:gh auth login }}` means "obtain by running this command, do not store
in vault". Keep the set tiny (`gh`, `wakatime` login); everything else goes
through the vault.

## 4. CLI with `@clack/prompts` (machine `fix` only)

Proposed flow inside `runFixCommand` (`src/index.ts:111`), after the existing
file multiselect (`src/fix.ts:10`):

1. Scan selected machine `.example` targets for `{{ secrets.NAME }}` keys.
2. Load vault cache (section 5). Prefill any known key; prompt only for the
   missing ones.
3. One prompt group per key, using the already-imported `@clack/prompts`:
   - secrets: `password()` (masked, no echo).
   - non-secret identity (username, region): `text()` with `validate`.
   - closed sets (AWS region): `select()`.
   - multi-line (PG service blocks): `text()` multiline or external
     `$EDITOR`.
   - Group with `group()` so cancel aborts the whole fix; `isCancel()` maps
     to the existing `cancelled` outcome (`src/fix.ts:28`).
4. Render templates in memory, write via existing `applyFix`
   (`src/checks.ts:75`), then offer `vault push` (confirm prompt, default no
   on first run).
5. Non-TTY (`--all`, CI): if any key is missing from vault/env, fail with
   exit 2 and list key names only, never values. `--dry-run` + `--no-diff`
   shows which keys would be requested.

Env override convention for CI: `ADISTACK_SECRET_<NAME>` (e.g.
`ADISTACK_SECRET_WAKATIME_API_KEY`). Env beats prompt, vault beats nothing;
explicit flag beats env only if you add `--no-env`.

Validation per key lives next to the preset (length/regex), not in the CLI
core, so adding `npmrc` token rules does not touch prompting code.

## 5. Encrypted R2 vault for later use

R2 is the transport, not the encryptor. R2 encrypts at rest by default but
has no S3-style SSE-C/KMS customer-key story to rely on, so assume the
operator can read the bytes and do client-side (zero-knowledge) encryption
before upload.

### 5.1 Layout

- One opaque blob per host: `vault/<hostname>-<user>.json.age`.
  Content is a JSON map `{ "WAKATIME_API_KEY": "...", ... }` plus `updatedAt`.
  One blob (not one object per secret) keeps list/pull atomic and avoids key
  enumeration.
- Bucket stays private, no public access, versioning on. Lifecycle expiry is
  optional; rotation is `pull -> edit -> push`.
- Local cache `~/.cache/adistack-conform/vault/<same-name>` (respects
  `XDG_CACHE_HOME` like the existing tech-stack cache in
  `src/techstack-cache.ts`) enables offline `fix`; stale cache warns the same
  way `CachedRepo.stale` does.

### 5.2 Crypto choices

| Option                                                       | How                                                                                                                      | When to use                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `age` file encryption (FiloSottile age)                      | random data key per push, wrapped by password-derived KEK (scrypt/Argon2id) or age recipient; XChaCha20-Poly1305 payload | Recommended v1. Simple, nonce-misuse resistant, well-known for file secrets.                                             |
| Mozilla SOPS + age                                           | YAML/JSON with per-value `sops` envelope, age identity as master key                                                     | Use if secrets must live in git next to presets. Overkill for an opaque R2 blob.                                         |
| AES-256-GCM via `node:crypto`/WebCrypto, PBKDF2/Argon2id KDF | stdlib, no dep                                                                                                           | Acceptable if adding an `age` dep is rejected; must get salt/nonce/AAD handling right, so prefer a reviewed age library. |
| libsodium sealed box (per-machine keypair)                   | public-key sharing without shared password                                                                               | Use when one host provisions secrets for another without sharing a password.                                             |

Do not store R2 credentials in the vault (bootstrap loop). R2 auth is env-only:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
(and optional `R2_ENDPOINT` override). Access the bucket through its
S3-compatible endpoint with `@aws-sdk/client-s3` (`GetObject`/`PutObject`);
`wrangler` is the manual-debug alternative.

### 5.3 Key management

- Password-derived (v1): `ADISTACK_VAULT_PASSWORD` or `@clack/prompts`
  `password()`; KDF Argon2id (or scrypt where Argon2 is unavailable); random
  salt stored alongside the blob header. Nothing extra to back up.
- Device key (`~/.config/adistack/vault.key`, `0600`): non-interactive, but a
  lost key means a lost vault unless backed up.
- Hybrid envelope: device key wrapped by password. Best UX long-term, most
  code now.

Recommend password-derived for v1, migrate to hybrid only if non-interactive
hosts need it.

### 5.4 Commands (minimal set)

- `adistack-conform vault push [--force]`: encrypt local secret map, upload.
- `adistack-conform vault pull`: download, decrypt, refresh local cache only
  (never print values).
- `adistack-conform vault status`: bucket/key reachable, blob age, which keys
  are missing for the selected blueprint. Safe to log.
- `fix` integrates as: missing key -> vault lookup -> prompt -> optional push.

## 6. How this compares with well-known approaches

- **SOPS + age/PGP (most used for git-committed secrets).** Best when the
  secret file itself is versioned. R2+age wins here because machine targets
  must never be committed and the blob is per-host, not per-repo.
- **1Password / Bitwarden / Doppler / Infisical / HashiCorp Vault.**
  Stronger sharing/audit/rotation than a static R2 blob. Use one if the team
  already pays for it; the `{{ secrets.NAME }}` renderer only needs a new
  fetcher. R2 wins on cost and on "no new service" when Cloudflare is already
  the platform.
- **`pass` / `git-crypt`.** Fine for single-user GPG workflows, poor for
  per-host machine setup and for Bun-native automation.
- **Plain `.example` + manual copy (status quo).** Zero code, but no reuse,
  no rotation story, and `check` cannot distinguish "absent secret" from
  "drift".
- **Env-only (`.env` + direnv).** Good for project services, wrong layer for
  `$HOME`-scoped machine files managed by conform.

## 7. Recommended v1

1. Fix the five missing `.example` goldens (or correct the manifest paths).
2. Normalize templates to `{{ secrets.NAME }}`; keep legacy
   `REDACTED*`/`YOUR_*` as scan-time aliases.
3. Gate rendering to machine scope; project scope errors on tokens.
4. Implement prompt-then-render in `fix` with `@clack/prompts`
   `password`/`text`/`select`/`confirm`, redacted diffs, strict non-TTY
   failure.
5. Implement `vault push|pull|status` over R2 S3 API with age-encrypted
   single-blob layout and password-derived KEK; env-held R2 credentials.
6. Document key names per preset (`WAKATIME_API_KEY`, `GH_OAUTH_TOKEN`,
   `NPM_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `EAS_ANALYTICS_ID`, `CONTEXT7_API_KEY`) so prompts are stable across hosts.

## 8. Nix-native alternative (no separate goldens, no placeholder pass)

Yes. The repo already started this migration: `home.nix` owns `programs.git`
(`home.nix:110`), `programs.gh.settings` (`home.nix:133`),
`programs.bash` (`home.nix:78`), `programs.ssh` (`home.nix:147`), and
`home.file` symlinks for safe configs (`home.nix:164-177`), while
`nixos-configuration.nix:136` owns `/etc` via `environment.etc` and both
files explicitly keep secrets out (`home.nix:159-161`,
`nixos-configuration.nix:143-146`). The full step is to finish that split:
non-secret config becomes Nix expressions, secret config becomes
`sops-nix`/`agenix` templates rendered at activation. Then
`machine/presets/*` goldens and the `{{ secrets.NAME }}` renderer from
sections 3-4 are unnecessary on Nix-managed hosts.

### 8.1 How it replaces files + placeholders

- Declarative configs inline: `programs.*`, `home.file.<path>.text`,
  `xdg.configFile.<path>.text`, `systemd.user.services.*`,
  `environment.etc.<path>.text`. No `presets/<tool>/config` file to copy and
  diff; `home-manager switch` generates the target into `/nix/store` and links
  it into `$HOME`.
- Secrets via templates, not placeholders: the well-known pair is
  `sops-nix` (Mic92, most used with home-manager) and `agenix` (simpler,
  one-secret-per-file). Both commit only age-encrypted payloads and decrypt at
  activation. A `sops.templates."wakatime.cfg"` (or agenix `age.secrets`)
  renders `api_key = <decrypted>` with `0600`, so there is no `REDACTED` token
  to prompt for in `fix`. Login-style secrets stay as commands
  (`gh auth login`), matching the existing manual post-steps
  (`home.nix:179-186`).
- Mapping for this repo: `git`, `gh/config.yml`, `shell`, `ssh/config`,
  `htop`, `docker/config.json`, `aws/config`, `systemd` units,
  `vscode`/`zed` settings all collapse into `home.nix` options;
  `aws/credentials`, `gh/hosts.yml`, `npmrc`, `wakatime.cfg`,
  `eas/user-settings.json`, `opencode.json`, `pg_service.conf` become
  sops/agenix secrets. `programs.gh` already documents the split
  (`home.nix:136`): public settings in Nix, `hosts.yml` via login.

### 8.2 What Nix does not remove

- A secret source still exists; Nix only moves decryption from `fix`-time
  prompts/R2 pull to activation-time age decryption. The age identity
  bootstrap (who holds the private key) is the same problem as the R2 vault
  password in section 5.3.
- Non-nixpkgs tools stay imperative: `home.nix:73-75` notes EAS/Expo,
  agent-browser, context7-mcp, githits, expect-cli have no nixpkgs equivalent,
  plus the manual `gh/aws/pulumi/eas/opencode` re-auth and `ssh` key copy.
- Never interpolate a secret into `home.file.*.text`: that lands world-readable
  in `/nix/store`. Use sops templates / agenix secret paths with strict modes.
- Two paths remain: NixOS/Ubuntu-WSL differences (`nixos-configuration.nix:133-134`
  Path A vs Path B) and non-Nix hosts still need `presets/*` as fallback. Keep
  `presets/*` as reference backups for those hosts and mark Nix-owned targets
  as `docs:`/skip in the manifest, or change conform on Nix hosts to assert
  `home-manager switch --dry-run` is clean instead of file-diffing.

### 8.3 Recommendation

- Nix-managed hosts: prefer `sops-nix` + age (best home-manager integration,
  per-field templates, single encrypted `secrets.yaml`), `agenix` if you want
  fewer moving parts. R2 then holds at most an age-key backup, not the vault.
- Non-Nix / mixed hosts: keep sections 3-5 (`@clack/prompts` + R2 age blob).
  The two approaches share the key-name list in section 7, so a host can move
  from R2-pull to `sops` without renaming secrets.

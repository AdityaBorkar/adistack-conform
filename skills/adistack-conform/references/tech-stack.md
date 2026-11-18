# Authoring a tech-stack repo

A tech-stack repo is the **pin** target: data only (no build, no CI needed). Consumers fetch it raw from `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` every run, so whatever is at `ref` is live on the next `check`.

## Layout

```text
registry.json                     # entrypoint; strict JSON
projects/<name>.json              # project manifest
projects/files/<group>/<file>     # project payloads (upstreams); may be JSONC/TOML/etc.
machines/<name>.json              # machine manifest
machines/files/<path>             # dotfile payloads, secrets-template sources
machines/secrets.yaml             # sops-encrypted, adjacent to the machine manifest (only if any file has `secrets`)
github-configs/<name>.json        # github settings manifest
```

Registry and manifests are strict JSON (check: `python3 -m json.tool f`). Payloads are tool-consumed — never "normalize" them.

`$schema` for editor completion: `node_modules/@adistack/conform/config/<registry|project-manifest|machine-manifest|github-manifest>.json` (add `@adistack/conform` as a devDependency), or `https://stack.adityab.tech/conform/<VERSION>/schemas/<name>.json`.

## `registry.json`

```json
{
	"projects": { "cli-app": "./projects/cli-app.json" },
	"machines": { "main": "./machines/main.json" },
	"github_configs": { "npm-package": "./github-configs/npm-package.json" }
}
```

- All three maps required (may be `{}`). Strict: no other keys except `$schema`.
- Key = blueprint name consumers write in `conform.json`. Non-empty.
- Value = repo-relative path to the manifest **file** (never a dir); no empty, `.`, `..` segments, no `\`.

## Project manifest

```json
{
	"@name": "CLI",
	"@description": "CLI Application using Commander",
	"files": [
		{ "name": "Bun Config", "source": "projects/files/bunfig/base.toml", "target": "bunfig.toml" },
		{
			"name": "Oxlint Config",
			"source": "projects/files/oxlint/base.json",
			"target": ".oxlintrc.json",
			"compare": { "ignore": ["overrides"] }
		},
		{ "name": "Package", "source": "projects/files/package/cli.json", "target": "package.json" }
	],
	"file_structure": [
		{ "name": "Source Dir", "kind": "dir", "target": "src/" },
		{ "name": "AGENTS.md", "kind": "file", "target": "AGENTS.md" }
	]
}
```

- `files[]`: `name` (becomes result id `project:<bp>:<name>`), `source` (repo-relative, no leading `/`, `./`, `../`, dot/empty segments, `\`), `target` (relative to consumer's `conform.json` dir; `~` → `$HOME`; absolute passes through), optional `compare.ignore[]` (top-level keys the consumer owns).
- `file_structure[]`: existence-only, `kind: file|dir`. For per-project content you cannot ship (README, AGENTS.md, `src/`).
- `name` unique across both lists. At least one entry total.
- Pick the form per file:

| Want                                                                      | Use                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Identical everywhere                                                      | plain upstream (byte compare, fixable)                                                  |
| Identical except consumer-owned top-level keys                            | JSON upstream + `compare.ignore`                                                        |
| Fixed shape with per-project values (`package.json` name, wrangler route) | JSON template with `<...>` slots, e.g. `"name": "<package-name>"` (manual until filled) |
| Must exist, content free                                                  | `file_structure[]`                                                                      |

Template slots only work in JSON/JSONC object or array upstreams. A `<...>` inside TS/HTML/TOML is literal text, byte-compared.

## Machine manifest

```json
{
	"@name": "Primary Developer Machine",
	"packages": {
		"pacman": { "git": "latest", "neovim": "0.11.0-1" },
		"bun": { "@biomejs/biome": "latest" }
	},
	"allowlist": { "pacman": ["base", "base-devel", "linux", "linux-firmware", "sudo"] },
	"files": [
		{ "name": "GitConfig", "source": "machines/files/git/config", "target": "~/.gitconfig" },
		{
			"name": "Npmrc",
			"source": "machines/files/npmrc",
			"target": "~/.npmrc",
			"secrets": ["npm_auth_token"],
			"mode": "0600"
		}
	]
}
```

- Managers: `pacman`, `bun` (global). Value `"latest"` or exact version (no whitespace). Package names `^[A-Za-z0-9@_+][\w@.+/-]*$`.
- `allowlist`: distro-base names never reported as extras.
- `files[]` without `secrets` → link (consumer `target` symlinks to materialized upstream). With `secrets` → secrets template: source holds `@@npm_auth_token@@`; `secrets.yaml` (sops-encrypted, flat `KEY: value`, keys `[A-Za-z_][\w.-]*`) sits in the manifest's directory. `mode` (`0600` | `0644`) allowed only with `secrets`. Never commit plaintext values.
- Names unique; at least one package or file.

## GitHub settings manifest

All fields optional with defaults (strict object). Keys: `defaultBranch`, `features{issues,issueTemplates,discussions,projects,wiki}`, `merge{mergeCommit,squashMerge,rebaseMerge,autoMerge,deleteHeadBranches,mergeTitle,mergeMessage,squashTitle,squashMessage}`, `reviews{requiredApprovals,dismissStale,requireCodeOwner,requireConversationResolution,requireSignedCommits,restrictPushes}`, `checks[]` (required status contexts on default branch), `codeowners` (path), `environments[]` (fix creates), `rulesets[]` (names; manual), `secrets[]`/`variables[]` (presence only), `actions{allowed,defaultWorkflowPermissions,allowApprovePRs,approvalForExternal,retentionDays,shaPinningRequired,oidcImmutableSubject}`, `security{dependabot,dependencyGraph,dependencyAutoSubmit,privateVulnerabilityReporting,pushProtection,secretProtection,copilotAutofix}`, `releasesImmutable`, `signoffRequired`. Check-only (no public API, skipped with UI hint): `socialPreview`, `archiveSettings`, `agentSuggestions`, `security.copilotAutofix`, `security.dependencyAutoSubmit`. Read `src/schemas/github-settings.ts` for enums/defaults.

## Validate

Run in the tech-stack root (reads `./registry.json`; or `--path <dir|registry.json>`):

```bash
bunx @adistack/conform validate     # ✓ per valid file on stdout, ✗ + detail on stderr
```

Checks: registry schema; every manifest in `projects`/`machines`/`github_configs` against its schema; every `files[]` `source` exists on disk; `secrets.yaml` beside the manifest when any machine file has `secrets`. Local only — no network, no `conform.json`. Exit 0 valid / 1 invalid / 2 no registry. Wire into the repo's gate:

```json
{ "scripts": { "verify": "biome check && bunx @adistack/conform validate" } }
```

`validate` does not check: template slot correctness, payload syntax, unreferenced payloads, or that consumers can actually reach `target`. Dogfood with a consumer `check` against a branch ref before tagging.

## Rollout

1. Edit payload/manifest → `validate` exit 0.
2. Push a branch; in a consumer set `source.ref` to it; `check`/`fix --dry-run` to see the blast radius.
3. Merge. Small fixes ride `main`; breaking changes (new templates, renamed names → new result ids, removed files) get a tag; consumers bump `ref` deliberately.
4. Renaming a registry key or entry `name` breaks every consumer pinning it — the old name becomes an `internal-error` / changes result ids.

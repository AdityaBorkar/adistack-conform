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
	"$name": "CLI",
	"$description": "CLI Application using Commander",
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
	"$name": "Primary Developer Machine",
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

Strict flat object in Settings-sidebar key order (ADR 0015). Top-level `access?` and `integrations?` stay grouped; all other sections are destructured to top-level fields. Required top-level: `default_branch`, `releases`, `social_preview`, `features`, `pull_requests`, `commits`, `archives`, `pushes`, `actions`, `webhooks`, `environments`, `advanced_security`, `secrets`; everything else optional. Omitting an optional field means "not managed" (no result); empty lists pass. Shape (sidebar order):

- General fields: `description?`, `homepage?`, `topics?[]`, `template_repository?`, `default_branch`, `releases{immutable}`, `social_preview` (UI), `features{wikis{enabled,restrict_editing_to_collaborators?},issues{enabled,permissions?,auto_close?},sponsorships,preserve_repository?,discussions,projects}`, `pull_requests{enabled?,permissions?,merge_commit,merge_title,merge_message,squash_merge,squash_title,squash_message,rebase_merge,suggest_updating_branches?,auto_merge,delete_head_branches}`, `commits{signoff_required,comments_allowed}`, `archives{include_lfs_objects}`, `pushes{update_limit|null}`, `danger_zone?{visibility?,allow_forking?,branch_protection_rules_disabled?,archived?}`, `custom_properties?`.
- `access?`: `collaborators?[]{login,permission}`, `teams?[]{slug,permission}`, `moderation?{interaction_limits?{limit: off|existing_users|contributors_only|collaborators_only, expiry?},pull_request_limits?{max_open?,count_drafts?,min_account_age_days?,min_merged_prs?},code_review_limits?{restrict_to_explicit_access}}`.
- Code/planning/automation fields: `rulesets?[]` (same shape as before: `name,target: branch|tag,enforcement,bypass_actors?,include[],exclude?,rules{…}}`; an absent rule must not exist live), `branches?` (classic protection on `default_branch`: `required_status_checks[]`, `strict_status_checks?`, `reviews{…}`, `require_last_push_approval?`, `require_linear_history?`, `allow_force_pushes?`, `allow_deletions?`, `enforce_admins?`, `lock_branch?` — omit when rulesets protect the branch), `actions{general{enabled?,allowed,selected?{github_owned?,verified_creators?,patterns?},sha_pinning_required,retention_days,fork_pr_approval,fork_pr_workflows_private?,access_level?,workflow_permissions{default,can_approve_pull_requests},cache?},runners?[],policies?[] (UI),oidc?{use_default,include_claim_keys?,immutable_subject?}}`, `webhooks[]{url,content_type,events[],active,insecure_ssl?}`, `copilot?{code_review?,cloud?,internet_access?{cloud?,code_review?},mcp?{configuration},memory?,dreaming?}`, `planning?{agent_suggestions}` (UI, `cautious` passes), `environments{<name>:{wait_minutes?,prevent_self_review?,required_reviewers?,admin_bypass?,branch_policy?{type,patterns?,tag_patterns?},custom_protection_rules?,secrets?,variables?}}` (`{}` = must exist), `codespaces?{devcontainer_required?,prebuilds?[] (UI)}`, `pages?{enabled,build_type?,branch?,path?,custom_domain?,https_enforced?,public?}`.
- Security/quality fields: `advanced_security{private_vulnerability_reporting{enabled,require_cwe?,daily_limit?,trusted_reporters?},dependency_graph (UI; true passes on public repos),automatic_dependency_submission: enabled|labeled|disabled (UI),dependabot{alerts,malware_alerts?,security_updates,grouped_security_updates?,version_updates?,rules?,runner?},code_scanning{default_setup?,ai_scan?,ai_applications?,copilot_autofix,agentic_autofix?,check_run_thresholds?},secret_protection{enabled,push_protection,non_provider_patterns?,ai_detection?,validity_checks?,delegated_bypass?,delegated_alert_dismissal?,custom_patterns?}}`, `deploy_keys?[]{title,read_only?}`, `secrets{actions{secrets[],variables[]},agents?{secrets?,variables?},codespaces?[],dependabot?[]}` (presence only, manual).
- `integrations?`: `github_apps?[]` (UI), `autolinks?[]{prefix,url_template,alphanumeric?}`, `email_notifications?{addresses[],active?}` (UI).
- Community fields: `codeowners?` (path, `""` disables), `issue_templates?`, `pr_template?`, `funding?`, `license?`, `code_of_conduct?`, `readme?` (file presence, manual).

Handling per leaf (API = checked + fixed, READ = checked + manual, UI = pass when off/default, else skipped with the exact Settings path) is in each field's schema `describe`; read `src/schemas/github-settings.ts` or `config/github-manifest.json` for enums. There is no Tags field: tag protection is deprecated (endpoint 404) — use a ruleset with `target: "tag"`. Transfer/delete dialogs are destructive with no field — use the UI.

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

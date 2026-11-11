# @adistack/conform

## 1.0.0

### Major Changes

- a66752e: feat!: rename glossary-violating identifiers and strings (`kind: preset` to `project`, `unfixable` to `manual`, `--config` to `--desired-state`, `GithubPreset` to `GithubSettings`, `--json` `configs` to `desiredStates`); rewrite ADRs 0001/0003 to Zod and ignore-only compare; document `validate`, `file_structure`, template, non-TTY, and recheck semantics

### Minor Changes

- 80f82cf: Harden check and fix against untrusted blueprints and hostile input: `GITHUB_TOKEN` is no longer forwarded on cross-origin redirects; registry/blueprint `source` paths reject `..`/empty segments; `owner/repo` and `ref` values are validated before building URLs; file fixes refuse symlink targets and non-TTY `--all` refuses writes outside the project dir; backups are versioned instead of overwritten; `compare.ignore` on non-JSON files and array-root template upstreams report manual instead of overwriting; template matching is linear-time with a depth cap; `conform.json`, registry, and settings schemas are strict with sane bounds; GitHub checks share one repo read, run at most 6-wide with retries, and report per-check auth skips; `validate` prints failures to stderr and checks machine entry paths; `fix` uses its own timeout with SIGKILL escalation and stdin detached; `--version` comes from `package.json` at build time.
- 3be9109: Drop `compare.required`: any upstream holding `<...>` placeholders is now a template on its own. Placeholder slots accept any per-project value (non-empty, no placeholders, matching the surrounding text) while every other field must match the upstream. Manifests are strict: unknown `required`/`pinned`/`directories` keys are rejected instead of ignored.
- 3be9109: feat!: drop the directory blueprint layout; `registry.json` project entries must point at blueprint files (e.g. `./projects/cli-app.json`) with repo-relative `source` paths, `./`/`../` sources and `<dir>/project-manifest.json` resolution are rejected
- 4d426e7: feat!: drop unused project features (`js` toolchain deps, `compare.strip`/`versioned`, `docs:`/`~/`/`%VAR%` targets, empty-upstream defaults); project `target` is always a cwd-relative path and `compare` is `ignore[]` only
- ee538e6: feat: add `validate` command checking registry.json and blueprint manifest.json files

### Patch Changes

- bb25f68: Fix GitHub repo-settings IaC to match the GitHub REST API: `actions.allowed` uses API values (`local_only` instead of `local-only`); fork PR approval compares real `approval_policy` values (`all_external_contributors` / `first_time_contributors`) and is fixable via PUT; private vulnerability reporting reads the `enabled` flag instead of response presence; dependency graph is enforced via `vulnerability-alerts` (removed from the `security_and_analysis` PATCH which rejects it) and Dependabot 404 counts as disabled; Copilot Autofix always reports a UI-hint skip; enabling push restrictions from scratch is manual (the API rejects empty allowlists).

Entries are generated from changesets on each release.

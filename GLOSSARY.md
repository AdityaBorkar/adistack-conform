# Conformance Checking

The domain of declaring desired project, machine, and GitHub state in `conform.json` and checking reality against tech-stack blueprints.

## Language

### Desired state

**Desired State**:
The `conform.json` declaration of which project, machine, and GitHub blueprints the directory, machine, and repo should match, plus the tech-stack repo and ref holding the truth. Found by walking up from the cwd or via `--desired-state`.
_Avoid_: config, spec

**Blueprint**:
A named desired state from the tech-stack registry: a project file set, a machine nix flake, or a GitHub settings set listed in the registry `github_configs` map.
_Avoid_: preset, template

**Registry**:
The tech-stack `registry.json` listing every project, machine, and GitHub blueprint (projects/github settings as key/path pairs, machines as key/entry pairs).
_Avoid_: catalog, index

**Manifest**:
A project blueprint file (`projects/<name>.json`) declaring `@name`/`@description` plus its files, compare rules, and file-structure entries.
_Avoid_: blueprint config, spec file

**Compare**:
The per-file semantic rule declared by a manifest `files[]` entry: `ignore[]` keys are excluded from the compare and local values are preserved by `fix`.
_Avoid_: compare config

**File Structure**:
Manifest `file_structure[]` existence-only entries (`name` + `target` + `kind: file|dir`): content is per-project, missing entries are manual with a generate hint (files) or a `mkdir -p` hint (dirs). An entry whose `name` overlaps a `files[]` name is dropped with no result in favor of the file check.
_Avoid_: required docs, required dirs

### Enforcement

**Upstream**:
The desired file content fetched from the tech-stack repo that a target is compared against.
_Avoid_: golden, preset file, expected content

**Source**:
The repo-relative path of an upstream inside the tech-stack repo. (`CheckResult.source` is separately `tech-stack:<blueprint>`; `ConformSource.source` is the provider `"github"`.)
_Avoid_: preset path, upstream path

**Target**:
The manifest-declared enforcement target (cwd-relative path for project files, flake URL for machine, `owner/repo (repo settings)` for GitHub); the CLI resolves `~`/absolute project paths before reading.
_Avoid_: destination, output

**Scope**:
One of the three enforcement domains: project files, the whole machine flake, or GitHub repo settings.
_Avoid_: mode, area

**Kind**:
The check-result taxonomy: `project` (project files and file-structure entries), `nix` (machine flake), `github` (repo settings), or `internal` (scope-level failure). (The word `kind` is reused in code for fix/prompt/validate taxonomies; this glossary entry covers check results only.)
_Avoid_: preset

**Drift**:
Any mismatch between reality and desired state, reported as a failed check in any scope.
_Avoid_: diff, failure, mismatch

### Results

**Check Result**:
The outcome of one enforcement comparison, identified as `project:<blueprint>:<name>`, `nix:<blueprint>`, `github:<blueprint>:<name>`, or `<scope>:internal-error` on scope failure.
_Avoid_: check, report item

**Fixable**:
A drifted result carrying a machine-appliable remedy: `overwrite-file`, `run-command`, or `github-api` (multi-step REST calls).
_Avoid_: auto-fixable, resolvable

**Manual**:
A drifted result with no machine remedy, carrying a hint for a human to act on instead.
_Avoid_: unfixable, unactionable

**Skipped**:
A result that passes without enforcement: GitHub items with no public API (UI-only settings), 401/403 auth failures, or upstreams that do not require the check (including 404 OIDC).
_Avoid_: ignored, passed

**Template**:
A JSON-object manifest entry whose upstream holds `<...>` placeholder slots; each placeholder slot accepts any per-project value (non-empty, never placeholders), extra local fields and array items are allowed, every other field must match the upstream — a verbatim copy fails until placeholders are replaced, and a missing target is manual (copy and adapt per-project fields). Non-JSON upstreams are never templates.
_Avoid_: parameterized file

**Internal**:
A scope-level failure (`<scope>:internal-error`) when the scoped run throws; reported as drift (exit 1), not a config error. A top-level registry fetch failure outside the scoped run exits 2 instead.
_Avoid_: system error

**Fix**:
The act of applying selected fixable remedies, then re-checking only those IDs.
_Avoid_: repair, sync, apply

**Validate**:
The act of checking the tech-stack source itself (`registry.json` plus each configured project blueprint and github settings file at the pinned `source.repo@ref`), not local drift.
_Avoid_: verify

# Conformance Checking

The domain of declaring desired project and machine state in `conform.json` and checking reality against tech-stack blueprints.

## Language

### Desired state

**Desired State**:
The `conform.json` declaration of which project and machine blueprints the directory and machine should match, plus the tech-stack repo and ref holding the truth.
_Avoid_: config, spec

**Blueprint**:
A named desired state from the tech-stack registry, either a project file set or a machine nix flake.
_Avoid_: preset, template

**Registry**:
The tech-stack `registry.json` listing every project and machine blueprint by name and path.
_Avoid_: catalog, index

**Manifest**:
A project blueprint file (`projects/<name>.json`) declaring its files, compare rules, file-structure entries, and optional `github` settings-file key.
_Avoid_: blueprint config, spec file

**Compare**:
The per-file semantic rule declared by a manifest `files[]` entry: `ignore[]` keys are excluded from the compare and local values are preserved by `fix`.
_Avoid_: compare config

**File Structure**:
Manifest `file_structure[]` existence-only entries (`name` + `target` + `kind: file|dir`): content is per-project, missing entries are manual with a generate hint (files) or a `mkdir -p` hint (dirs). An entry whose `name` overlaps a `files[]` name is skipped in favor of the file check.
_Avoid_: required docs, required dirs

### Enforcement

**Golden**:
The desired file content fetched from the tech-stack repo that a target is compared against.
_Avoid_: preset file, expected content

**Source**:
The repo-relative path of a golden inside the tech-stack repo.
_Avoid_: preset path, golden path

**Target**:
The cwd-relative enforcement destination where a golden must hold.
_Avoid_: destination, output

**Scope**:
One of the three enforcement domains: project files, the whole machine flake, or GitHub repo settings.
_Avoid_: mode, area

**Kind**:
The check-result taxonomy: `project` (project files and file-structure entries), `nix` (machine flake), `github` (repo settings), or `internal` (scope-level failure).
_Avoid_: preset

**Drift**:
Any mismatch between reality and desired state, reported as a failed check in either scope.
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
A result that passes without enforcement because it has no public API (GitHub UI-only settings), or the GitHub API returned 401/403.
_Avoid_: ignored, passed

**Template**:
A manifest entry whose golden holds `<...>` placeholders; each placeholder slot accepts any per-project value (non-empty, never placeholders), every other field must match the golden — a verbatim copy fails until placeholders are replaced, and a missing target is manual (copy and adapt per-project fields).
_Avoid_: parameterized file

**Internal**:
A scope-level failure (`<scope>:internal-error`) when registry fetch, blueprint match, or scope run throws; reported as drift (exit 1), not a config error.
_Avoid_: system error

**Fix**:
The act of applying selected fixable remedies, then re-checking only those IDs.
_Avoid_: repair, sync, apply

**Validate**:
The act of checking the tech-stack source itself (`registry.json` plus each configured blueprint file at the pinned `source.repo@ref`), not local drift.
_Avoid_: verify

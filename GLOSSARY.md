# Conformance Checking

The domain of declaring desired project, machine, and GitHub state and checking reality against tech-stack blueprints.

## Language

### Desired state

**Desired State**:
The declaration of which project, machine, and GitHub blueprints the directory, machine, and repo should match, plus the tech-stack repo and ref holding the truth.
_Avoid_: config, spec

**Discovery**:
Finding the desired state by walking up from the invocation directory, or from an explicit path override.
_Avoid_: lookup, search

**Blueprint**:
A named desired state from the tech-stack registry: a project file set, a machine flake, or a GitHub settings set.
_Avoid_: preset, template

**Blueprint resolution**:
Matching a desired blueprint name to a registry entry by key, path, or short name.
_Avoid_: lookup rules, matching config

**Registry**:
The listing of every project, machine, and GitHub blueprint the tech-stack source offers.
_Avoid_: catalog, index

**Manifest**:
A project blueprint file declaring its identity plus its enforced files, compare rules, and existence-only entries.
_Avoid_: blueprint config, spec file

**Compare**:
The per-file semantic rule declared by a manifest: ignored keys are excluded from the compare and local values are preserved by fix.
_Avoid_: compare config

**File Structure**:
Existence-only manifest entries: content is per-project, missing entries carry a human hint.
_Avoid_: required docs, required dirs

**Configuration**:
The optional machine blueprint attribute selecting which system configuration to switch to, defaulting to auto-select.
_Avoid_: profile, target config

### Enforcement

**Upstream**:
The desired file content a target is compared against, identified on results by the tech-stack blueprint it came from.
_Avoid_: golden, preset file, expected content

**Source**:
The repo-relative path of an upstream inside the tech-stack repo.
_Avoid_: preset path, upstream path

**Provider**:
The host type of the tech-stack source; only github is supported.
_Avoid_: source type, backend

**Target**:
The manifest-declared enforcement target: a directory-relative path for project files, a flake for machines, or a repo for GitHub settings.
_Avoid_: destination, output

**Scope**:
One of the three enforcement domains: project files, the whole machine flake, or GitHub repo settings.
_Avoid_: mode, area

**Scope filter**:
Narrowing a run to a single scope; omitting a scope from desired state is the permanent equivalent.
_Avoid_: scope flag, mode filter

**Kind**:
The check-result taxonomy: project, machine, github, or internal for scope-level failure.
_Avoid_: preset

**Drift**:
Any mismatch between reality and desired state, reported as a failed check in any scope.
_Avoid_: diff, failure, mismatch

### Results

**Check Result**:
The outcome of one enforcement comparison, identified by scope, blueprint, and name, or as a scope internal error on scope failure.
_Avoid_: check, report item

**Fixable**:
A drifted result carrying a machine-appliable remedy.
_Avoid_: auto-fixable, resolvable

**Manual**:
A drifted result with no machine remedy, carrying a hint for a human to act on instead.
_Avoid_: unfixable, unactionable

**Skipped**:
A result that was not enforced and does not count as drift for the exit code, but is not a pass.
_Avoid_: ignored, passed

**Hint**:
The human remedy carried by a manual result, and sometimes alongside a fixable remedy.
_Avoid_: message, help text

**Template**:
A manifest entry whose upstream holds placeholder slots; each slot accepts any per-project value while every other field must match. A verbatim copy fails until placeholders are replaced, and a missing target is manual.
_Avoid_: parameterized file

**Internal**:
A scope-level failure when the scoped run throws; reported as drift, not a desired-state error.
_Avoid_: system error

### Flow

**Fix**:
The act of running selected fixable remedies, then re-checking only those IDs.
_Avoid_: repair, sync, apply

**Re-check**:
Re-running only the selected fixed IDs after apply, falling back to a full re-check on error.
_Avoid_: re-run, refresh

**Validate**:
The act of checking the tech-stack source itself at the pinned repo and ref, not local drift.
_Avoid_: verify

**Dry-run**:
Previewing fix without writing or prompting; machine dry-run checks without switching.
_Avoid_: preview mode, no-op

**Diff preview**:
The unified diff shown per fixable item before prompting, skipped for very large diffs.
_Avoid_: patch preview, change display

**Backup**:
The safety copy written next to a target before overwriting it, numbered when one already exists.
_Avoid_: snapshot, orig copy

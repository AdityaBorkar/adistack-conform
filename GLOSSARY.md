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
A project blueprint's `manifest.json` declaring its files, compare rules, required paths, toolchain deps, and directories.
_Avoid_: blueprint config, spec file

### Enforcement

**Golden**:
The desired file content fetched from the tech-stack repo that a target is compared against.
_Avoid_: preset file, expected content

**Source**:
The repo-relative path of a golden inside the tech-stack repo.
_Avoid_: preset path, golden path

**Target**:
The enforcement destination where a golden must hold, either a filesystem path or an annotation-only label.
_Avoid_: destination, output

**Scope**:
One of the two enforcement domains: project files or the whole machine flake.
_Avoid_: mode, area

**Drift**:
Any mismatch between reality and desired state, reported as a failed check in either scope.
_Avoid_: diff, failure, mismatch

### Results

**Check Result**:
The outcome of one enforcement comparison, identified as `project:<blueprint>:<name>` or `nix:<blueprint>`.
_Avoid_: check, report item

**Fixable**:
A drifted result carrying a machine-appliable remedy, either an `overwrite-file` or a `run-command`.
_Avoid_: auto-fixable, resolvable

**Manual**:
A drifted result with no machine remedy, carrying a hint for a human to act on instead.
_Avoid_: unfixable, unactionable

**Skipped**:
A result that passes without enforcement because its target is docs-only, Windows-only, or has no concrete path.
_Avoid_: ignored, passed

**Fix**:
The act of applying selected fixable remedies, then re-checking only those IDs.
_Avoid_: repair, sync, apply

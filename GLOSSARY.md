# Conformance Checking

The domain of declaring the desired state of a project, a machine, and a GitHub repo, and checking reality against tech-stack blueprints.

## Language

### Desired state

**Desired State**:
The declaration of which project, machine, and GitHub blueprints a directory, machine, and repo should match, plus the tech-stack source holding them.
_Avoid_: config, spec

**Discovery**:
Finding the desired state by walking up from the invocation directory, unless an explicit path is given.
_Avoid_: lookup, search

**Tech-stack source**:
The repo and ref that hold the registry, blueprints, and upstreams.
_Avoid_: preset repo, remote

**Provider**:
The kind of host serving the tech-stack source; only GitHub exists.
_Avoid_: source type, backend

**Registry**:
The listing of every project, machine, and GitHub blueprint a tech-stack source offers.
_Avoid_: catalog, index

**Blueprint**:
A named entry in the registry describing one desired shape: a project file set, a machine, or a set of GitHub repo settings.
_Avoid_: preset, template, profile

**Blueprint resolution**:
Matching a desired-state blueprint name to a registry entry, by exact name or path only.
_Avoid_: lookup, fuzzy match

**Manifest**:
The blueprint file declaring what that blueprint enforces.
_Avoid_: blueprint config, spec file

**Machine manifest**:
A manifest declaring the packages a machine must have and the files it must carry.
_Avoid_: flake, system config

### Enforcement

**Scope**:
One of the three enforcement domains: project, machine, or GitHub.
_Avoid_: mode, area

**Scope filter**:
Narrowing one run to a single scope.
_Avoid_: scope flag, mode filter

**Source**:
Where an upstream lives inside the tech-stack source, as declared by a manifest entry.
_Avoid_: preset path, upstream path

**Upstream**:
The tech-stack content a target is compared against, fetched from its source.
_Avoid_: golden, expected file, preset

**Target**:
The thing being enforced: a file or directory in the project, a file or package on the machine, or a GitHub repo.
_Avoid_: destination, output

**Compare rule**:
A manifest-declared adjustment to how one project file is compared, such as keys left to the project.
_Avoid_: compare config, override

**Template**:
A project upstream with placeholder slots that each project must fill with its own values; every other part must match.
_Avoid_: parameterized file, scaffold

**File structure**:
Project-manifest entries that require a file or directory to exist without checking its content.
_Avoid_: required docs, required dirs

**Link**:
A machine file enforced as a symlink to its upstream.
_Avoid_: symlink entry, dotfile

**Secrets template**:
A machine file rendered from its upstream with values from the machine's encrypted secrets.
_Avoid_: sops file

**Extra**:
A package installed on the machine that the machine manifest does not declare.
_Avoid_: untracked package, orphan

**Allowlist**:
Machine-manifest package names that are never reported as extras.
_Avoid_: ignore list

**Strict**:
A run that treats extras as drift instead of skipping them.
_Avoid_: drift mode, switch

### Results

**Check result**:
The outcome of one enforcement comparison for one target.
_Avoid_: check, report item

**Drift**:
A non-skipped check result where reality does not match the desired state.
_Avoid_: diff, failure, mismatch

**Fixable**:
Drift that carries a remedy the CLI can apply.
_Avoid_: auto-fixable, resolvable

**Manual**:
Drift with no remedy the CLI can apply, only a hint for a human.
_Avoid_: unfixable, unactionable

**Hint**:
The human-readable remedy attached to a check result.
_Avoid_: message, help text

**Skipped**:
A check result that was not enforced; it is neither a pass nor drift.
_Avoid_: ignored, passed

**Kind**:
The category of a check result: project, machine, GitHub, or internal.
_Avoid_: type

**Internal error**:
The single check result standing in for a scope whose run failed outright; it counts as drift.
_Avoid_: system error, crash

### Flow

**Check**:
Comparing reality against the desired state across scopes.
_Avoid_: audit, lint

**Fix**:
Applying selected fixable remedies in any scope, then re-checking them.
_Avoid_: repair, sync, apply, switch

**Re-check**:
Checking again after a fix, limited to what was fixed.
_Avoid_: re-run, refresh

**Validate**:
Checking the tech-stack source itself for broken blueprints, independent of any local state.
_Avoid_: verify

**Dry-run**:
Showing what a fix would do without changing anything.
_Avoid_: preview mode, no-op

**Diff preview**:
The per-item view of what a fix would change, shown before the user selects.
_Avoid_: patch preview

**Backup**:
The safety copy of a file kept next to it before a fix replaces it.
_Avoid_: snapshot, orig copy

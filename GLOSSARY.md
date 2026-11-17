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
A named desired state from the tech-stack registry: a project file set, a machine manifest, or a GitHub settings set.
_Avoid_: preset, template

**Blueprint resolution**:
Matching a desired blueprint name to a registry entry by key, path, or short name.
_Avoid_: lookup rules, matching config

**Registry**:
The listing of every project, machine, and GitHub blueprint the tech-stack source offers.
_Avoid_: catalog, index

**Manifest**:
A blueprint file declaring its identity plus its enforced entries: a project manifest holds enforced files, compare rules, and existence-only entries; a machine manifest holds packages, files, allowlist, params, and system.
_Avoid_: blueprint config, spec file

**Machine manifest**:
The JSON machine blueprint (`machines/<name>.json`) declaring versioned `packages.pacman`/`packages.bun` maps plus a single `files[]` list where each entry is a link or a secrets template.
_Avoid_: flake, system config

**Compare**:
The per-file semantic rule declared by a manifest: ignored keys are excluded from the compare and local values are preserved by fix.
_Avoid_: compare config

**File Structure**:
Existence-only project-manifest entries: content is per-project, missing entries carry a human hint.
_Avoid_: required docs, required dirs

### Enforcement

**Upstream**:
The `tech-stack:<blueprint>` label identifying which blueprint a result came from; compared content travels via `expected`/`actual`, not this field.
_Avoid_: golden, preset file, expected content

**Source**:
The repo-relative path of a manifest entry inside the tech-stack repo; it lives on manifest entries, not on results.
_Avoid_: preset path, upstream path

**Provider**:
The host type of the tech-stack source; only github is supported.
_Avoid_: source type, backend

**Target**:
The manifest-declared enforcement target: a directory-relative path for project files, an absolute home-directory path or `manager:name` for machines, or a repo for GitHub settings.
_Avoid_: destination, output

**Scope**:
One of the three enforcement domains: project files, the whole machine state, or GitHub repo settings.
_Avoid_: mode, area

**Scope filter**:
Narrowing a run to a single scope; omitting a scope from desired state is the permanent equivalent.
_Avoid_: scope flag, mode filter

**Link**:
A machine `files[]` entry without `secrets` enforcing `target` as a symlink to `<target>.conform-src`; fix is `ln -sfn`, never a content write.
_Avoid_: symlink entry

**Extra**:
An undeclared package found on the machine; skipped by check, fixable removal by switch.
_Avoid_: untracked package

**Allowlist**:
Machine-manifest names exempt from extra reporting (distro-base names).
_Avoid_: ignore list

**Kind**:
The check-result taxonomy: project, machine, github, or internal for scope-throw failure only (domain-level machine failures stay `machine`).
_Avoid_: preset

**Drift**:
Any non-skipped mismatch between reality and desired state, reported as a failed check; conform-mode extras are skipped, never drift.
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
A result carrying `ok: false` with `skipped: true` that was not enforced and never causes drift exit; it is not a pass.
_Avoid_: ignored, passed

**Hint**:
The human remedy carried by a manual result, and sometimes alongside a fixable remedy.
_Avoid_: message, help text

**Template**:
A project manifest entry whose upstream holds `<...>` placeholder slots; each slot accepts any per-project value while every other field must match. A verbatim copy fails until placeholders are replaced, and a missing target is manual.
_Avoid_: parameterized file

**Secrets template**:
A machine `files[]` entry with `secrets` rendering `@@NAME@@` slots from one shared `sops decrypt` per run; leftover placeholders are manual, a missing target is fixable, and the declared `mode` is enforced after writing.
_Avoid_: sops file

**Internal**:
A scope-level failure when the scoped run throws; reported as drift, not a desired-state error.
_Avoid_: system error

### Flow

**Check**:
Evaluating desired state in conform mode: extras are skipped, never drift.
_Avoid_: audit

**Switch**:
Evaluating machine state in drift mode: extras are fixable removals; always re-runs full drift with no scope filters.
_Avoid_: upgrade

**Fix**:
The act of running selected fixable remedies, then re-checking only those IDs.
_Avoid_: repair, sync, apply

**Re-check**:
Re-running only the selected fixed IDs after `fix` apply (falling back to full re-check on error); `switch` instead re-runs full drift.
_Avoid_: re-run, refresh

**Validate**:
The act of checking the tech-stack source itself at the pinned repo and ref, not local drift.
_Avoid_: verify

**Dry-run**:
Previewing without writing or prompting; `fix --dry-run` renders diffs by default while `switch --dry-run` never does.
_Avoid_: preview mode, no-op

**Diff preview**:
The unified diff shown per fixable `fix` item before prompting (skipped past 200k chars, at most 20 shown); `run-command`/`github-api` show steps and `switch` shows none.
_Avoid_: patch preview, change display

**Backup**:
The `.conform.bak` safety copy written next to a target by `overwrite-file` fixes only (numbered `.bak.N`, refusing past 99); link fixes carry a move-aside hint instead.
_Avoid_: snapshot, orig copy

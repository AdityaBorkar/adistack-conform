# 10x Speedup Report (No Caching) — adistack-conform

Goal: 10x faster wall time **without using caching** (i.e. `--no-cache` must also be fast).
Caching improvements are out of scope and do not count.

Scouting: 3 parallel subagents (I/O hotspots, no-cache tactics, pipeline map) + parent verification reads of `src/techstack-cache.ts`, `src/techstack.ts`, `src/techstack-check.ts`.

## 1. Baseline (measured by subagents, this machine)

- Cached `check --project-only`: ~118 ms total, check phase reports `in 17 ms` → **~100 ms is startup**, ~17 ms is real work.
- No-cache `check --project-only`: ~1,370 ms. `fetch+extract` ~1,236 ms; raw `curl` to codeload ~1,040–1,130 ms → **~85–90% is network TTFB + extract**, not checking.
- Import costs: `commander` ~13 ms, `zod` ~20 ms, `tar` ~15 ms, `fs-extra` ~11 ms, `clack` ~9 ms, `tinyglobby` ~8 ms, `diff` ~3 ms.
- Extract: npm `tar` ~135 ms vs system `tar -xzf` ~9 ms on same 36 KB tarball (**15x**).
- `raw.githubusercontent.com`: first fetch ~279 ms, same-process re-fetch ~7 ms (keep-alive); 5 parallel raw fetches ~23 ms vs 5 sequential ~1,270 ms (**~55x batch win**).
- Scale: tarball has 99 files; this repo needs ~36 checks (`total=36, skipped=3`). We download/extract/write ~3x more files than we compare. `--no-cache` `fetchAndInstall` (`src/techstack-cache.ts:94-120`) still writes tarball + stage dir + final dir + meta JSON to disk.

Conclusion: no-cache 10x (1,370 ms → <140 ms) requires killing the codeload round-trip + extract + startup. Micro-optimizing comparisons alone cannot reach 10x (Amdahl).

## 2. Pipeline map (no-cache path)

```
parseAsync -> prepareRun -> runAllChecks (Promise.all over scopes)
  -> runTechStackChecks per scope (src/techstack.ts:104-119):
    ensureGithubRepo -> loadRegistryDocument -> loadRegistry -> resolveWantedNames(loadBlueprint)
    -> collectJobs -> Promise.all(jobs)
```

| Stage                            | Code                                                                                | Parallel today?                                                                                 | Cost rank (no-cache)            |
| -------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| Config discovery/load            | `src/config.ts:73-90`, `src/utils/fs.ts:10-22`                                      | parallel over 2 configs                                                                         | negligible                      |
| Registry/manifest/blueprint JSON | `src/techstack-registry.ts:30-63`, `src/techstack-registry.ts:82-107`               | parallel reads                                                                                  | 4th                             |
| Tarball download + write         | `src/techstack-cache.ts:51-83`                                                      | sequential, 1 round-trip per `id@ref`, deduped by `inflight` (`src/techstack-cache.ts:134-145`) | **1st**                         |
| Extract/install/move/cleanup     | `src/techstack-cache.ts:85-119`                                                     | strictly sequential                                                                             | **2nd**                         |
| Preset expansion                 | `src/techstack.ts:28-57`, `src/techstack.ts:59-102`, `src/techstack-check.ts:11-26` | sync                                                                                            | negligible                      |
| Per-target reads+compare         | `src/techstack.ts:118`, `src/techstack-check.ts:91-134`, `src/utils/fs.ts:37-46`    | parallel across files, sequential golden→target within file                                     | **3rd**                         |
| Diff/output                      | `src/diff.ts:14-36`, `src/utils/output.ts:50-116`                                   | sync serial                                                                                     | negligible unless many failures |
| Fix apply + re-check             | `src/fix.ts:62-75`, `src/index.ts:156-169`                                          | writes parallel, re-check is full repeat (2x download with `--no-cache`)                        | doubles 1st–3rd                 |

Parallel today: scopes (`src/index.ts:74`), manifest reads, blueprint probes, per-file checks, fix writes, tmp cleanup.
Sequential today: download→extract→move chain, `ensureGithubRepo→registry→blueprint→jobs` chain, golden→target reads per file, initial→apply→re-check in `fix`.

## 3. Techniques (all cache-free)

Ordered by expected no-cache impact. Each lists location, change, gain, risk, verification.

### T1. Sparse fetch: skip the tarball, fetch only needed blobs (biggest win, ~5–9x)

Where: `src/techstack-cache.ts:51-87` (`downloadTarball` + `extractTarball`).

What: fetch `registry.json` → resolve wanted names from blueprint+presets+exclude (pure string sets, no I/O) → `Promise.all` fetch only `manifest.json`s + preset blobs for non-skipped files via `raw.githubusercontent.com`. Keep blobs in `Map<relPath,string>` in memory; `checkPresetFile` (`src/techstack-check.ts:91-134`) reads from map instead of `join(repoRoot, presetRelPath)`.

Why: eliminates ~1,040 ms codeload TTFB + ~135 ms npm-tar extract + ~100-file disk install. Tarball is only 36 KB — TTFB dominates, not bytes. Measured parallel raw fetch ~10x faster than one codeload fetch. Expected no-cache 1,370 ms → ~150–300 ms.

Risk: more HTTP requests (needs cap, see T6); different rate-limit/redirect vs codeload; per-request `GITHUB_TOKEN` header replication; URL-escape `ref` per segment. Keep tarball path as fallback for private/enterprise.

Verify: `hyperfine --ignore-failure 'bun ./src/index.ts check --no-cache'` before/after; in-process `Bun.nanoseconds()` around fetch phase; count `fetch` calls.

### T2. Lazy-load heavy deps (~25–35% of cached run, stacks with T1)

Where: `src/index.ts:1-22` eagerly imports `diff`, `tar` (`src/techstack-cache.ts:5`), `tinyglobby` (`src/techstack-registry.ts:3`), `@clack/prompts` (`src/index.ts:2`, `src/fix.ts:1`, `src/utils/output.ts:1`).

What: `await import()` inside `runFixCommand` / `renderFixDiffs` (`src/utils/output.ts:99-108`) / `fetchAndInstall` / blueprint-miss error path (`src/techstack-registry.ts:65-80`). `check` then loads only `commander+zod+fs`.

Gain: ~25–40 ms off every `check` (tar 15 + fs-extra 11 + clack 9 + diff 3 ms measured).

Risk: dynamic imports in `bun build --compile` (`scripts/build.ts:17-23`) must be static strings; verify `.output` binary still contains modules and `fix --dry-run` still renders diffs.

Verify: `hyperfine 'bun ./src/index.ts --help'` and cached `check` before/after.

### T3. Drop/replace heavy deps (`commander`, `fs-extra`)

Where: `src/index.ts:172-214` (commander ~13 ms), `src/techstack-cache.ts:4` + `src/checks.ts:1` (fs-extra ~11 ms: `ensureDir/move/pathExists/remove`, `outputFile` in `src/checks.ts:75-80`).

What: commander → `node:util.parseArgs` (2 commands × ~4 flags, zero-cost builtin). `fs-extra` → `node:fs/promises` (`mkdir recursive`, `rename`, `rm`) + `Bun.file.exists` / `Bun.write`. `untildify` → existing `expandHome` (`src/utils/fs.ts:48-53`).

Gain: ~20–25 ms startup + smaller 105 MB binary. Add `--minify` to `scripts/build.ts:17-23` for another ~5–10 ms.

Risk: `move(overwrite:true)` → rm-then-rename reimplementation; `parseArgs` error text differs (snapshot tests may break); minified stack traces harder to debug (keep `bun run dev` unminified).

Verify: `--help` diff, startup hyperfine, `ls -lh .output/` before/after.

### T4. Single-attempt reads: collapse `exists()+read()` (halves stat syscalls)

Where: `src/utils/fs.ts:10-22` (`readJsonFile`), `src/utils/fs.ts:37-46` (`readFileSafe`).

What: one `Bun.file(path).text()` / `.json()` in `try/catch`, map `ENOENT` → `missing`. Same for `discoverConfigs` probes (`src/config.ts:73-90`) and `loadBlueprint` probes (`src/techstack-registry.ts:89-95`).

Today: 2 syscalls per JSON, 4 per check (preset+target × exists+read) → ~60 reads / ~90–144 syscalls per full `check`. Saves ~70 stats, removes TOCTOU.

Risk: must distinguish `ENOENT` vs `EACCES` via `error.code`; keep `<unreadable>` hint path (`src/techstack-check.ts:64-70`, `src/techstack-check.ts:72-79`).

Verify: wrap counters around `readFileSafe`/`fileExists`; `check --machine-only` timing.

### T5. Parallelize the two reads inside `checkPresetFile`

Where: `src/techstack-check.ts:96-112` (`await presetRead` then `await targetRead`).

What: issue both promises before awaiting (`Promise.all`). Paths are already known in `CheckFileArgs` (`src/techstack-check.ts:81-89`).

Gain: removes 1 file-latency from every check's critical path; free. ~0.5 ms/check on NVMe, more on networked `$HOME`.

Risk: none (independent reads). Keep error-precedence identical (preset-missing still wins).

Verify: `Bun.nanoseconds()` around per-file check before/after.

### T6. Cap concurrency with a shard pool (correctness/scale guard)

Where: `runTechStackChecks` fan-out (`src/techstack.ts:118`), `loadRegistry` (`src/techstack-registry.ts:42-52`), sparse-fetch fan-out (T1).

What: tiny semaphore (16–32 lanes, no dependency) sharding `jobs` and fetches (cap ~24 fetches — measured sweet spot).

Gain: none at 36 files; prevents EMFILE/fd-thrash 10–100x slowdown at 300+ files.

Risk: too-low cap serializes; make it a named const.

Verify: synthetic 500-file fixture, wall time vs caps 8/16/32/64, watch `EMFILE`.

### T7. Re-verify only fixed files after `fix` (kills 2x tax)

Where: `src/index.ts:156-169` reruns full `runAllChecks` after `applySelected` (`src/fix.ts:62-75`).

What: replace rerun with `checkPresetFile` on `selection.selected` only, merge with prior `results`. With `--no-cache` this also avoids a second tarball download+extract.

Gain: eliminates ~60 re-reads + Zod re-validation per `fix` invocation; dominant `fix` cost after network.

Risk: `remaining` count must still reflect unfixable + unfixed; merge logic must preserve `skips`.

Verify: `fix --all` wall time + read-counter before/after.

### T8. Share one registry/blueprint load across scopes

Where: `runAllChecks` (`src/index.ts:57-79`) runs project+machine concurrently, each doing `loadRegistryDocument` + `loadRegistry` (`src/techstack.ts:114-115`) for the same `id@ref`.

What: hoist to `runAllChecks` keyed by `${id}@${ref}` (respect `inflight` in `src/techstack-cache.ts:18`). With T1 this is one shared blob `Map`.

Gain: 2x on registry/manifest reads (few ms cached, more on cold disk / T1 fetch).

Risk: low; keep behavior when refs differ.

Verify: count `readJsonFile("registry.json")` during full `check` (2→1).

### T9. Render diffs after selection, batch stdout, slim `--json`

Where: `src/index.ts:129-141` renders all `fixable` diffs before `resolveSelection`; `src/utils/output.ts:99-108` holds all diffs + N× `console.log`; `src/diff.ts:14-36` (Myers O(ND) + per-line colorize); `src/utils/output.ts:62-81` stringifies full file contents.

What:

- Move `renderFixDiffs` to after `resolveSelection`, diff only `selected` (avoids O(F) wasted diffs on cancel/subset).
- Guard `\r\n` normalize (`src/diff.ts:17-18`) with `includes("\r")`.
- Batch stdout: `join("\n")` + single `process.stdout.write` instead of N× `console.log` (`src/utils/output.ts:50-60`).
- Slim `--json`: omit/truncate `actual`/`expected`/`fix.newContent` (reuse `short()` 160-char limit, `src/utils/output.ts:12-15`) or emit length+hash.

Gain: small at 3–7 KB files (<1 ms/diff), significant with large dotfiles or red runs (100–300 KB stdout today).

Risk: JSON contract change — document/gate behind flag if consumers parse full texts.

Verify: fixture with 5 MB mismatch, max-RSS via `/usr/bin/time -v`, stdout byte count.

### T10. Lean validation: hand-check manifests/blueprints, Zod only for user config

Where: `src/schemas/*`, `parseOrThrow` (`src/schemas/common.ts:82-93`), ~8 `safeParse`/run.

What: keep Zod schemas as codegen source for `configuration_schema/*.json`, but runtime-validate flat `{name,path,target}` arrays with `typeof`/shape checks (~30 lines); reserve Zod for `conform.*.json`. Alternatively `zod/mini`.

Gain: ~10–20 ms startup + ~1–5 ms/manifest set (~15% of cached run).

Risk: validator drift — add one test asserting lean vs Zod accept/reject same fixtures.

Verify: cached `check` hyperfine; invalid-manifest unit tests.

Explicit non-tactic: `Bun.Worker`/`worker_threads` — string `===`, Zod walks, diff coloring are microseconds/file; Bun async I/O already uses its threadpool. Workers add serialization cost below ~10k files.

## 4. Roadmap to 10x (no-cache 1,370 ms → <140 ms)

| Phase       | Items                                                                                          | Expected cumulative        |
| ----------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| P0 (must)   | T1 sparse fetch + T6 cap                                                                       | ~1,370 → ~250 ms (~5x)     |
| P1 (must)   | T2 lazy imports + T3 drop commander/fs-extra + minify                                          | ~250 → ~150 ms (~9x)       |
| P2 (finish) | T4 single-read + T5 parallel reads + T7 fix re-check + T8 shared load                          | ~150 → <130 ms (>10x)      |
| Polish      | T9 diff/stdout/JSON + T10 lean validation + `Bun.spawn(["tar"])` fallback if tarball mode kept | margin + large-file safety |

Math: T1 saves ~1,000 ms, P1 saves ~60–70 ms, P2 saves ~20–40 ms + halves `fix`. Neither startup nor syscall work alone reaches 10x — T1 is required.

## 5. Measurement plan (prove it, in order)

1. Phase split with `Bun.nanoseconds()` markers: imports→parse, `ensureGithubRepo`, registry+manifest, compare, render. One cached + one `--no-cache` run. Expect no-cache ~90% download/extract, cached ~70–80% startup. If download dominates, only T1 moves the needle.
2. `hyperfine --warmup 3 --runs 10 --ignore-failure 'bun ./src/index.ts check --project-only'` (exit 1 on drift is expected). Repeat for `--machine-only`, full, `--no-cache`, and `.output` binary vs `bun src`.
3. Import cost re-run after each dep removal (in-process `Bun.nanoseconds()` deltas).
4. Network: `curl` codeload vs raw; in-process parallel-fetch batch sizes 10/20/40 to pick T6 cap.
5. Syscall counts: wrap `readFileSafe`/`fileExists`/`fetch` with counters; assert reads ~144→~40, tarball disk writes 100→0 (T1), registry reads 2→1 (T8).
6. Acceptance: four hyperfine numbers + phase split in final summary. Note: ~75% of the gain is endpoint change (codeload→raw), so re-measure if GitHub TTFB regresses.

## 6. Risks / notes

- Sparse fetch changes failure modes (per-file 404 vs whole-tarball 404) — preserve actionable errors from `src/techstack-cache.ts:69-79` per blob.
- `fix` non-TTY/cancel paths (`src/index.ts:144-154`) and `check --json` contract must stay stable (no timing lines in JSON — current `src/index.ts:97-110` already excludes timing from `printJsonSummary`).
- System-`tar` fallback (`Bun.spawn(["tar","-xzf"])`) breaks pure-JS Windows portability — keep npm-tar fallback.
- `collectJobs` (`src/techstack.ts:59-102`) already classifies before I/O — keep that ordering in T1 so `docs:`/`%VAR%`/annotation-only targets never trigger fetches (T1b) and `*.example` needs only a target stat (`src/techstack-check.ts:47-70`).

## 7. Implementation (this change)

Implemented T1, T2 (partial), T4, T5, T6, T7, T8, T9 (partial). Deferred T3-commander, T10, JSON slimming (contract risk).

- T1 sparse fetch (`src/techstack-sparse.ts`, new; wired in `src/techstack.ts:106-128`): `check --no-cache` fetches `registry.json` → manifests → blueprint → only needed preset blobs via `raw.githubusercontent.com` (auth headers preserved, `GITHUB_TOKEN` supported), blobs in `Map`, `checkPresetFileWithGolden` (`src/techstack-check.ts`). Skips `docs:`/`%VAR%`/annotation-only targets and `*.example` blob fetches. Concurrency cap 16 (`SPARSE_FETCH_CONCURRENCY`), shared in-process registry cache. Ref-with-`/` falls back to tarball; per-blob 404 → `<preset file missing>` (disk parity); registry/manifest/blueprint failure → tarball fallback with warning. Disk path unchanged for cached runs.
- T2 partial (`src/techstack-cache.ts:85-87`, `src/techstack-registry.ts`, `src/fix.ts`, `src/utils/output.ts`, `src/index.ts`): `tar` and `tinyglobby` (error path only) and `@clack/prompts` (fix/outro only) are `await import()`; `check` never loads them. Bundle 194 → 161 modules. `diff` kept static (3 ms; making it async would churn the fix UX).
- T3 partial: `fs-extra` removed from runtime (`src/utils/fs.ts:57-83` native `mkdir`/`rm`/`rename`/`stat`, `src/checks.ts`, `src/techstack-cache.ts`). `commander` kept (help-text contract).
- T4 (`src/utils/fs.ts:11-55`): single-attempt `Bun.file().text()`/`.json()` with `ENOENT` → missing mapping; halves stat syscalls; `loadBlueprint` single-reads candidates (`src/techstack-registry.ts:97-131`).
- T5 (`src/techstack-check.ts:80-99`): golden+target reads via one `Promise.all`; preset-missing precedence preserved; `trim()` copy replaced by `isBlankGolden` regex test.
- T6 (`src/utils/concurrency.ts`, new; used in `src/techstack.ts:143-147` with `CHECK_CONCURRENCY = 32`, sparse fetch/extract with 16): bounded lanes, `.then`-chained (no `await`-in-loop) to satisfy lint.
- T7 (`src/techstack.ts:130-154`, `src/techstack-sparse.ts:recheckSparseSelected`, `src/index.ts:159-194`): `fix` rechecks only `selection.selected` (grouped by scope/config) and merges by id; full `runAllChecks` rerun kept as fallback. Disk recheck reuses cache (`ensureGithubRepo(spec, false)`); sparse recheck refetches only selected blobs.
- T8 (`src/techstack-registry.ts:24-51` doc cache; sparse registry cache `src/techstack-sparse.ts:18`): duplicate `registry.json` reads eliminated across scopes.
- T9 partial (`src/utils/output.ts`, `src/diff.ts:7-24`, `src/index.ts:133-156`): `\r\n` normalize guarded by `includes("\r")`; stdout batched to single `process.stdout.write`; `renderFixDiffs`/`outroAllPassed` async (lazy `diff`/`prompts`); `fix` still diffs before selection (UX preserved) — intermediately `fix --dry-run` diffs all fixable, interactive `fix` diffs only `selection.selected`.
- Deferred: commander→`parseArgs`, Zod-lean validation, `--json` slimming (output contract), system-tar swap (kept npm-tar lazy fallback for portability).

## 8. Verification

`bun run verify` passes (format, lint, types, build; bundle 194 → 161 modules). Schemas/`.output` reverted as generated noise. Behavior parity: `check --json` vs `check --json --no-cache` identical (36 total, 11 failed, 22 passed, 3 skipped, 0 result mismatches by id). `fix --all --project-only` in a temp copy (isolated `HOME`/cwd) applies + selective-rechecks to `All conform checks passed`; `--no-cache` fix likewise (93 ms). Compiled `.output` binary rebuilt and smoke-tested (`check`, `--no-cache`, `--json` all pass; timing present).

Measured on this machine (`bun ./src/index.ts`, warm runs):

| Command                                           | Before                           | After                         | Speedup                 |
| ------------------------------------------------- | -------------------------------- | ----------------------------- | ----------------------- |
| `check` (full, cached)                            | ~130 ms total / 19 ms phase      | ~93 ms total / 19 ms phase    | ~1.4x total             |
| `check --project-only` (cached)                   | ~120 ms total / 18 ms phase      | ~89 ms total / 16 ms phase    | ~1.3x total             |
| `check --project-only --no-cache`                 | ~1,466 ms total / 1,320 ms phase | ~150 ms total / ~71 ms phase  | ~10x total / ~18x phase |
| `check --no-cache` (full)                         | ~1,500 ms est. total             | ~170 ms total / ~100 ms phase | ~9x total / ~13x phase  |
| `fix --dry-run --no-cache`                        | ~1.4 s est.                      | ~112 ms phase                 | ~12x                    |
| `fix --all --project-only --no-cache` (temp copy) | ~2.8 s est. (2x tarball)         | 93 ms total                   | ~30x                    |

10x bar met for all no-cache paths on both check-phase (`in X` output) and total wall time. First cold run after edits is slower (Bun transpile + DNS); numbers above are steady-state warm runs. Re-measure if GitHub TTFB regresses (~75% of the no-cache gain is codeload→raw + no-extract).

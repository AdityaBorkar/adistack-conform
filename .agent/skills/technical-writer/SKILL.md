---
name: technical-writer
description: Use when authoring, restructuring, editing, or reviewing any technical prose bound for a repository or a reader other than the current chat - README, reference documentation, API or CLI docs, tutorial, how-to guide, explanation, design doc, RFC, spec, proposal, implementation plan, ADR, runbook, playbook, troubleshooting guide, migration or deprecation guide, changelog, release notes, handover summary, PR description, commit message, code comments, error messages, or diagrams (PlantUML, Mermaid, ArchiMate). Use whenever the output is more than a paragraph of persistent text, even if nobody says "document" or "docs".
---

# Technical writer

## Core principle

A document is a set of **load-bearing claims** delivered to a **specific reader** who must perform a **specific task**. Every claim is current, verified, and traceable to a source; every fact has exactly one canonical home (single source of truth); every level (document, section, paragraph) leads with its conclusion (BLUF, inverted pyramid). A thin, accurate document beats a complete-looking, overstated one.

Scope: persistent artifacts (files, PRs, commits, tickets, published pages). Chat replies are out of scope. Content comes from sources; this skill governs form, truthfulness, and maintenance, never what is true.

Language: these rules are written in English; a document keeps its own language (a Dutch document is drafted and reviewed in Dutch). Structural and truth rules are language-independent; the lexical lists in `references/style.md` are English-specific.

## Workflow

1. **Survey.** Read up to two comparable documents in the target directory and adopt their structure, register, and conventions; if none exist, use repository-level conventions (`AGENTS.md`, `CONTRIBUTING.md`, existing docs index). Search whether the topic already has an owner document: extending the owner beats creating a rival. If a `README.md` or index lists sibling documents, register the new one there.
2. **Classify.** Determine the document's **genre** (routing table below) and its **edit kind** (normative / descriptive / historical / procedural / reference). Load the matching genre reference.
3. **Declare.** In working notes, never in the deliverable unless its schema demands it:
   `Genre: <...> | Kind: <...> | Audience: <role + context> | Task: <verb the reader must accomplish> | Non-goals: <excluded scope>`
   Fill fields from the request, sources, and repository. Proceed on a stated assumption when the unknown would not change the result; ask only when it would change audience, substance, or scope. Never fabricate a fact to complete the declaration.
4. **Ground.** Collect sources before drafting. Every load-bearing claim gets a source; gaps are marked, never filled with plausible guesses. See `references/truth.md`.
5. **Draft conclusion-first.** Outcome, then supporting evidence, then detail. No preamble, no "this document describes", no run-up context before the point.
6. **Style pass.** Apply `references/style.md`: sentence mechanics, lexicon, banned constructions, formatting.
7. **Verify.** Run the pre-delivery checklist at the end of this file.

## Genre routing

Diátaxis splits user documentation by reader need; the other genres cover engineering artifacts. One document serves one genre; mixing a tutorial into a reference page degrades both.

| Genre                                  | Reader need                                    | Load                        |
| -------------------------------------- | ---------------------------------------------- | --------------------------- |
| Tutorial                               | Learning by doing, guided, guaranteed success  | `references/user-docs.md`   |
| How-to guide                           | Accomplishing a known goal                     | `references/user-docs.md`   |
| Reference (API, CLI, config, schema)   | Looking up exact facts                         | `references/user-docs.md`   |
| Explanation (concepts, architecture)   | Understanding why                              | `references/user-docs.md`   |
| README                                 | Orientation: what, why, quickstart, where next | `references/user-docs.md`   |
| Design doc, RFC, spec, proposal, plan  | Evaluating or executing a proposed change      | `references/design-docs.md` |
| ADR (architecture decision record)     | Knowing what was decided and why               | `references/design-docs.md` |
| Runbook, playbook, troubleshooting     | Executing a procedure, often under pressure    | `references/runbooks.md`    |
| Migration or deprecation guide         | Moving from old behavior to new                | `references/runbooks.md`    |
| Changelog, release notes, handover     | Learning what changed and what is owed         | `references/changelogs.md`  |
| Commit message, PR description         | Reviewing or bisecting a change                | `references/changelogs.md`  |
| Code comment, docstring, error message | Maintaining or operating code                  | `references/style.md`       |
| Diagram                                | Seeing branching, concurrency, state, topology | `references/diagrams.md`    |

`references/truth.md` and `references/style.md` apply to every genre.

## Edit kinds

The correct edit depends on the document's kind. "Update the docs to match the code" is wrong for two of five.

| Kind        | Examples                                                          | Edit rule                                                                                                                                |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Normative   | contracts, architecture principles, style guides, specs as agreed | Code that violates the contract is a defect: record the violation, never weaken the contract. Edit only for renamed or removed concepts. |
| Descriptive | component docs, flows, state machines, explanations               | Match the implementation exactly. Verify against code paths, not identifiers.                                                            |
| Historical  | changelogs, accepted ADRs, applied migrations, superseded specs   | Immutable. Flag discrepancies; supersede with a new dated entry.                                                                         |
| Procedural  | runbooks, how-to guides, release procedures                       | Match reality; every step must have been executed.                                                                                       |
| Reference   | API, CLI flag, config key, schema references                      | Exhaustive: every public item, with type, default, and usage.                                                                            |

A document describing something fully removed is not deleted: add a one-line banner (`> NOTE: describes removed component X; see Y.`) and leave deletion to the owner.

## Invariants

These hold in every genre unless a genre reference names an explicit exception.

- **Traceability.** Never state as fact what cannot be traced to a cited path, pinned commit, test, command output, or primary source. Unknowns are written as unknowns.
- **Single source of truth.** One fact, one home; everything else links to it. When an index or summary disagrees with its source, the source wins and the summary is the defect.
- **Present-state description.** Describe current behavior, not its history: no changelog section, no "last updated" field, no "now uses", "was refactored to", "replaces the old". History belongs in changelogs, ADRs, migration guides, and commit messages.
- **No delivery narrative.** No phase names, task IDs, ticket keys, plan references, or SHAs describing how work was delivered, in prose, code comments, identifiers, or strings. Exceptions: a pinned commit cited as evidence; ticket keys in commits, PRs, trackers, and planning documents.
- **History is immutable.** Accepted decisions and applied migrations are never edited; corrections are new dated entries.
- **Status honesty.** Distinguish written (in the repository), deployed (live), and externally verified. Never claim a state that was not checked; "verified" names what was checked and how.
- **Dash discipline.** No em dash (U+2014), no en dash (U+2013), no double hyphen used as punctuation. Use a comma, colon, semicolon, period, parentheses, or a spaced hyphen. A plain hyphen serves ranges (`2026-2030`). CLI flags such as `--path` are code, not punctuation.
- **Sentence-case headings.** Never Title Case.

## Rule precedence

When rules conflict, the higher one wins:

1. Truth, safety, and historical immutability.
2. An explicit exception stated in the active genre reference (it names the rule it bends and its boundary).
3. The invariants above.
4. An explicit schema or template, then the target directory's conventions.
5. `references/style.md` preferences.

An author's explicit style instruction outranks level 5 only. "Leave my voice alone" stops the style pass; truth, safety, and history still bind. A request to make a document "punchy", "compelling", or "persuasive" does not change the register: evidence persuades, adjectives do not.

## Audience calibration

Name the reader concretely (role, context, prior knowledge) and the verb they must accomplish; "users" is not an audience.

| Reader                       | Optimize for                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| Implementing engineer        | Exact interfaces, invariants, edge cases, what changes for them |
| Tech lead, architect         | Trade-offs, rejected alternatives, long-term consequences       |
| Manager, product owner       | Outcome, cost, risk, decision required                          |
| Operator, on-call            | Ordered, copy-pasteable steps; blast radius; rollback           |
| External user, contributor   | No internal codenames, team names, or undefined jargon          |
| AI agent (AGENTS.md, skills) | Imperative rules, exact paths and commands, explicit precedence |

Multiple audiences: the summary serves the broadest reader; later sections deepen. A term that would need a footnote needs rewriting or a definition at first use.

## Editing existing documents

Edits are surgical. Preserve voice, structure, numbering, anchors, and IDs. Do not silently trim, reorder for emphasis, or restyle content outside the requested change. When a fact changes, sweep every surface that states it, scoped precisely so the sweep does not become a rewrite. State what was corrected.

## Common failure modes

| Failure                                         | Correction                                                |
| ----------------------------------------------- | --------------------------------------------------------- |
| Solution presented before the problem           | Problem, then proposal, then evidence                     |
| Restating what the code already shows           | Document rationale, constraints, invariants, alternatives |
| Unquantified comparatives ("faster", "simpler") | Add the number and its source, or cut the claim           |
| Plausible guess filling a gap                   | `**[source wanted: ...]**` or an explicit "unknown"       |
| Ownerless open item ("needs investigation")     | Name an owner role and the next action                    |
| Benefits without costs                          | Every proposal names what it costs and what gets harder   |
| Duplicate document beside the owner document    | Extend the owner; link from elsewhere                     |
| Document beyond roughly 800 lines of prose      | Split by reader task; the parent links to the parts       |

## Pre-delivery checklist

- [ ] Genre and kind declared; the matching genre reference applied.
- [ ] First sentence of the document and of each section states the conclusion.
- [ ] Every load-bearing claim has a source or an explicit gap marker; no fabricated citations.
- [ ] Every fact appears once; other mentions link to it.
- [ ] Commands, paths, flags, and identifiers were checked against the repository and are copy-pasteable.
- [ ] No em dash, en dash, or punctuation double hyphen: search for `—`, `–`, and `--`.
- [ ] No banned constructions from `references/style.md`.
- [ ] Headings in sentence case; heading levels never skip.
- [ ] Index or README updated if one lists sibling documents.

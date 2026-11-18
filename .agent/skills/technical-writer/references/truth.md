# Truth: grounding, confidence, staleness

Applies to every genre, at the highest precedence level. Diagrams, tables, and code samples are claims too.

## Grounding

- Every load-bearing claim traces to a source stated in the document: a `path:line`, a pinned commit, a test, an exact command with its output, or a primary source (specification, vendor documentation, standard).
- Ground in the primary artifact, not another document's summary of it. A document's own status header is not evidence.
- Facts supplied without sources: never invent a citation, never block, never silently drop the fact. Use it, mark it `**[source wanted: <what, from whom>]**`, and continue. The owner resolves the marker before the document is final.
- Counts and measurements print the command that produced them, run against committed state (`HEAD`), not the working tree.
- When primary sources conflict, document the conflict and state which source wins and why; never silently pick the favorable value.
- "Not stated by the vendor" means no public statement was found, not that the feature is absent. Define what each placeholder means.
- Within one document, one section owns each raw number. Other sections cite it (`see ch. 2`) or use a derived form ("more than halves"), never a second copy that can drift.

## Perishable facts

Third-party behavior decays: vendor APIs, model capabilities, library versions, prices, quotas, rate limits. Each such claim carries the date and version (or commit) at which it was observed, stated once next to the claim. Never present a price, version, or limit as permanent.

## Confidence tiers

When a document mixes evidence grades, define the tiers in a "How to read this" section and label claims consistently:

| Tier      | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| Measured  | Reproduced from the repository or a script named in the document |
| Sourced   | Traced to a named primary source, cited where the claim appears  |
| Estimated | Judgment or model output, labeled, with the inputs it depends on |

Keep fact, proposal, and hypothesis visibly separate. Analysis is verifiable; recommendations and phasing are not; say which is which. A hypothesis stays labeled until evidence supports it; repetition is not evidence. Carry known weaknesses forward instead of dropping them. In circulating documents, name the role or the process failure, never the person.

## Status claims

Three states, never conflated:

- **Written**: exists in the repository.
- **Deployed**: live in the target environment.
- **Externally verified**: checked in the external system.

"Verified" always names the check: `PASS (ran bun test; 214 passed)`, never a bare checkmark. Tense matches status: a dormant system does not take the present tense; an unreleased feature does not imply availability.

## Keeping documents true

- Documentation changes ship in the same change as the behavior they describe. Documentation is part of the definition of done.
- A descriptive document names the code it describes (module, directory, entry point) in its opening or front matter, as a drift anchor. A path is not a date and does not violate the no-"last updated" invariant.
- When a fact changes, enumerate every surface that states it and fix all of them.
- Correct visibly. Delete what is wrong; age alone is not a reason to delete.
- Superseded or decommissioned documents get a banner, not deletion: what replaced it, where authority moved, why the file remains.
- Surface known staleness as a visible note rather than leaving a wrong picture in place.
- A retired false claim gets a regression guard (a CI grep or a checklist line) so it cannot return.
- Indexes are derived artifacts: rebuild from the leaves, verify counts against the actual files, give every entry a one-line purpose.
- Audit completeness by counting documented items against public items (endpoints, commands, flags, config keys), not by impression.

## Reviewed documents

A document requiring approval keeps an append-only sign-off log beside it or in a companion file: `- YYYY-MM-DD <reviewer role>: approved <scope>`. Content changed after the latest sign-off counts as unreviewed. This is a named exception to the no-changelog invariant: approval events are not derivable from git history. The log records reviews, never edits.

## Rules about rules

For conventions documents (style guides, `AGENTS.md`, skills):

- Add a rule after the same mistake occurs twice; once is learning.
- Each rule states its trigger, the instruction, and an example. "Be careful" is not a rule.
- Exceptions sit next to the rule they bend.
- Retire a rule when its underlying cause is fixed; sharpen a rule that keeps firing.
- Automate only the mechanically decidable rules, and state where the linter stops and judgment starts.

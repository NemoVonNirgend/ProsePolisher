# Prose Polisher

Prose Polisher is a repetition analyzer and correction-rule manager for SillyTavern. It finds recurring narrative language, presents the evidence for review, and helps build narrowly scoped replacements without changing a sentence’s grammar or meaning.

Version 6.1 adds extension-lifecycle cleanup and replaces the old broad bundled regex collection with a small, review-first safety pack. The former Project Gremlin generation pipeline remains in [Nemo Orchestrator](https://github.com/NemoVonNirgend/NemoOrchestrator).

## What It Does

- Tracks repeated phrases in the current chat.
- Groups related repetition patterns and shows a frequency leaderboard.
- Supports curated static rules and user-owned dynamic rules.
- Previews replacements against real chat text before activation.
- Uses the current SillyTavern connection to review candidates and draft rules.
- Synchronizes enabled rules with SillyTavern’s global Regex Processor.
- Removes its synchronized global rules when the extension is disabled or deleted.
- Preserves commas and normal punctuation with SillyTavern’s `{{random::a::b}}` syntax.

## Safety Model

Generated and bundled rules are conservative by design.

- Candidate examples must come from real chat context.
- Rules must preserve subject, object, agency, tense, person, number, point of view, negation, certainty, intensity, facts, and ambiguity.
- Every generated rule requires a stated semantic invariant and at least three distinct compatibility sentences.
- Invalid regexes, empty matches, missing capture groups, nested macros, punctuation-padding errors, incomplete examples, invented context, and high-risk rules are rejected.
- Newly generated rules are disabled for review by default.
- Bundled rules are also disabled by default and must be explicitly reviewed and enabled.
- Global rules are published only for AI-output placement. Prose Polisher does not rewrite user input, world info, slash commands, or reasoning blocks.

Repetition is preferable to a replacement that changes meaning or breaks grammar.

## Bundled Rule Pack

Version 6.1 replaces the legacy 51-rule bundle with a smaller audited pack.

The former bundle used legacy comma-delimited random macros and included broad rules that could randomize concrete details such as names, numbers, colours, and locations. Those rules have been removed. The new pack:

- stores replacements as unambiguous `alternatives` arrays;
- declares a semantic invariant and risk level for every rule;
- includes grounded compatibility sentences used by the automated test suite;
- contains no entity or fact randomizers;
- ships entirely disabled for review.

Updating to 6.1 removes previously synchronized Prose Polisher static rules from the global list and rebuilds the list from the new pack. User-owned dynamic rules remain in extension settings.

## Installation

Install through SillyTavern’s extension installer:

```text
https://github.com/NemoVonNirgend/ProsePolisher
```

After installation, open **Extensions → Prose Polisher**.

## Disable, Delete, and Clean Behaviour

Prose Polisher marks every synchronized global rule with an owned ID prefix and `(PP)` display prefix.

- **Disable:** removes Prose Polisher-owned global regex entries and retains extension settings.
- **Delete:** removes Prose Polisher-owned global regex entries before the extension files are removed. Dynamic rules and analysis settings remain available for a later reinstall.
- **Clean/Delete extension data:** removes the owned global entries and the `ProsePolisher` settings object.
- **Re-enable:** activates the extension and republishes only the rules currently enabled in Prose Polisher.

Unrelated global Regex Processor entries are never removed by this cleanup.

## Typical Workflow

1. Open the **Regex Navigator** and review the bundled static rules.
2. Enable only the static rules whose preview fits your prose.
3. Enable dynamic analysis if you want Prose Polisher to learn from the current chat.
4. Use **Analyze Chat History** to collect repetition evidence immediately, or let it accumulate while chatting.
5. Inspect **View Frequency Data** and adjust the whitelist or blacklist if necessary.
6. Select **Generate AI Rules from Analysis**.
7. Review new disabled rules in the **Regex Navigator**.
8. Preview, edit, and enable only the rules you want.

## Settings

- **Global Regex integration:** Publishes enabled Prose Polisher rules to SillyTavern’s Regex Processor.
- **Static rules:** Allows use of the bundled review-first rules.
- **Dynamic learning:** Tracks repetition and permits automatic analysis triggers.
- **Auto-rule trigger:** Controls how many messages are observed before an automatic generation pass.
- **Slop threshold:** Sets the repetition score required before a phrase becomes a candidate.
- **Skip triage:** Sends candidates directly to rule generation. Leave this off unless you understand the increased risk.
- **Automatically activate generated rules:** Bypasses review-first activation.
- **N-gram and pattern controls:** Tune phrase length, common-pattern requirements, pruning, and leaderboard refresh frequency.
- **Generation instructions:** Opens the editable rule-generation contract. Resetting it restores the maintained default prompt.

## Regex Navigator

The navigator is the supported place to manage Prose Polisher rules.

- Static rules can be inspected, enabled, or disabled; per-rule choices persist by stable rule ID.
- Dynamic rules can be created, edited, previewed, enabled, disabled, or deleted.
- Preview results show the exact matched span and deterministic replacement example.
- A zero-match preview is reported explicitly rather than treated as proof that a rule is safe.

Dynamic rules store replacements as an `alternatives` array. Compatibility with older `replaceString` rules is retained, including legacy comma macros, but newly serialized multi-option rules use the current double-colon syntax.

## Project Gremlin Migration

Prose Polisher no longer runs or displays Project Gremlin.

Saved legacy Gremlin settings are intentionally left untouched during ordinary disable or delete operations so Nemo Orchestrator can perform its one-time migration. Choosing SillyTavern’s clean/delete-data option intentionally removes the entire Prose Polisher settings object.

## Upgrading from an Earlier Release

- Existing dynamic rules, analysis settings, and new per-rule static enable/disable choices are retained.
- Existing Project Gremlin settings remain stored unless extension data is explicitly cleaned.
- Previously synchronized `(PP)` global rules are removed and rebuilt from currently enabled rules.
- The legacy broad static pack is replaced, and every new bundled rule starts disabled.
- Review any user-created dynamic rules that were based on the old broad patterns.

## Testing

Run the automated suite from the extension directory:

```bash
npm test
```

The suite covers:

- global Regex Processor ownership and synchronization;
- disable, delete, and clean lifecycle cleanup;
- manifest lifecycle-hook wiring;
- bundled-rule IDs, review-first defaults, risk metadata, invariants, regex validity, grounded examples, and capture substitution;
- settings normalization;
- prompt contracts;
- legacy rule parsing, previews, and semantic-safety validation.

GitHub Actions runs the same suite on pushes and pull requests.

## Troubleshooting

**Rules are not appearing in the Regex Processor**

Confirm Global Regex integration is enabled, the relevant static or dynamic mode is enabled, and the individual rule is not disabled. Bundled rules are disabled by default in Version 6.1.

**Old `(PP)` rules remain after upgrading**

Reload SillyTavern once with Prose Polisher enabled. Startup synchronization removes current ID-prefixed entries and legacy display-name-only `(PP)` entries before rebuilding the owned set.

**Rules remain after disabling or deleting the extension**

This release uses SillyTavern’s extension lifecycle hooks. Update SillyTavern to a build that supports manifest `activate`, `disable`, `clean`, and `delete` hooks, then disable or delete Prose Polisher again.

**Dynamic analysis has not produced candidates**

Repetition must meet the configured threshold. Use **Analyze Chat History** and **View Frequency Data** to inspect the evidence directly.

**Generated rules are disabled**

This is the expected review-first behavior. Preview the rule in the Regex Navigator and enable it when satisfied.

**Generation fails**

Prose Polisher uses the current SillyTavern connection through `/gen`. Confirm that the active API and model can generate normally.

**Project Gremlin controls disappeared**

They moved to Nemo Orchestrator. Prose Polisher retains only the saved migration data.

## Contributing

Bug reports and focused pull requests are welcome. When proposing a replacement rule, include complete example sentences and explain the exact grammatical and semantic invariant the rule preserves.

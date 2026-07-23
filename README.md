# Prose Polisher

Prose Polisher is a repetition analyzer and correction-rule manager for SillyTavern. It finds recurring narrative language, presents the evidence for review, and helps build narrowly scoped replacements without changing a sentence’s grammar or meaning.

Version 6 makes Prose Polisher the focused home for prose analysis and rule management. The former Project Gremlin generation pipeline now lives in [Nemo Orchestrator](https://github.com/NemoVonNirgend/NemoOrchestrator).

## What It Does

- Tracks repeated phrases in the current chat.
- Groups related repetition patterns and shows a frequency leaderboard.
- Supports curated static rules and user-owned dynamic rules.
- Previews replacements against real chat text before activation.
- Uses the current SillyTavern connection to review candidates and draft rules.
- Synchronizes enabled rules with SillyTavern’s global Regex Processor.
- Preserves commas and normal punctuation with SillyTavern’s modern `{{random::a::b}}` syntax.

## Safety Model

Generated rules are conservative by design.

- Candidate examples must come from real chat context.
- Rules must preserve subject, object, agency, tense, person, number, point of view, negation, certainty, intensity, facts, and ambiguity.
- Every rule requires a stated semantic invariant and at least three distinct compatibility sentences.
- Invalid regexes, empty matches, missing capture groups, nested macros, punctuation-padding errors, and high-risk rules are rejected.
- Newly generated rules are disabled for review by default.

You can opt into automatic activation, but review-first is the recommended setting. Repetition is preferable to a replacement that changes meaning or breaks grammar.

## Installation

Install through SillyTavern’s extension installer:

```text
https://github.com/NemoVonNirgend/ProsePolisher
```

After installation, open **Extensions → Prose Polisher**.

## Typical Workflow

1. Keep static rules enabled.
2. Enable dynamic analysis if you want Prose Polisher to learn from the current chat.
3. Use **Analyze Chat History** to collect repetition evidence immediately, or let it accumulate while chatting.
4. Inspect **View Frequency Data** and adjust the whitelist or blacklist if necessary.
5. Select **Generate AI Rules from Analysis**.
6. Review new disabled rules in the **Regex Navigator**.
7. Preview, edit, and enable only the rules you want.

## Settings

- **Global Regex integration:** Publishes enabled Prose Polisher rules to SillyTavern’s Regex Processor.
- **Static rules:** Enables the bundled correction rules.
- **Dynamic learning:** Tracks repetition and permits automatic analysis triggers.
- **Auto-rule trigger:** Controls how many messages are observed before an automatic generation pass.
- **Slop threshold:** Sets the repetition score required before a phrase becomes a candidate.
- **Skip triage:** Sends candidates directly to rule generation. Leave this off unless you understand the increased risk.
- **Automatically activate generated rules:** Bypasses review-first activation.
- **N-gram and pattern controls:** Tune phrase length, common-pattern requirements, pruning, and leaderboard refresh frequency.
- **Generation instructions:** Opens the editable rule-generation contract. Resetting it restores the maintained default prompt.

## Regex Navigator

The navigator is the supported place to manage Prose Polisher rules.

- Static rules can be inspected and enabled or disabled.
- Dynamic rules can be created, edited, previewed, enabled, disabled, or deleted.
- Preview results show the exact matched span and deterministic replacement example.
- A zero-match preview is reported explicitly rather than treated as proof that a rule is safe.

Dynamic rules store replacements as an `alternatives` array. Compatibility with older `replaceString` rules is retained, including legacy comma macros, but newly serialized multi-option rules use the current double-colon syntax.

## Project Gremlin Migration

Prose Polisher no longer runs or displays Project Gremlin.

Saved legacy Gremlin settings are intentionally left untouched as a recovery copy. On its first load, Nemo Orchestrator can import custom prompts, stage toggles, presets, APIs, models, custom URLs, iteration counts, and Writer Chaos options. The two extensions then maintain independent settings.

## Upgrading from an Earlier Release

- Existing Prose Polisher rules and analysis settings are retained.
- Existing Project Gremlin settings remain stored but are inactive in Prose Polisher.
- Install Nemo Orchestrator before deleting any legacy settings you may want to migrate.
- Generated rules now default to disabled even if an older release activated them automatically.
- Review existing broad rules after upgrading; Version 6’s validator is intentionally stricter.

## Testing

Run the automated suite from the extension directory:

```bash
npm test
```

The suite covers global Regex Processor synchronization, settings normalization, prompt contracts, legacy rule parsing, capture substitution, previews, grounded compatibility evidence, and semantic-safety validation.

The modernization release is also checked against the current SillyTavern extension paths, host event names, settings anchors, and module graph.

## Troubleshooting

**Rules are not appearing in the Regex Processor**

Confirm Global Regex integration is enabled, the relevant static or dynamic mode is enabled, and the individual rule is not disabled.

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

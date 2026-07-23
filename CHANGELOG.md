# Changelog

## 6.0.0

### Changed

- Refocused Prose Polisher on repetition analysis, diagnostics, and correction-rule management.
- Moved the Project Gremlin runtime and interface to Nemo Orchestrator.
- Split settings and Regex Navigator behavior into dedicated modules.
- Updated multi-option replacements to SillyTavern’s `{{random::a::b}}` syntax so commas remain valid replacement punctuation.
- Made generated rules disabled for review by default.
- Replaced the legacy generation prompt with a conservative grammar-and-meaning preservation contract.

### Added

- Semantic invariants, declared risk, and grounded compatibility examples for generated rules.
- Validation for empty regex matches, invalid capture references, duplicate alternatives, nested macros, unsafe punctuation, incomplete examples, invented context, and high-risk output.
- Real-chat preview warnings when a rule has no matches.
- Preservation of legacy Project Gremlin settings for non-destructive Nemo Orchestrator migration.
- Automated regression coverage for prompt construction, settings, global Regex Processor synchronization, legacy parsing, previews, and rule safety.

### Removed

- Project Gremlin generation, Writer Chaos, connection switching, and Gremlin settings UI from Prose Polisher.

### Upgrade Notes

- Install Nemo Orchestrator to continue using the former Project Gremlin pipeline.
- Existing Gremlin settings remain stored in Prose Polisher as a migration and recovery copy.
- Review newly generated rules in the Regex Navigator before enabling them.

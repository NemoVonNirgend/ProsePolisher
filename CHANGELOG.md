# Changelog

## 6.1.0

### Fixed

- Added SillyTavern lifecycle hooks so disabling or deleting Prose Polisher removes its synchronized global Regex Processor entries before the extension becomes inactive.
- Added clean-data handling that also removes the `ProsePolisher` settings object when the user explicitly requests extension-data cleanup.
- Expanded ownership detection to remove both current `_prosePolisherRule_` IDs and legacy display-name-only `(PP)` entries while preserving unrelated global rules.
- Restricted synchronized rules to AI-output placement instead of deprecated Markdown display, slash-command, world-info, and reasoning placements.
- Made global synchronization tolerate missing rule arrays and corrupt regex storage safely.
- Persisted individual static-rule enable/disable choices by stable rule ID instead of resetting them on reload.

### Changed

- Replaced the legacy 51-rule prebundled collection with a 12-rule audited safety pack.
- Removed bundled rules that randomized concrete facts or entities, including names, numbers, colours, and locations.
- Converted every bundled rule to an `alternatives` array, eliminating ambiguity from comma-containing legacy random macros.
- Added a semantic invariant, risk rating, and grounded compatibility sentences to every bundled rule.
- Made all bundled static rules disabled by default for explicit review.
- Moved extension activation behind the manifest `activate` hook through a lightweight lifecycle entry point.
- Bumped the extension version to 6.1.0.

### Added

- Pure lifecycle cleanup helpers with idempotence and corrupt-storage handling.
- Static-rule state helpers and regression coverage for stored overrides.
- Regression tests for lifecycle cleanup, legacy ownership markers, manifest hook wiring, AI-output-only placement, and bundled-rule safety.
- GitHub Actions coverage for the Node test suite.

### Upgrade Notes

- On first load, Version 6.1 removes old Prose Polisher global entries and republishes only currently enabled rules.
- Existing user-owned dynamic rules and ordinary extension settings are retained.
- The old static pack is intentionally not migrated; review and enable the new bundled rules individually.
- Ordinary deletion preserves settings for recovery or reinstall. SillyTavern’s clean/delete-data option removes them.

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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_RULE_GENERATION_PROMPT,
    buildRuleGenerationPrompt,
} from '../prompts.js';

test('default prompt names the grammar and meaning invariants', () => {
    for (const requirement of [
        'subject',
        'object',
        'agency',
        'tense',
        'person',
        'number',
        'point of view',
        'negation',
        'certainty',
        'intensity',
        'syntactic role',
        'ambiguity',
    ]) {
        assert.match(DEFAULT_RULE_GENERATION_PROMPT.toLowerCase(), new RegExp(requirement));
    }
    assert.match(DEFAULT_RULE_GENERATION_PROMPT, /REPETITION IS BETTER/);
    assert.match(DEFAULT_RULE_GENERATION_PROMPT, /Do not return replaceString/);
});

test('prompt builder injects candidates and resolves the minimum', () => {
    const prompt = buildRuleGenerationPrompt(
        'Need ${MIN_ALTERNATIVES_PER_RULE} choices.\n{{CANDIDATES}}',
        [{ candidate: 'nodded slowly', enhanced_context: 'She nodded slowly.' }],
        15,
    );

    assert.match(prompt, /Need 15 choices/);
    assert.match(prompt, /"candidate": "nodded slowly"/);
    assert.doesNotMatch(prompt, /\{\{CANDIDATES\}\}/);
});

test('prompt builder appends candidates to custom prompts without a placeholder', () => {
    const prompt = buildRuleGenerationPrompt(
        'Custom safe-generation contract.',
        [{ candidate: 'looked away' }],
        15,
    );

    assert.match(prompt, /^Custom safe-generation contract\./);
    assert.match(prompt, /Candidates:\n\[/);
    assert.match(prompt, /"candidate": "looked away"/);
});

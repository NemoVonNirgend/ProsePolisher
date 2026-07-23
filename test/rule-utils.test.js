import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyRule,
    normalizeRule,
    parseAlternatives,
    previewRule,
    serializeAlternatives,
    validateGeneratedRule,
    validateRule,
} from '../rule-utils.js';

test('modern alternatives preserve commas', () => {
    const rule = normalizeRule({
        scriptName: 'Comma',
        findRegex: 'hello',
        alternatives: ['Well, hello there.', 'Hello again.'],
    });

    assert.deepEqual(parseAlternatives(rule), ['Well, hello there.', 'Hello again.']);
    assert.equal(rule.replaceString, '{{random::Well, hello there.::Hello again.}}');
});

test('legacy comma macros remain readable', () => {
    assert.deepEqual(
        parseAlternatives({ replaceString: '{{random:first,second,third}}' }),
        ['first', 'second', 'third'],
    );
});

test('capture substitution supports two-digit groups', () => {
    const rule = {
        scriptName: 'Captures',
        findRegex: '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)',
        alternatives: ['$10-$1-$&'],
    };

    assert.equal(applyRule('abcdefghij', rule, options => options[0]), 'j-a-abcdefghij');
});

test('preview returns deterministic before and after examples', () => {
    const preview = previewRule('His heart pounded. Her heart pounded.', {
        scriptName: 'Heartbeat',
        findRegex: '([Hh]is|[Hh]er) heart pounded',
        alternatives: ['$1 pulse raced'],
    });

    assert.equal(preview.valid, true);
    assert.equal(preview.examples.length, 2);
    assert.deepEqual(preview.examples[0], {
        before: 'His heart pounded',
        after: 'His pulse raced',
        index: 0,
    });
});

test('validation rejects unsafe delimiters and invalid regex', () => {
    const validation = validateRule({
        scriptName: 'Invalid',
        findRegex: '(',
        alternatives: ['one::two'],
    });

    assert.equal(validation.valid, false);
    assert.equal(validation.errors.length, 2);
});

test('validation rejects empty matches and missing capture groups', () => {
    const emptyMatch = validateRule({
        scriptName: 'Empty',
        findRegex: '.*',
        alternatives: ['replacement'],
    });
    const missingCapture = validateRule({
        scriptName: 'Missing capture',
        findRegex: '(word)',
        alternatives: ['$2 replacement'],
    });

    assert.equal(emptyMatch.valid, false);
    assert.match(emptyMatch.errors.join(' '), /empty string/);
    assert.equal(missingCapture.valid, false);
    assert.match(missingCapture.errors.join(' '), /\$2/);
});

test('duplicate alternatives do not satisfy the minimum', () => {
    const validation = validateRule({
        scriptName: 'Duplicates',
        findRegex: 'looked',
        alternatives: ['watched', 'watched', 'observed'],
    }, 3);

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /3 distinct/);
});

test('validation rejects nested macro syntax inside alternatives', () => {
    const validation = validateRule({
        scriptName: 'Nested macro',
        findRegex: 'looked',
        alternatives: ['{{random::watched::observed}}'],
    });

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /macro delimiters/);
});

test('serializer uses the current SillyTavern double-colon syntax', () => {
    assert.equal(
        serializeAlternatives(['first', 'second, with punctuation']),
        '{{random::first::second, with punctuation}}',
    );
});

test('generated rules require semantic and compatibility evidence', () => {
    const validation = validateGeneratedRule({
        scriptName: 'Look',
        findRegex: '([Hh]e|[Ss]he) looked away',
        alternatives: ['$1 turned away', '$1 shifted $1 gaze aside'],
        semanticInvariant: 'The subject redirects their gaze away.',
        testCases: [
            'He looked away before answering.',
            'For a moment, she looked away.',
            'She looked away, then folded the letter.',
        ],
        risk: 'low',
    }, 2);

    assert.equal(validation.valid, true);
});

test('high-risk generated rules are rejected', () => {
    const validation = validateGeneratedRule({
        scriptName: 'Emotion',
        findRegex: 'looked',
        alternatives: ['glared'],
        semanticInvariant: 'The subject directs their gaze.',
        testCases: ['He looked at her.', 'She looked down.', 'They looked outside.'],
        risk: 'high',
    });

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /High-risk/);
});

test('generated rules require complete compatibility sentences', () => {
    const validation = validateGeneratedRule({
        scriptName: 'Slow nod',
        findRegex: 'nodded slowly',
        alternatives: ['gave a slow nod'],
        semanticInvariant: 'The subject performs a slow nod without inferred agreement.',
        testCases: ['She nodded slowly', 'He nodded slowly.', 'They nodded slowly.'],
        risk: 'low',
    });

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /complete sentences/);
});

test('generated alternatives cannot add punctuation outside the match', () => {
    const validation = validateGeneratedRule({
        scriptName: 'Slow nod',
        findRegex: 'nodded slowly',
        alternatives: ['gave a slow nod.'],
        semanticInvariant: 'The subject performs a slow nod without inferred agreement.',
        testCases: [
            'She nodded slowly before leaving.',
            'He nodded slowly, then waited.',
            'They nodded slowly at the warning.',
        ],
        risk: 'low',
    });

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /terminal punctuation/);
});

test('generated compatibility tests must come from supplied chat context', () => {
    const suppliedContexts = [
        'She nodded slowly before leaving.',
        'He nodded slowly, then waited.',
        'They nodded slowly at the warning.',
    ];
    const validation = validateGeneratedRule({
        scriptName: 'Slow nod',
        findRegex: 'nodded slowly',
        alternatives: ['gave a slow nod'],
        semanticInvariant: 'The subject performs a slow nod without inferred agreement.',
        testCases: [
            suppliedContexts[0],
            suppliedContexts[1],
            'Mara nodded slowly beside the window.',
        ],
        risk: 'low',
    }, 1, suppliedContexts);

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /not found in the supplied chat context/);
});

test('preview warns when a rule has no grounded matches', () => {
    const preview = previewRule('She watched the doorway.', {
        scriptName: 'Slow nod',
        findRegex: 'nodded slowly',
        alternatives: ['gave a slow nod'],
    });

    assert.equal(preview.valid, true);
    assert.equal(preview.examples.length, 0);
    assert.match(preview.warnings.join(' '), /did not match/);
});

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

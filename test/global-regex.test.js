import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PROSE_POLISHER_RULE_PREFIX,
    buildGlobalRegexRule,
    isProsePolisherGlobalRegexRule,
    removeProsePolisherGlobalRegexRules,
    syncGlobalRegexRules,
} from '../global-regex.js';

test('global rules use modern random macro serialization', () => {
    const globalRule = buildGlobalRegexRule({
        id: 'dynamic-1',
        scriptName: 'Greeting',
        findRegex: 'hello',
        alternatives: ['Well, hello.', 'Hello again.'],
    });

    assert.equal(globalRule.replaceString, '{{random::Well, hello.::Hello again.}}');
    assert.equal(globalRule.id, `${PROSE_POLISHER_RULE_PREFIX}dynamic-1`);
    assert.deepEqual(globalRule.placement, [2]);
});

test('synchronization preserves unrelated rules and replaces old Prose Polisher rules', () => {
    const result = syncGlobalRegexRules(
        [
            { id: 'unrelated', scriptName: 'Keep Me' },
            { id: `${PROSE_POLISHER_RULE_PREFIX}old`, scriptName: '(PP) Old' },
        ],
        [
            {
                id: 'new',
                scriptName: 'New',
                findRegex: 'old',
                alternatives: ['new'],
                disabled: false,
            },
            {
                id: 'disabled',
                scriptName: 'Disabled',
                findRegex: 'x',
                alternatives: ['y'],
                disabled: true,
            },
        ],
        true,
    );

    assert.deepEqual(result.map(rule => rule.id), [
        'unrelated',
        `${PROSE_POLISHER_RULE_PREFIX}new`,
    ]);
});

test('disabling integration removes only Prose Polisher rules', () => {
    const result = syncGlobalRegexRules(
        [
            { id: 'unrelated' },
            { id: `${PROSE_POLISHER_RULE_PREFIX}old` },
        ],
        [],
        false,
    );

    assert.deepEqual(result, [{ id: 'unrelated' }]);
});

test('ownership detection catches current IDs and legacy display-name-only rules', () => {
    assert.equal(
        isProsePolisherGlobalRegexRule({ id: `${PROSE_POLISHER_RULE_PREFIX}owned` }),
        true,
    );
    assert.equal(isProsePolisherGlobalRegexRule({ scriptName: '(PP) Legacy' }), true);
    assert.equal(isProsePolisherGlobalRegexRule({ scriptName: '(PP)' }), true);
    assert.equal(isProsePolisherGlobalRegexRule({ scriptName: '(PPP) Unrelated' }), false);
    assert.equal(isProsePolisherGlobalRegexRule({ id: 'other', scriptName: 'Keep Me' }), false);
});

test('cleanup removes current and legacy owned rules without mutating the source array', () => {
    const source = [
        { id: 'unrelated', scriptName: 'Keep Me' },
        { id: `${PROSE_POLISHER_RULE_PREFIX}current`, scriptName: '(PP) Current' },
        { id: 'legacy-without-owned-id', scriptName: '(PP) Legacy' },
    ];
    const before = structuredClone(source);

    const result = removeProsePolisherGlobalRegexRules(source);

    assert.deepEqual(result, [{ id: 'unrelated', scriptName: 'Keep Me' }]);
    assert.deepEqual(source, before);
});

test('global rule construction uses stable fallbacks without mutating source rules', () => {
    const source = {
        scriptName: 'Slow Nod',
        findRegex: 'nodded slowly',
        alternatives: ['gave a slow nod', 'nodded at a measured pace'],
    };
    const before = structuredClone(source);
    const result = buildGlobalRegexRule(source);

    assert.equal(result.id, `${PROSE_POLISHER_RULE_PREFIX}Slow_Nod`);
    assert.equal(result.scriptName, '(PP) Slow Nod');
    assert.equal(result.promptOnly, true);
    assert.equal(result.markdownOnly, true);
    assert.deepEqual(source, before);
});

test('synchronization accepts missing rule arrays', () => {
    const result = syncGlobalRegexRules(undefined, undefined, true);
    assert.deepEqual(result, []);
});

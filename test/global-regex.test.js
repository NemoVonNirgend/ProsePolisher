import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PROSE_POLISHER_RULE_PREFIX,
    buildGlobalRegexRule,
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

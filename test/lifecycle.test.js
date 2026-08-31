import test from 'node:test';
import assert from 'node:assert/strict';
import { PROSE_POLISHER_RULE_PREFIX } from '../global-regex.js';
import {
    PROSE_POLISHER_EXTENSION_NAME,
    cleanupProsePolisherState,
} from '../lifecycle.js';

test('disable/delete cleanup removes only owned global regex rules', () => {
    const settings = {
        regex: [
            { id: 'keep', scriptName: 'Keep Me' },
            { id: `${PROSE_POLISHER_RULE_PREFIX}current`, scriptName: '(PP) Current' },
            { id: 'legacy', scriptName: '(PP) Legacy' },
        ],
        [PROSE_POLISHER_EXTENSION_NAME]: { dynamicRules: [{ id: 'user-rule' }] },
    };

    const result = cleanupProsePolisherState(settings);

    assert.deepEqual(settings.regex, [{ id: 'keep', scriptName: 'Keep Me' }]);
    assert.deepEqual(
        settings[PROSE_POLISHER_EXTENSION_NAME],
        { dynamicRules: [{ id: 'user-rule' }] },
    );
    assert.deepEqual(result, {
        changed: true,
        removedRuleCount: 2,
        removedExtensionSettings: false,
    });
});

test('clean cleanup optionally removes extension-owned settings', () => {
    const settings = {
        regex: [],
        [PROSE_POLISHER_EXTENSION_NAME]: { dynamicRules: [] },
    };

    const result = cleanupProsePolisherState(settings, { removeExtensionSettings: true });

    assert.equal(Object.hasOwn(settings, PROSE_POLISHER_EXTENSION_NAME), false);
    assert.deepEqual(result, {
        changed: true,
        removedRuleCount: 0,
        removedExtensionSettings: true,
    });
});

test('cleanup is idempotent', () => {
    const settings = { regex: [{ id: 'keep' }] };

    const first = cleanupProsePolisherState(settings);
    const second = cleanupProsePolisherState(settings);

    assert.deepEqual(first, {
        changed: false,
        removedRuleCount: 0,
        removedExtensionSettings: false,
    });
    assert.deepEqual(second, first);
    assert.deepEqual(settings.regex, [{ id: 'keep' }]);
});

test('cleanup normalizes a corrupt regex collection without throwing', () => {
    const settings = { regex: 'invalid' };
    const result = cleanupProsePolisherState(settings);

    assert.deepEqual(settings.regex, []);
    assert.deepEqual(result, {
        changed: true,
        removedRuleCount: 0,
        removedExtensionSettings: false,
    });
});

test('cleanup safely ignores an invalid settings root', () => {
    assert.deepEqual(cleanupProsePolisherState(null), {
        changed: false,
        removedRuleCount: 0,
        removedExtensionSettings: false,
    });
});

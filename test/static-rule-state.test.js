import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStaticRuleStates,
    normalizeStaticRuleStates,
    updateStaticRuleState,
} from '../static-rule-state.js';

test('stored static rule states override bundle defaults by stable ID', () => {
    const rules = [
        { id: 'STATIC_SAFE_001', disabled: true },
        { id: 'STATIC_SAFE_002', disabled: true },
    ];

    applyStaticRuleStates(rules, {
        STATIC_SAFE_001: false,
        removed_rule: false,
    });

    assert.deepEqual(rules, [
        { id: 'STATIC_SAFE_001', disabled: false },
        { id: 'STATIC_SAFE_002', disabled: true },
    ]);
});

test('updating a static rule state is immutable and boolean-normalized', () => {
    const source = { STATIC_SAFE_001: true };
    const result = updateStaticRuleState(source, {
        id: 'STATIC_SAFE_002',
        disabled: 0,
    });

    assert.deepEqual(source, { STATIC_SAFE_001: true });
    assert.deepEqual(result, {
        STATIC_SAFE_001: true,
        STATIC_SAFE_002: false,
    });
});

test('state normalization rejects arrays and corrupt values', () => {
    assert.deepEqual(normalizeStaticRuleStates(null), {});
    assert.deepEqual(normalizeStaticRuleStates(['bad']), {});
    assert.deepEqual(
        normalizeStaticRuleStates({ STATIC_SAFE_001: 1, '': false }),
        { STATIC_SAFE_001: true },
    );
});

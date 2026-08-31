import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRule, parseAlternatives, validateRule } from '../rule-utils.js';

const staticRules = JSON.parse(
    await readFile(new URL('../regex_rules.json', import.meta.url), 'utf8'),
);

test('bundled static rule pack is review-first and uses stable unique IDs', () => {
    assert.ok(staticRules.length > 0);

    const ids = new Set();
    for (const rule of staticRules) {
        assert.match(rule.id, /^STATIC_SAFE_\d{3}$/);
        assert.equal(ids.has(rule.id), false, `Duplicate bundled rule ID: ${rule.id}`);
        ids.add(rule.id);

        assert.equal(rule.isStatic, true, `${rule.id} must be marked static`);
        assert.equal(rule.disabled, true, `${rule.id} must be disabled for review`);
        assert.ok(
            ['low', 'medium'].includes(rule.risk),
            `${rule.id} must declare a low or medium risk`,
        );
        assert.ok(
            typeof rule.semanticInvariant === 'string' && rule.semanticInvariant.length >= 40,
            `${rule.id} needs a precise semantic invariant`,
        );
    }
});

test('bundled static rules use unambiguous alternatives arrays and validate', () => {
    for (const rule of staticRules) {
        assert.equal(Object.hasOwn(rule, 'replaceString'), false, `${rule.id} uses legacy replaceString`);
        assert.ok(Array.isArray(rule.alternatives), `${rule.id} needs an alternatives array`);
        assert.ok(rule.alternatives.length >= 3, `${rule.id} needs at least three alternatives`);

        const validation = validateRule(rule, 3);
        assert.equal(
            validation.valid,
            true,
            `${rule.id} failed validation: ${validation.errors.join(' ')}`,
        );
        assert.deepEqual(parseAlternatives(rule), rule.alternatives);
    }
});

test('every bundled test case matches and every alternative substitutes cleanly', () => {
    for (const rule of staticRules) {
        assert.ok(Array.isArray(rule.testCases) && rule.testCases.length >= 3);

        const regex = new RegExp(rule.findRegex, 'i');
        for (const testCase of rule.testCases) {
            assert.match(testCase, regex, `${rule.id} did not match: ${testCase}`);

            for (const alternative of rule.alternatives) {
                const result = applyRule(testCase, rule, () => alternative);
                assert.notEqual(result, testCase, `${rule.id} did not replace: ${alternative}`);
                assert.doesNotMatch(
                    result,
                    /\$(?:\d{1,2}|&)/,
                    `${rule.id} left a capture token: ${alternative}`,
                );

                if (/^[A-Z]/.test(testCase)) {
                    assert.match(
                        result,
                        /^[A-Z]/,
                        `${rule.id} lost sentence-initial capitalization: ${alternative}`,
                    );
                }
            }
        }
    }
});

test('bundled pack contains no entity or fact randomizers', () => {
    const names = staticRules.map(rule => rule.scriptName).join('\n');

    assert.doesNotMatch(names, /\brandomi[sz]e\b/i);
    assert.doesNotMatch(names, /\b(?:name|location|number|colour|color)\b/i);
});

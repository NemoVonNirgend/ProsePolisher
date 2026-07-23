import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings.js';

test('settings normalization fills Prose Polisher defaults', () => {
    const settings = normalizeSettings({});

    assert.equal(settings.isStaticEnabled, true);
    assert.equal(settings.dynamicTriggerCount, 30);
    assert.deepEqual(settings.blacklist, DEFAULT_SETTINGS.blacklist);
});

test('settings normalization preserves user values and legacy migration data', () => {
    const dynamicRules = [{ id: 'custom-rule' }];
    const settings = normalizeSettings({
        isStaticEnabled: false,
        dynamicRules,
        gremlinWriterModel: 'custom-model',
        gremlinWriterChaosOptions: [{ id: 'legacy-option' }],
        blacklist: { custom: 7 },
    });

    assert.equal(settings.isStaticEnabled, false);
    assert.equal(settings.dynamicRules, dynamicRules);
    assert.equal(settings.gremlinWriterModel, 'custom-model');
    assert.deepEqual(settings.gremlinWriterChaosOptions, [{ id: 'legacy-option' }]);
    assert.equal(settings.blacklist.custom, 7);
    assert.equal(settings.blacklist.ozone, 3);
});

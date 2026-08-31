import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(
    await readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
);
const entrySource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('manifest activates through the lifecycle entry point', () => {
    assert.equal(manifest.version, '6.1.0');
    assert.equal(manifest.js, 'index.js');
    assert.deepEqual(manifest.hooks, {
        activate: 'init',
        disable: 'onDisable',
        clean: 'onClean',
        delete: 'onDelete',
    });
});

test('every declared lifecycle hook is exported by the entry point', () => {
    for (const functionName of Object.values(manifest.hooks)) {
        assert.match(
            entrySource,
            new RegExp(`export async function ${functionName}\\s*\\(`),
            `Missing lifecycle export: ${functionName}`,
        );
    }
});

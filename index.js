import { saveSettings } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { cleanupProsePolisherState } from './lifecycle.js';

const LOG_PREFIX = '[ProsePolisher]';
let activationPromise = null;

export async function init() {
    activationPromise ??= import('./content.js');
    await activationPromise;
}

async function persistCleanup(options = {}) {
    const result = cleanupProsePolisherState(extension_settings, options);

    if (result.changed) {
        await saveSettings();
    }

    if (result.removedRuleCount > 0) {
        console.info(
            `${LOG_PREFIX} Removed ${result.removedRuleCount} owned global regex `
            + `rule${result.removedRuleCount === 1 ? '' : 's'}.`,
        );
    }

    return result;
}

export async function onDisable() {
    await persistCleanup();
}

export async function onDelete() {
    await persistCleanup();
}

export async function onClean() {
    await persistCleanup({ removeExtensionSettings: true });
}

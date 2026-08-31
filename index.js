import { saveSettings } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import {
    cleanupProsePolisherState,
    isProsePolisherExtensionDisabled,
} from './lifecycle.js';

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

// Current SillyTavern calls init through the manifest activate hook. Older
// clients still load the manifest JS entry directly, so self-start only when
// this extension is active. A disabled extension imported for deletion remains inert.
if (!isProsePolisherExtensionDisabled(extension_settings.disabledExtensions)) {
    void init();
}

import { removeProsePolisherGlobalRegexRules } from './global-regex.js';

export const PROSE_POLISHER_EXTENSION_NAME = 'ProsePolisher';

export function isProsePolisherExtensionDisabled(disabledExtensions) {
    if (!Array.isArray(disabledExtensions)) return false;

    return disabledExtensions.some(name =>
        typeof name === 'string'
        && (name === PROSE_POLISHER_EXTENSION_NAME
            || name.endsWith(`/${PROSE_POLISHER_EXTENSION_NAME}`)),
    );
}

export function cleanupProsePolisherState(
    settingsRoot,
    { removeExtensionSettings = false } = {},
) {
    if (!settingsRoot || typeof settingsRoot !== 'object' || Array.isArray(settingsRoot)) {
        return {
            changed: false,
            removedRuleCount: 0,
            removedExtensionSettings: false,
        };
    }

    const existingRules = Array.isArray(settingsRoot.regex) ? settingsRoot.regex : [];
    const cleanedRules = removeProsePolisherGlobalRegexRules(existingRules);
    const regexWasInvalid = !Array.isArray(settingsRoot.regex);
    const removedRuleCount = existingRules.length - cleanedRules.length;

    if (regexWasInvalid || removedRuleCount > 0) {
        settingsRoot.regex = cleanedRules;
    }

    const hadExtensionSettings = Object.hasOwn(settingsRoot, PROSE_POLISHER_EXTENSION_NAME);
    if (removeExtensionSettings && hadExtensionSettings) {
        delete settingsRoot[PROSE_POLISHER_EXTENSION_NAME];
    }

    const removedExtensionSettings = removeExtensionSettings && hadExtensionSettings;

    return {
        changed: regexWasInvalid || removedRuleCount > 0 || removedExtensionSettings,
        removedRuleCount,
        removedExtensionSettings,
    };
}

import { normalizeRule } from './rule-utils.js';

export const PROSE_POLISHER_RULE_PREFIX = '_prosePolisherRule_';

export function buildGlobalRegexRule(rule) {
    const normalized = normalizeRule(rule);
    const fallbackId = String(rule.scriptName || 'unnamed').replace(/\s+/g, '_');

    return {
        id: `${PROSE_POLISHER_RULE_PREFIX}${rule.id || fallbackId}`,
        scriptName: `(PP) ${rule.scriptName || 'Unnamed Rule'}`,
        findRegex: rule.findRegex,
        replaceString: normalized.replaceString,
        disabled: Boolean(rule.disabled),
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
        trimStrings: [],
        placement: [0, 2, 3, 5, 6],
        runOnEdit: false,
        markdownOnly: true,
        promptOnly: true,
    };
}

export function syncGlobalRegexRules(globalRules, proseRules, enabled) {
    const withoutProsePolisher = (globalRules || []).filter(
        rule => !rule.id?.startsWith(PROSE_POLISHER_RULE_PREFIX),
    );

    if (!enabled) return withoutProsePolisher;

    return [
        ...withoutProsePolisher,
        ...proseRules
            .filter(rule => !rule.disabled)
            .map(buildGlobalRegexRule),
    ];
}

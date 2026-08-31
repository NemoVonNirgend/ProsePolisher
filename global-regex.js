import { normalizeRule } from './rule-utils.js';

export const PROSE_POLISHER_RULE_PREFIX = '_prosePolisherRule_';
export const PROSE_POLISHER_SCRIPT_PREFIX = '(PP)';
const AI_OUTPUT_PLACEMENT = 2;

export function isProsePolisherGlobalRegexRule(rule) {
    const id = typeof rule?.id === 'string' ? rule.id : '';
    const scriptName = typeof rule?.scriptName === 'string' ? rule.scriptName.trim() : '';

    return id.startsWith(PROSE_POLISHER_RULE_PREFIX)
        || scriptName === PROSE_POLISHER_SCRIPT_PREFIX
        || scriptName.startsWith(`${PROSE_POLISHER_SCRIPT_PREFIX} `);
}

export function removeProsePolisherGlobalRegexRules(globalRules) {
    if (!Array.isArray(globalRules)) return [];

    return globalRules.filter(rule => !isProsePolisherGlobalRegexRule(rule));
}

export function buildGlobalRegexRule(rule) {
    const normalized = normalizeRule(rule);
    const fallbackId = String(rule.scriptName || 'unnamed').replace(/\s+/g, '_');

    return {
        id: `${PROSE_POLISHER_RULE_PREFIX}${rule.id || fallbackId}`,
        scriptName: `${PROSE_POLISHER_SCRIPT_PREFIX} ${rule.scriptName || 'Unnamed Rule'}`,
        findRegex: rule.findRegex,
        replaceString: normalized.replaceString,
        disabled: Boolean(rule.disabled),
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
        trimStrings: [],
        placement: [AI_OUTPUT_PLACEMENT],
        runOnEdit: false,
        markdownOnly: true,
        promptOnly: true,
    };
}

export function syncGlobalRegexRules(globalRules, proseRules, enabled) {
    const withoutProsePolisher = removeProsePolisherGlobalRegexRules(globalRules);

    if (!enabled) return withoutProsePolisher;

    return [
        ...withoutProsePolisher,
        ...(Array.isArray(proseRules) ? proseRules : [])
            .filter(rule => !rule.disabled)
            .map(buildGlobalRegexRule),
    ];
}

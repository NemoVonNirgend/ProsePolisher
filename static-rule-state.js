export function normalizeStaticRuleStates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .filter(([id]) => typeof id === 'string' && id.length > 0)
            .map(([id, disabled]) => [id, Boolean(disabled)]),
    );
}

export function applyStaticRuleStates(rules, storedStates) {
    if (!Array.isArray(rules)) return [];

    const states = normalizeStaticRuleStates(storedStates);
    for (const rule of rules) {
        if (!rule?.id || !Object.hasOwn(states, rule.id)) continue;
        rule.disabled = states[rule.id];
    }

    return rules;
}

export function updateStaticRuleState(storedStates, rule) {
    const states = normalizeStaticRuleStates(storedStates);
    if (!rule?.id) return states;

    return {
        ...states,
        [rule.id]: Boolean(rule.disabled),
    };
}

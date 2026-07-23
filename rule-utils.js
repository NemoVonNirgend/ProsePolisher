const LEGACY_RANDOM_PATTERN = /^\{\{random:([\s\S]*?)\}\}$/i;
const MODERN_RANDOM_PATTERN = /^\{\{random::([\s\S]*?)\}\}$/i;

export function parseAlternatives(rule) {
    if (Array.isArray(rule?.alternatives)) {
        return rule.alternatives.map(String).map(value => value.trim()).filter(Boolean);
    }

    const replacement = String(rule?.replaceString ?? '').trim();
    const modern = replacement.match(MODERN_RANDOM_PATTERN);
    if (modern) {
        return modern[1].split('::').map(value => value.trim()).filter(Boolean);
    }

    const legacy = replacement.match(LEGACY_RANDOM_PATTERN);
    if (legacy) {
        return legacy[1].split(',').map(value => value.trim()).filter(Boolean);
    }

    return replacement ? [replacement] : [];
}

export function serializeAlternatives(alternatives) {
    const values = alternatives.map(String).map(value => value.trim()).filter(Boolean);
    return `{{random::${values.join('::')}}}`;
}

export function normalizeRule(rule) {
    const alternatives = parseAlternatives(rule);
    return {
        ...rule,
        alternatives,
        replaceString: alternatives.length > 1
            ? serializeAlternatives(alternatives)
            : alternatives[0] ?? '',
    };
}

export function validateRule(rule, minimumAlternatives = 1) {
    const errors = [];
    const warnings = [];
    let regex = null;

    try {
        regex = new RegExp(rule?.findRegex, 'gi');
    } catch (error) {
        errors.push(`Invalid regular expression: ${error.message}`);
    }

    const alternatives = parseAlternatives(rule);
    if (alternatives.length < minimumAlternatives) {
        errors.push(`Expected at least ${minimumAlternatives} replacement alternatives; found ${alternatives.length}.`);
    }
    if (alternatives.some(value => value.includes('::'))) {
        errors.push('Replacement alternatives cannot contain the `::` macro delimiter.');
    }
    if (new Set(alternatives).size !== alternatives.length) {
        warnings.push('Duplicate replacement alternatives were found.');
    }
    if (!rule?.scriptName?.trim()) {
        warnings.push('The rule has no descriptive name.');
    }

    return { valid: errors.length === 0, errors, warnings, regex, alternatives };
}

export function validateGeneratedRule(rule, minimumAlternatives = 1) {
    const validation = validateRule(rule, minimumAlternatives);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const testCases = Array.isArray(rule?.testCases)
        ? rule.testCases.map(String).map(value => value.trim()).filter(Boolean)
        : [];

    if (!rule?.semanticInvariant?.trim()) {
        errors.push('Generated rules must state their semantic invariant.');
    }
    if (rule?.risk === 'high') {
        errors.push('High-risk generated rules are not accepted.');
    } else if (!['low', 'medium'].includes(rule?.risk)) {
        errors.push('Generated rules must declare a low or medium risk.');
    }
    if (testCases.length < 3) {
        errors.push(`Generated rules require at least 3 compatibility test cases; found ${testCases.length}.`);
    }

    if (validation.regex) {
        for (const testCase of testCases) {
            validation.regex.lastIndex = 0;
            if (!validation.regex.test(testCase)) {
                errors.push(`Regex did not match compatibility test: "${testCase}"`);
                continue;
            }

            for (const alternative of validation.alternatives) {
                const result = applyRule(testCase, rule, () => alternative);
                if (result === testCase) {
                    errors.push(`Alternative did not replace the compatibility test: "${alternative}"`);
                    break;
                }
                if (/\$\d{1,2}|\$&/.test(result)) {
                    errors.push(`Alternative left an unresolved capture token: "${alternative}"`);
                    break;
                }
            }
        }
    }

    return {
        ...validation,
        valid: errors.length === 0,
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
        testCases,
    };
}

function substituteCaptures(template, match, captures) {
    return template
        .replace(/\$&/g, match)
        .replace(/\$(\d{1,2})/g, (_, index) => captures[Number(index) - 1] ?? '');
}

export function applyRule(text, rule, choose = alternatives => alternatives[Math.floor(Math.random() * alternatives.length)]) {
    const validation = validateRule(rule);
    if (!validation.valid || !text) return text;

    return text.replace(validation.regex, (match, ...args) => {
        const captures = args.slice(0, -2);
        return substituteCaptures(choose(validation.alternatives), match, captures);
    });
}

export function previewRule(text, rule, limit = 5) {
    const validation = validateRule(rule);
    if (!validation.valid || !text) {
        return { ...validation, examples: [] };
    }

    const examples = [];
    const previewRegex = new RegExp(validation.regex.source, validation.regex.flags);
    let match;

    while ((match = previewRegex.exec(text)) && examples.length < limit) {
        const replacement = substituteCaptures(
            validation.alternatives[0],
            match[0],
            match.slice(1),
        );
        examples.push({
            before: match[0],
            after: replacement,
            index: match.index,
        });
        if (match[0] === '') previewRegex.lastIndex += 1;
    }

    return { ...validation, examples };
}

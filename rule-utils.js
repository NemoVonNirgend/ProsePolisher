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

function countCapturingGroups(source = '') {
    let count = 0;
    let escaped = false;
    let inCharacterClass = false;

    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '[') {
            inCharacterClass = true;
            continue;
        }
        if (character === ']') {
            inCharacterClass = false;
            continue;
        }
        if (character !== '(' || inCharacterClass) continue;

        if (source[index + 1] !== '?') {
            count++;
            continue;
        }

        const namedCapturePrefix = source.slice(index, index + 3) === '(?<';
        const lookbehind = ['=', '!'].includes(source[index + 3]);
        if (namedCapturePrefix && !lookbehind) count++;
    }

    return count;
}

function referencedCaptureGroups(alternatives) {
    return alternatives.flatMap(alternative =>
        [...alternative.matchAll(/\$(\d{1,2})/g)].map(match => Number(match[1])),
    );
}

export function validateRule(rule, minimumAlternatives = 1) {
    const errors = [];
    const warnings = [];
    let regex = null;

    if (!rule?.findRegex?.trim()) {
        errors.push('A non-empty regular expression is required.');
    } else {
        try {
            regex = new RegExp(rule.findRegex, 'gi');
            if (regex.test('')) {
                errors.push('The regular expression must not match an empty string.');
            }
            regex.lastIndex = 0;
        } catch (error) {
            errors.push(`Invalid regular expression: ${error.message}`);
        }
    }

    const alternatives = parseAlternatives(rule);
    if (alternatives.length < minimumAlternatives) {
        errors.push(`Expected at least ${minimumAlternatives} replacement alternatives; found ${alternatives.length}.`);
    }
    const uniqueAlternatives = new Set(alternatives);
    if (uniqueAlternatives.size < minimumAlternatives) {
        errors.push(`Expected at least ${minimumAlternatives} distinct replacement alternatives; found ${uniqueAlternatives.size}.`);
    }
    if (alternatives.some(value => value.includes('::') || value.includes('{{') || value.includes('}}'))) {
        errors.push('Replacement alternatives cannot contain SillyTavern macro delimiters.');
    }
    if (uniqueAlternatives.size !== alternatives.length) {
        warnings.push('Duplicate replacement alternatives were found.');
    }
    if (alternatives.some(value => value !== value.trim())) {
        warnings.push('Replacement alternatives should not begin or end with whitespace.');
    }
    if (!rule?.scriptName?.trim()) {
        warnings.push('The rule has no descriptive name.');
    }

    const captureCount = countCapturingGroups(rule?.findRegex);
    const invalidReferences = referencedCaptureGroups(alternatives)
        .filter(index => index === 0 || index > captureCount);
    if (invalidReferences.length > 0) {
        errors.push(
            `Replacement alternatives reference capture groups not provided by the regex: ${[
                ...new Set(invalidReferences.map(index => `$${index}`)),
            ].join(', ')}.`,
        );
    }

    return { valid: errors.length === 0, errors, warnings, regex, alternatives };
}

export function validateGeneratedRule(rule, minimumAlternatives = 1, groundedContexts = []) {
    const validation = validateRule(rule, minimumAlternatives);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const testCases = Array.isArray(rule?.testCases)
        ? rule.testCases.map(String).map(value => value.trim()).filter(Boolean)
        : [];

    if (!rule?.semanticInvariant?.trim()) {
        errors.push('Generated rules must state their semantic invariant.');
    } else if (rule.semanticInvariant.trim().length < 20) {
        errors.push('The semantic invariant is too vague to review safely.');
    }
    if (rule?.risk === 'high') {
        errors.push('High-risk generated rules are not accepted.');
    } else if (!['low', 'medium'].includes(rule?.risk)) {
        errors.push('Generated rules must declare a low or medium risk.');
    }
    if (testCases.length < 3) {
        errors.push(`Generated rules require at least 3 compatibility test cases; found ${testCases.length}.`);
    }
    if (testCases.some(testCase => !/[.!?]["')\]]?$/.test(testCase))) {
        errors.push('Generated compatibility tests must be complete sentences with terminal punctuation.');
    }
    const normalizedContexts = groundedContexts
        .map(context => String(context).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    if (normalizedContexts.length > 0) {
        for (const testCase of testCases) {
            const normalizedTest = testCase.replace(/\s+/g, ' ').trim();
            if (!normalizedContexts.some(context => context.includes(normalizedTest))) {
                errors.push(`Compatibility test was not found in the supplied chat context: "${testCase}"`);
            }
        }
    }

    if (validation.regex) {
        for (const testCase of testCases) {
            validation.regex.lastIndex = 0;
            const match = validation.regex.exec(testCase);
            if (!match) {
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
                const addsTerminalPunctuation = /[.!?]["')\]]?$/.test(alternative) &&
                    !/[.!?]["')\]]?$/.test(match[0]);
                if (addsTerminalPunctuation) {
                    errors.push(`Alternative adds terminal punctuation not consumed by the regex: "${alternative}"`);
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

    const warnings = [...validation.warnings];
    if (examples.length === 0) {
        warnings.push('The rule did not match the supplied preview text.');
    }

    return { ...validation, warnings, examples };
}

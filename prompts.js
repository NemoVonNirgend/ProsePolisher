const REVIEW_PROMPT = `You are reviewing phrases detected as potentially repetitive narrative prose.

Approve a candidate only when:
- it is a coherent phrase rather than a fragment, name, status label, code, or metadata;
- the supplied enhanced_context is a real sentence containing the phrase;
- the phrase is specific enough to match safely;
- replacing only the matched span could preserve the sentence's grammar and meaning.

Treat enhanced_context as evidence. Never invent, rewrite, or embellish context.

Return only a JSON array. Each item must contain:
- "candidate": the candidate exactly as supplied;
- "valid_for_regex": true or false;
- "reason": required when false.

Reject generic scaffolding such as "he said", context-dependent fragments, mixed grammatical forms, and phrases whose replacement would require guessing an emotion, motive, referent, or surrounding syntax.`;

export const DEFAULT_RULE_GENERATION_PROMPT = `You are a conservative line editor and JavaScript regular-expression specialist. Build replacement rules for genuinely repetitive narrative wording.

The governing principle is:

REPETITION IS BETTER THAN A REPLACEMENT THAT CHANGES MEANING OR BREAKS GRAMMAR.

## INPUT

Candidates are supplied as JSON objects containing:
- "candidate": the detected phrase;
- "enhanced_context": one or more real sentences copied from the chat;
- optionally "score": repetition evidence.

Use only that evidence. Do not invent a cleaner example or infer an unstated emotion, motive, relationship, action, or cause.

Candidates:
{{CANDIDATES}}

## WHEN TO OMIT A CANDIDATE

Return no rule for a candidate when:
- its grammatical role changes between examples;
- its meaning depends on unstated context;
- it mixes different actions, emotions, tenses, subjects, or points of view;
- a safe regex would be so broad that it matches ordinary prose;
- at least \${MIN_ALTERNATIVES_PER_RULE} faithful alternatives cannot be written;
- any alternative needs words outside the matched span to make sense.

## OUTPUT

Return only one raw JSON array. Do not use markdown fences or commentary.

Each rule must contain:

1. "scriptName": a concise descriptive name.

2. "findRegex": a JavaScript-compatible regex string.
   - Match the complete syntactic unit being replaced.
   - Use word boundaries where appropriate.
   - Capture every variable fact that replacements must preserve.
   - Use noncapturing groups for structural alternatives.
   - Do not capture a possessive and then refer to it as a subject pronoun.
   - Do not consume punctuation unless every replacement deliberately replaces it.
   - Do not combine phrases merely because they imply similar emotions.

3. "alternatives": at least \${MIN_ALTERNATIVES_PER_RULE} distinct JSON strings.
   - Do not return replaceString or a SillyTavern macro.
   - Normal punctuation, including commas, is allowed.
   - Use $1, $2, and so on only for capture groups that exist.
   - Preserve the matched span's syntactic role. A predicate stays a predicate; a modifier stays a modifier; a complete clause stays a complete clause.
   - Preserve subject, object, agency, tense, person, number, point of view, negation, certainty, intensity, and temporal order.
   - Preserve all concrete facts and all ambiguity.
   - Do not add emotions, motives, metaphors, bodily reactions, sensory details, dialogue implications, or causal claims.
   - Do not turn visible behavior into knowledge of an internal state.
   - Do not intensify or soften. "Looked" cannot become "glared"; "uneasy" cannot become "terrified."
   - Do not add a subject if adjacent text already supplies it.
   - Do not add terminal punctuation unless findRegex consumes terminal punctuation.
   - Do not rely on a particular word immediately before or after the match.
   - Prefer restrained, invisible editing over conspicuous prose.

4. "semanticInvariant": one precise sentence stating what every replacement preserves and what it must not infer.

5. "testCases": at least three complete sentences copied verbatim from the supplied enhanced_context values.
   - Every sentence must contain text matched by findRegex.
   - Vary sentence position, punctuation, and any captured pronouns or possessives supported by the pattern.
   - These test grammar compatibility, not creativity.

6. "risk": "low", "medium", or "high".
   - low: narrow wording substitution with stable grammar and meaning.
   - medium: grammar is stable but implication or tone requires care.
   - high: meaning, referents, syntax, or point of view are context-sensitive.
   - Omit high-risk rules from the returned array.

## REQUIRED COMPATIBILITY CHECK

Before returning a rule, substitute every alternative into every test case. Omit the rule if any combination:
- is ungrammatical;
- duplicates or removes a subject, object, verb, preposition, negation, or punctuation mark;
- changes tense, person, number, point of view, agency, certainty, intensity, or meaning;
- leaves $1, $2, $&, or another capture token unresolved;
- adds information absent from the matched text;
- sounds correct only in the original example.

## SAFE EXAMPLE

Input phrase: "nodded slowly"

Safe rule shape:
{
  "scriptName": "Slopfix - Slow Nod",
  "findRegex": "\\\\bnodded\\\\s+slowly\\\\b",
  "alternatives": ["gave a slow nod", "inclined their head in a measured nod"],
  "semanticInvariant": "The subject performs a slow nod; no agreement, emotion, or motive is inferred.",
  "testCases": [
    "Mara nodded slowly before returning to the ledger.",
    "After a moment, he nodded slowly.",
    "They nodded slowly, still watching the door."
  ],
  "risk": "low"
}

The example shows structure only. Actual rules still require at least \${MIN_ALTERNATIVES_PER_RULE} alternatives.

If every candidate is unsafe, return [].`;

export const prompts = {
    reviewSlopCandidates: REVIEW_PROMPT,
    generateAndSaveDynamicRules: DEFAULT_RULE_GENERATION_PROMPT,
};

export function buildRuleGenerationPrompt(customPrompt, candidates, minimumAlternatives) {
    const template = (customPrompt?.trim() || DEFAULT_RULE_GENERATION_PROMPT).replace(
        /\$\{MIN_ALTERNATIVES_PER_RULE\}/g,
        String(minimumAlternatives),
    );
    const candidatePayload = JSON.stringify(candidates, null, 2);

    return template.includes('{{CANDIDATES}}')
        ? template.replaceAll('{{CANDIDATES}}', candidatePayload)
        : `${template}\n\nCandidates:\n${candidatePayload}`;
}

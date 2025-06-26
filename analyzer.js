// C:\SillyTavern\public\scripts\extensions\third-party\ProsePolisher\analyzer.js
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { applyGremlinEnvironment, executeGen } from './projectgremlin.js'; // Ensure these are correctly imported

// Import all new and existing data files
import { commonWords } from './common_words.js';
import { defaultNames } from './default_names.js';
import { lemmaMap } from './lemmas.js';

const LOG_PREFIX = `[ProsePolisher:Analyzer]`;

// Constants
const SLOP_THRESHOLD = 3;
const BATCH_SIZE = 15; // Number of final candidates to send to AI for regex generation
const TWINS_PRESCREEN_BATCH_SIZE = 50; // Max number of candidates to send to Twins for pre-screening
const MANUAL_ANALYSIS_CHUNK_SIZE = 20;
const CANDIDATE_LIMIT_FOR_ANALYSIS = 2000;
const PRUNE_AFTER_MESSAGES = 20;
const NGRAM_MIN = 3;
const NGRAM_MAX = 10;
const PATTERN_MIN_COMMON_WORDS = 3;
const MIN_ALTERNATIVES_PER_RULE = 15;


// Utility Functions
function stripMarkup(text) {
    if (!text) return '';
    let cleanText = text;

    cleanText = cleanText.replace(/(?:```|~~~)\w*\s*[\s\S]*?(?:```|~~~)/g, ' ');
    cleanText = cleanText.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    cleanText = cleanText.replace(/(?:\*|_|~|`)+(.+?)(?:\*|_|~|`)+/g, '$1');
    cleanText = cleanText.replace(/"(.*?)"/g, '$1');
    cleanText = cleanText.replace(/\((.*?)\)/g, '$1');
    cleanText = cleanText.trim().replace(/^[\s*]+|[\s*]+$/g, '');
    return cleanText;
}

function generateNgrams(words, n) {
    const ngrams = [];
    if (words.length < n) return ngrams;
    for (let i = 0; i <= words.length - n; i++) {
        ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
}

function cullSubstrings(frequenciesObject) {
    const culledFrequencies = { ...frequenciesObject };
    const sortedPhrases = Object.keys(culledFrequencies).sort((a, b) => b.length - a.length);
    const phrasesToRemove = new Set();
    for (let i = 0; i < sortedPhrases.length; i++) {
        const longerPhrase = sortedPhrases[i];
        if (phrasesToRemove.has(longerPhrase)) continue;
        for (let j = i + 1; j < sortedPhrases.length; j++) {
            const shorterPhrase = sortedPhrases[j];
            if (phrasesToRemove.has(shorterPhrase)) continue;
            if (longerPhrase.includes(shorterPhrase)) {
                phrasesToRemove.add(shorterPhrase);
            }
        }
    }
    phrasesToRemove.forEach(phrase => {
        delete culledFrequencies[phrase];
    });
    return culledFrequencies;
}


// --- Analyzer Class ---
export class Analyzer {
    constructor(settings, callGenericPopup, POPUP_TYPE, toastr, saveSettingsDebounced, compileActiveRules, updateGlobalRegexArrayCallback, compiledRegexes) {
        this.settings = settings;
        this.callGenericPopup = callGenericPopup;
        this.POPUP_TYPE = POPUP_TYPE;
        this.toastr = toastr;
        this.saveSettingsDebounced = saveSettingsDebounced;
        this.compileActiveRules = compileActiveRules;
        this.updateGlobalRegexArrayCallback = updateGlobalRegexArrayCallback;

        this.compiledRegexes = compiledRegexes;

        this.ngramFrequencies = new Map();
        this.slopCandidates = new Set();
        this.analyzedLeaderboardData = { merged: [], remaining: [] };
        this.messageCounterForTrigger = 0;
        this.totalAiMessagesProcessed = 0;
        this.isProcessingAiRules = false;
        this.isAnalyzingHistory = false;

        this.effectiveWhitelist = new Set();
        this.updateEffectiveWhitelist();
    }

    updateEffectiveWhitelist() {
        const userWhitelist = new Set((this.settings.whitelist || []).map(w => w.toLowerCase()));
        this.effectiveWhitelist = new Set([...defaultNames, ...commonWords, ...userWhitelist]);
        console.log(`${LOG_PREFIX} Analyzer effective whitelist updated. Size: ${this.effectiveWhitelist.size}`);
    }

    isPhraseLowQuality(phrase) {
        const words = phrase.toLowerCase().split(' '); // ensure lowercasing for whitelist check

        // Filter 1: Must be at least NGRAM_MIN words long.
        if (words.length < NGRAM_MIN) return true;

        // Filter 2: Must contain at least one non-whitelisted word.
        // If all words in the phrase are on the effective whitelist, it's considered low quality.
        const allWhitelisted = words.every(word => this.effectiveWhitelist.has(word));
        if (allWhitelisted) return true;
        
        return false;
    }

    isPhraseWhitelistedLocal(phrase) { // This is used by the UI/manual checks, not primary analysis filter anymore
        const lowerCasePhrase = phrase.toLowerCase();
        const words = lowerCasePhrase.split(/\s+/).filter(w => w);
        for (const word of words) {
            if (this.effectiveWhitelist.has(word)) {
                return true;
            }
        }
        return false;
    }

    getBlacklistWeight(phrase) {
        const blacklist = this.settings.blacklist || {};
        if (Object.keys(blacklist).length === 0) return 0;
        const lowerCasePhrase = phrase.toLowerCase();
        const words = lowerCasePhrase.split(/\s+/).filter(w => w);
        let maxWeight = 0;
        for (const word of words) {
            if (blacklist[word]) {
                maxWeight = Math.max(maxWeight, blacklist[word]);
            }
        }
        return maxWeight;
    }

    analyzeAndTrackFrequency(text) {
        const cleanText = stripMarkup(text);
        if (!cleanText.trim()) return;

        const chunks = [];
        let lastIndex = 0;
        cleanText.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, (match, quote, offset) => {
            if (offset > lastIndex) {
                chunks.push({ content: cleanText.substring(lastIndex, offset), type: 'narration' });
            }
            chunks.push({ content: match, type: 'dialogue' });
            lastIndex = offset + match.length;
        });
        if (lastIndex < cleanText.length) {
            chunks.push({ content: cleanText.substring(lastIndex), type: 'narration' });
        }

        for (const chunk of chunks) {
            if (!chunk.content.trim()) continue;

            const originalWords = chunk.content.replace(/[.,!?]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
            const lemmatizedWords = originalWords.map(word => lemmaMap.get(word) || word);

            for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
                if (originalWords.length < n) continue;

                const originalNgrams = generateNgrams(originalWords, n);
                const lemmatizedNgrams = generateNgrams(lemmatizedWords, n);

                for (let i = 0; i < originalNgrams.length; i++) {
                    const originalNgram = originalNgrams[i];
                    const lemmatizedNgram = lemmatizedNgrams[i];

                    // Updated filtering logic: removed isPhraseWhitelistedLocal
                    if (this.compiledRegexes.some(regex => regex.test(originalNgram.toLowerCase())) || this.isPhraseLowQuality(originalNgram)) {
                        continue;
                    }

                    const currentData = this.ngramFrequencies.get(lemmatizedNgram) || { count: 0, score: 0, lastSeenMessageIndex: this.totalAiMessagesProcessed, original: originalNgram };

                    let scoreIncrement = 1.0;
                    
                    scoreIncrement += (n - NGRAM_MIN) * 0.2;
                    const uncommonWordCount = originalNgram.split(' ').reduce((count, word) => count + (this.effectiveWhitelist.has(word) ? 0 : 1), 0);
                    scoreIncrement += uncommonWordCount * 0.5;
                    scoreIncrement += this.getBlacklistWeight(originalNgram);
                    if (chunk.type === 'narration') {
                        scoreIncrement *= 1.25;
                    }

                    const newCount = currentData.count + 1;
                    const newScore = currentData.score + scoreIncrement;

                    this.ngramFrequencies.set(lemmatizedNgram, {
                        count: newCount,
                        score: newScore,
                        lastSeenMessageIndex: this.totalAiMessagesProcessed,
                        original: originalNgram, 
                    });

                    if (newScore >= SLOP_THRESHOLD && currentData.score < SLOP_THRESHOLD) { 
                        this.processNewSlopCandidate(lemmatizedNgram);
                    }
                }
            }
        }
    }

    processNewSlopCandidate(newPhraseLemmatized) { 
        let isSubstring = false;
        const phrasesToRemove = []; 
        for (const existingPhraseLemmatized of this.slopCandidates) {
            if (existingPhraseLemmatized.includes(newPhraseLemmatized)) { 
                isSubstring = true;
                break;
            }
            if (newPhraseLemmatized.includes(existingPhraseLemmatized)) { 
                phrasesToRemove.push(existingPhraseLemmatized);
            }
        }
        if (!isSubstring) {
            phrasesToRemove.forEach(phrase => this.slopCandidates.delete(phrase));
            this.slopCandidates.add(newPhraseLemmatized);
        }
    }
    
    pruneOldNgrams() {
        let prunedCount = 0;
        for (const [ngram, data] of this.ngramFrequencies.entries()) {
            if ((this.totalAiMessagesProcessed - data.lastSeenMessageIndex > PRUNE_AFTER_MESSAGES)) {
                if (data.score < SLOP_THRESHOLD) {
                    this.ngramFrequencies.delete(ngram);
                    this.slopCandidates.delete(ngram); 
                    prunedCount++;
                } else {
                    data.score *= 0.9; 
                }
            }
        }
        if (prunedCount > 0) console.log(`${LOG_PREFIX} Pruned ${prunedCount} old/low-score n-grams.`);
    }

    pruneDuringManualAnalysis() {
        let prunedCount = 0;
        for (const [ngram, data] of this.ngramFrequencies.entries()) {
            if (data.score < 2 && data.count < 2) { 
                this.ngramFrequencies.delete(ngram);
                this.slopCandidates.delete(ngram);
                prunedCount++;
            }
        }
        if (prunedCount > 0) {
            console.log(`${LOG_PREFIX} [Manual Analysis] Pruned ${prunedCount} very low-score n-grams from chunk.`);
        }
    }

    findAndMergePatterns(frequenciesObjectWithOriginals) { 
        const phraseScoreMap = {}; 
        for (const data of Object.values(frequenciesObjectWithOriginals)) {
            phraseScoreMap[data.original] = (phraseScoreMap[data.original] || 0) + data.score; 
        }

        const culledFrequencies = cullSubstrings(phraseScoreMap); 
        const candidates = Object.entries(culledFrequencies).sort((a, b) => a[0].localeCompare(b[0])); 
        const mergedPatterns = {};
        const consumedIndices = new Set();

        for (let i = 0; i < candidates.length; i++) {
            if (consumedIndices.has(i)) continue;

            const [phraseA, scoreA] = candidates[i];
            const wordsA = phraseA.split(' ');
            let currentGroup = [{ index: i, phrase: phraseA, score: scoreA }];

            for (let j = i + 1; j < candidates.length; j++) {
                if (consumedIndices.has(j)) continue;
                const [phraseB, scoreB] = candidates[j];
                const wordsB = phraseB.split(' ');
                let commonPrefix = [];
                for (let k = 0; k < Math.min(wordsA.length, wordsB.length); k++) {
                    if (wordsA[k] === wordsB[k]) commonPrefix.push(wordsA[k]);
                    else break;
                }
                if (commonPrefix.length >= PATTERN_MIN_COMMON_WORDS) {
                    currentGroup.push({ index: j, phrase: phraseB, score: scoreB });
                }
            }

            if (currentGroup.length > 1) {
                let totalScore = 0;
                const variations = new Set();
                let commonPrefixString = '';
                const firstWordsInGroup = currentGroup[0].phrase.split(' ');

                if (currentGroup.length > 0) {
                    let prefixLength = firstWordsInGroup.length;
                    for (let k = 1; k < currentGroup.length; k++) {
                        const otherWords = currentGroup[k].phrase.split(' ');
                        let currentItemPrefixLength = 0;
                        while (currentItemPrefixLength < prefixLength && 
                               currentItemPrefixLength < otherWords.length && 
                               firstWordsInGroup[currentItemPrefixLength] === otherWords[currentItemPrefixLength]) {
                            currentItemPrefixLength++;
                        }
                        prefixLength = currentItemPrefixLength; 
                    }
                    commonPrefixString = firstWordsInGroup.slice(0, prefixLength).join(' ');
                }
                
                if (commonPrefixString.split(' ').filter(Boolean).length >= PATTERN_MIN_COMMON_WORDS) {
                    currentGroup.forEach(item => {
                        totalScore += item.score;
                        consumedIndices.add(item.index);
                        const itemWords = item.phrase.split(' ');
                        const variationPart = itemWords.slice(commonPrefixString.split(' ').length).join(' ').trim();
                        if (variationPart) variations.add(variationPart);
                    });

                    if (variations.size > 0) { 
                        const pattern = `${commonPrefixString} ${Array.from(variations).join('/')}`;
                        mergedPatterns[pattern] = (mergedPatterns[pattern] || 0) + totalScore; 
                    } else if (variations.size === 0 && currentGroup.length > 1) {
                        mergedPatterns[commonPrefixString] = (mergedPatterns[commonPrefixString] || 0) + totalScore;
                    }
                }
            }
        }

        const remaining = {};
        for (let i = 0; i < candidates.length; i++) {
            if (!consumedIndices.has(i)) {
                const [phrase, score] = candidates[i];
                let isPartOfMerged = false;
                for (const pattern in mergedPatterns) {
                    if (pattern.startsWith(phrase + " ") || pattern === phrase) { 
                        isPartOfMerged = true;
                        break;
                    }
                }
                if (!isPartOfMerged) {
                    remaining[phrase] = (remaining[phrase] || 0) + score;
                }
            }
        }
        return { merged: mergedPatterns, remaining: remaining };
    }


    performIntermediateAnalysis() {
        const candidatesWithData = {};
        for (const [phrase, data] of this.ngramFrequencies.entries()) {
            if (data.score > 1) {
                candidatesWithData[phrase] = data;
            }
        }
        const sortedCandidates = Object.entries(candidatesWithData).sort((a, b) => b[1].score - a[1].score);
        const limitedCandidates = Object.fromEntries(sortedCandidates.slice(0, CANDIDATE_LIMIT_FOR_ANALYSIS));

        if (Object.keys(candidatesWithData).length > CANDIDATE_LIMIT_FOR_ANALYSIS) {
            console.log(`${LOG_PREFIX} [Perf] Limited candidates from ${Object.keys(candidatesWithData).length} to ${CANDIDATE_LIMIT_FOR_ANALYSIS} BEFORE heavy processing.`);
        }
        
        const { merged, remaining } = this.findAndMergePatterns(limitedCandidates);
        
        const mergedEntries = Object.entries(merged).sort((a, b) => b[1] - a[1]);
        const allRemainingEntries = Object.entries(remaining).sort((a, b) => b[1] - a[1]);
        
        this.analyzedLeaderboardData = {
            merged: merged,
            remaining: remaining,
        };
    }

    async callTwinsForSlopPreScreening(rawCandidates, compiledRegexes) {
        if (!rawCandidates || rawCandidates.length === 0) return [];

        const systemPrompt = `You are an expert natural language processing (NLP) analyst and a discerning literary critic. Your task is to evaluate a list of potential "slop" phrases or patterns identified by an automated system. For each candidate, you must determine if it is:
1.  A coherent, grammatically sensible phrase/pattern.
2.  Something that can plausibly be fixed or enhanced with alternative phrasing.
3.  Not a random fragment, a character name, or a piece of code/metadata.

For each *valid* candidate, you will provide an "enhanced context" - a representative full sentence (or a couple of sentences) where this phrase or a similar one might occur naturally in a story, incorporating it smoothly. This helps a later system understand how to generate alternatives.

For each *invalid* candidate, you will briefly explain why it's invalid.

Output a JSON array of objects. Each object must have:
- \`candidate\`: The original phrase/pattern you are evaluating.
- \`valid_for_regex\`: A boolean (true/false).
- If \`valid_for_regex\` is \`true\`:
    - \`enhanced_context\`: A string, representing a full sentence or two where the \`candidate\` would naturally fit. Ensure this context feels organic and helpful.
- If \`valid_for_regex\` is \`false\`:
    - \`reason\`: A brief string explaining why it's not valid (e.g., "Too short", "Nonsensical fragment", "Metadata").

Example input:
- "a flicker of doubt crossed his face"
- "he looked at her"
- "the"
- "Status: Composed"

Example output:
\`\`\`json
[
  {
    "candidate": "a flicker of doubt crossed his face",
    "valid_for_regex": true,
    "enhanced_context": "When she revealed her true intentions, a flicker of doubt crossed his face, a momentary crack in his usually stoic demeanor."
  },
  {
    "candidate": "he looked at her",
    "valid_for_regex": true,
    "enhanced_context": "He looked at her across the crowded room, a silent question passing between their gazes."
  },
  {
    "candidate": "the",
    "valid_for_regex": false,
    "reason": "Too short and generic to be a slop candidate for regex."
  },
  {
    "candidate": "Status: Composed",
    "valid_for_regex": false,
    "reason": "Likely metadata or a list item, not natural prose."
  }
]
\`\`\`
Strictly adhere to the JSON format. Do not add any other text.`;

        const userPrompt = `Evaluate the following potential slop phrases/patterns:\n- ${rawCandidates.join('\n- ')}\n\nProvide the JSON array of evaluations now.`;

        try {
            this.toastr.info("Prose Polisher: Twins are pre-screening slop candidates...", "Project Gremlin", { timeOut: 7000 });
            if (!await applyGremlinEnvironment('twins')) {
                throw new Error("Failed to configure environment for Twin Gremlins pre-screening.");
            }

            const rawResponse = await executeGen(`${systemPrompt}\n\n${userPrompt}`);
            if (!rawResponse || !rawResponse.trim()) {
                console.warn(`${LOG_PREFIX} Twins returned an empty response during pre-screening.`);
                return rawCandidates.map(c => ({ candidate: c, enhanced_context: c })); 
            }

            let twinResults = [];
            try {
                const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*?\])/s);
                if (jsonMatch) {
                    const jsonString = jsonMatch[1] || jsonMatch[2];
                    twinResults = JSON.parse(jsonString);
                } else {
                     twinResults = JSON.parse(rawResponse); 
                     if (!Array.isArray(twinResults)) throw new Error("Parsed data is not an array");
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to parse JSON from Twins' pre-screening response. Error: ${e.message}. Raw response:`, rawResponse);
                this.toastr.error("Prose Polisher: Twins' pre-screening returned invalid data. See console.");
                return rawCandidates.map(c => ({ candidate: c, enhanced_context: c })); 
            }

            const validCandidates = twinResults.filter(r => r.valid_for_regex && r.candidate && r.enhanced_context).map(r => ({
                candidate: r.candidate,
                enhanced_context: r.enhanced_context,
            }));
            
            const rejectedCount = twinResults.length - validCandidates.length;
            if (rejectedCount > 0) {
                 console.log(`${LOG_PREFIX} Twins rejected ${rejectedCount} slop candidates during pre-screening.`);
            }

            this.toastr.success(`Prose Polisher: Twins pre-screened ${rawCandidates.length} candidates. ${validCandidates.length} approved.`, "Project Gremlin", { timeOut: 4000 });
            return validCandidates;

        } catch (error) {
            console.error(`${LOG_PREFIX} Error during Twins pre-screening:`, error);
            this.toastr.error(`Prose Polisher: Twins pre-screening failed. ${error.message}. Proceeding with raw candidates.`, "Project Gremlin");
            return rawCandidates.map(c => ({ candidate: c, enhanced_context: c })); 
        }
    }

    async generateAndSaveDynamicRulesWithSingleGremlin(candidatesForGeneration, dynamicRulesRef, gremlinRoleForGeneration) {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) {
            this.toastr.info("SillyTavern is still loading, please wait to generate rules.");
            return 0;
        }
        
        const roleForGenUpper = gremlinRoleForGeneration.charAt(0).toUpperCase() + gremlinRoleForGeneration.slice(1);
        let addedCount = 0;

        const systemPrompt = `You are an expert literary editor and a master of Regex, tasked with elevating prose by eliminating repetitive phrasing ("slop"). Your goal is to generate high-quality, transformative alternatives for given text patterns.

## TASK
Analyze the provided list of repetitive phrases/patterns. For each viable pattern, generate a corresponding JSON object for a find-and-replace rule. The input will provide the candidate phrase and an 'enhanced_context' which is a representative sentence where the phrase might occur. Use this context to understand the phrase's typical usage and implied writing style.

## INPUT FORMAT
The input is a list of objects, each with:
- \`candidate\`: The repetitive phrase or pattern.
- \`enhanced_context\`: A sentence or two showing the candidate in a typical usage.

Example input to you:
\`\`\`json
[
  {
    "candidate": "a flicker of doubt crossed his face",
    "enhanced_context": "When she revealed her true intentions, a flicker of doubt crossed his face, a momentary crack in his usually stoic demeanor."
  },
  {
    "candidate": "her heart pounded in her chest",
    "enhanced_context": "As the footsteps drew closer, her heart pounded in her chest, a frantic drum against her ribs."
  }
]
\`\`\`

## OUTPUT SPECIFICATION
Your entire response MUST be a single, raw, valid JSON array \`[...] \`. Do not wrap it in markdown fences or add any commentary.

Each object in the array must have three keys: \`scriptName\`, \`findRegex\`, and \`replaceString\`.

1.  **scriptName**: A concise, descriptive name for the rule (e.g., "Slopfix - Fleeting Doubt Expression", "Slopfix - Rapid Heartbeat").
2.  **findRegex**: A valid JavaScript-compatible regex string.
    -   **Generalize Intelligently**: Capture variable parts like pronouns \`([Hh]is|[Hh]er|[Tt]heir)\`, names, or specific objects with capture groups \`()\`. Example: For "a flicker of X crossed his face", capture "X" and "his".
    -   **Combine Variations**: If the pattern implies variations (e.g., \`graces/touches/crosses\`), use non-capturing groups or character classes like \`(?:graces?|touches|crosses)\`. For verb tenses, consider \`(?:looks?|gazed?|stared?)\`.
    -   **Precision**: Use word boundaries \`\\b\` to avoid matching parts of other words. Ensure the regex accurately targets the intended slop.
3.  **replaceString**: A string containing **at least ${MIN_ALTERNATIVES_PER_RULE} high-quality, creative, and grammatically correct alternatives**.
    -   **CRITICAL FORMAT**: The entire string MUST be in the exact format: \`{{random:alt1,alt2,alt3,...,altN}}\`.
    -   Alternatives MUST be separated by a **single comma (,)**. Do not use pipes (|) or any other separator.
    -   Do not add spaces around the commas unless those spaces are intentionally part of an alternative.
    -   **Placeholders**: Use \`$1\`, \`$2\`, etc., to re-insert captured groups from your regex. Ensure these fit grammatically into your alternatives.
    -   **Transformative Quality**:
        -   **Avoid Superficial Changes**: Alternatives must be genuinely different.
        -   **Evocative & Engaging**: Aim for vivid, impactful, and fresh phrasing.
        -   **Maintain Grammatical Structure**: Alternatives, when placeholders are filled, must fit seamlessly.
        -   **Infer Style**: Match the tone and style implied by the 'enhanced_context'.
        -   **Literary Merit**: Each alternative should be of high literary quality.

## FULL OUTPUT EXAMPLES (ASSUMING MIN_ALTERNATIVES_PER_RULE IS 5):

**Example 1 (Based on "a flicker of doubt crossed his face"):**
\`\`\`json
{
  "scriptName": "Slopfix - Fleeting Doubt Expression",
  "findRegex": "\\\\b[aA]\\\\s+flicker\\\\s+of\\\\s+([a-zA-Z\\\\s]+?)\\\\s+(?:ignited|passed|cross|crossed|twisted)\\\\s+(?:in|across|through)\\\\s+([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)\\\\s+(?:eyes|face|mind|gut|depths)\\\\b",
  "replaceString": "{{random:a fleeting look of $1 crossed $2 face,$2 eyes briefly clouded with $1,a momentary shadow of $1 touched $2 features,$2 expression betrayed a flash of $1,$1 briefly surfaced in $2 gaze}}"
}
\`\`\`

**Example 2 (Based on "her heart pounded in her chest"):**
\`\`\`json
{
  "scriptName": "Slopfix - Rapid Heartbeat",
  "findRegex": "\\\\b([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)\\\\s+heart\\\\s+(?:pounded|hammered|thudded|fluttered|raced)(?:\\\\s+in\\\\s+\\\\1\\\\s+(?:chest|ribs))?\\\\b",
  "replaceString": "{{random:a frantic rhythm drummed against $1 ribs,$1 pulse hammered at the base of their throat,$1 chest tightened with heavy thudding,a nervous tremor started beneath $1 breastbone,$1 heartbeat echoed in their ears like war drums}}"
}
\`\`\`
*(Note: Ensure you generate at least ${MIN_ALTERNATIVES_PER_RULE} alternatives for each rule in your actual output, even if the examples above show fewer for brevity here.)*

## CORE PRINCIPLES
-   **High-Quality Alternatives & Strict Formatting are Paramount**: Prioritize generating genuinely transformative and well-written alternatives. If you cannot produce at least ${MIN_ALTERNATIVES_PER_RULE} such alternatives for a pattern, adhering STRICTLY to the specified comma-separated \`{{random:...}}\` format as shown in the examples, it is better to omit the rule entirely from your JSON output.
-   **Reject Unsuitable Patterns**: If an input pattern is too generic (e.g., "he said that"), conversational, a common idiom that isn't "slop", or you cannot create ${MIN_ALTERNATIVES_PER_RULE}+ excellent alternatives in the **exact correct format**, **DO NOT** create a rule for it. Simply omit its object from the final JSON array.
-   **Focus on Narrative Prose**: The rules are intended for descriptive and narrative text.
-   **Final Output**: If you reject all candidates, your entire response must be an empty array: \`[]\`.

Your output will be parsed directly by \`JSON.parse()\`. It must be perfect.`;

        const formattedCandidates = candidatesForGeneration.map(c => `- ${JSON.stringify(c)}`).join('\n');
        const userPrompt = `Generate the JSON array of regex rules for the following candidates:\n${formattedCandidates}\n\nFollow all instructions precisely.`;
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

        try {
            this.toastr.info(`Prose Polisher: Configuring '${roleForGenUpper}' environment for rule generation...`, "Project Gremlin", { timeOut: 7000 });
            if (!await applyGremlinEnvironment(gremlinRoleForGeneration)) {
                throw new Error(`Failed to configure environment for rule generation using ${roleForGenUpper} Gremlin's settings.`);
            }
            this.toastr.info(`Prose Polisher: Generating regex rules via AI (${roleForGenUpper})...`, "Project Gremlin", { timeOut: 25000 });
            const rawResponse = await executeGen(fullPrompt);

            if (!rawResponse || !rawResponse.trim()) {
                this.toastr.warning(`Prose Polisher: ${roleForGenUpper} returned no data for rule generation.`);
                return 0;
            }

            let newRules = [];
            try {
                const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*?\])/s);
                if (jsonMatch) {
                    const jsonString = jsonMatch[1] || jsonMatch[2];
                    newRules = JSON.parse(jsonString);
                } else {
                     newRules = JSON.parse(rawResponse); 
                     if (!Array.isArray(newRules)) throw new Error("Parsed data is not an array.");
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to parse JSON from ${roleForGenUpper}'s response. Error: ${e.message}. Raw response:`, rawResponse);
                this.toastr.error(`Prose Polisher: ${roleForGenUpper}'s rule generation returned invalid data. See console.`);
                return 0;
            }

            for (const rule of newRules) {
                if (rule && rule.scriptName && rule.findRegex && rule.replaceString) {
                    try { new RegExp(rule.findRegex); } catch (e) { console.warn(`${LOG_PREFIX} AI generated an invalid regex for rule '${rule.scriptName}', skipping: ${e.message}`); continue; }
                    
                    // Stricter parsing based on the new prompt guidelines
                    const alternativesMatch = rule.replaceString.match(/^\{\{random:([\s\S]+?)\}\}$/);
                    let alternativesArray = [];
                    if (alternativesMatch && alternativesMatch[1]) {
                        alternativesArray = alternativesMatch[1].split(',').map(s => s.trim()).filter(s => s);
                    }

                    if (alternativesArray.length < MIN_ALTERNATIVES_PER_RULE) {
                        console.warn(`${LOG_PREFIX} AI rule '${rule.scriptName}' has insufficient alternatives (found ${alternativesArray.length}, need ${MIN_ALTERNATIVES_PER_RULE}) or malformed replaceString. Original: "${rule.replaceString}", Skipping.`);
                        continue;
                    }

                    rule.id = `DYN_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    rule.disabled = rule.disabled ?? false;
                    rule.isStatic = false;
                    rule.isNew = true;
                    dynamicRulesRef.push(rule);
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                this.settings.dynamicRules = dynamicRulesRef;
                this.saveSettingsDebounced();
                if (this.updateGlobalRegexArrayCallback) {
                    await this.updateGlobalRegexArrayCallback();
                } else {
                    this.compileActiveRules();
                }
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Error during ${roleForGenUpper}'s dynamic rule generation:`, error);
            this.toastr.error(`Prose Polisher: ${roleForGenUpper}'s rule generation failed. ${error.message}`);
        } finally {
            console.log(`${LOG_PREFIX} Single Gremlin rule generation finished. Added ${addedCount} rules.`);
        }
        return addedCount;
    }

    async generateRulesIterativelyWithTwins(candidatesForGeneration, dynamicRulesRef, numCycles) {
        if (!candidatesForGeneration || candidatesForGeneration.length === 0) return 0;
        let addedCount = 0;
        this.toastr.info(`Prose Polisher: Starting Iterative Twins rule generation (${numCycles} cycle(s))...`, "Project Gremlin");

        for (const candidateData of candidatesForGeneration) {
            let currentFindRegex = null;
            let currentAlternatives = []; 
            let lastValidOutput = {}; 

            try {
                if (!await applyGremlinEnvironment('twins')) {
                    throw new Error("Failed to configure environment for Twin Gremlins (Iterative Regex).");
                }

                for (let cycle = 1; cycle <= numCycles; cycle++) {
                    if (this.isProcessingAiRules === false) { console.warn("Rule processing aborted by user/system."); return addedCount; }

                    this.toastr.info(`Regex Gen: Candidate "${candidateData.candidate.substring(0,20)}..." - Cycle ${cycle}/${numCycles} (Vex)...`, "Project Gremlin", { timeOut: 12000 });
                    let vexPrompt = this.constructTwinIterativePrompt('vex', cycle, numCycles, candidateData, currentFindRegex, currentAlternatives, lastValidOutput.notes_for_vax);
                    let vexRawResponse = await executeGen(vexPrompt);
                    let vexOutput = this.parseTwinResponse(vexRawResponse, 'Vex');
                    lastValidOutput = {...lastValidOutput, ...vexOutput}; 
                    if (vexOutput.findRegex) currentFindRegex = vexOutput.findRegex;
                    if (Array.isArray(vexOutput.alternatives)) currentAlternatives = vexOutput.alternatives;
                    
                    if (this.isProcessingAiRules === false) { console.warn("Rule processing aborted by user/system."); return addedCount; }

                    this.toastr.info(`Regex Gen: Candidate "${candidateData.candidate.substring(0,20)}..." - Cycle ${cycle}/${numCycles} (Vax)...`, "Project Gremlin", { timeOut: 12000 });
                    let vaxPrompt = this.constructTwinIterativePrompt('vax', cycle, numCycles, candidateData, currentFindRegex, currentAlternatives, lastValidOutput.notes_for_vex);
                    let vaxRawResponse = await executeGen(vaxPrompt);
                    let vaxOutput = this.parseTwinResponse(vaxRawResponse, 'Vax');
                    lastValidOutput = {...lastValidOutput, ...vaxOutput};
                    if (vaxOutput.findRegex) currentFindRegex = vaxOutput.findRegex;
                    if (Array.isArray(vaxOutput.alternatives)) currentAlternatives = vaxOutput.alternatives;
                    
                    if (cycle === numCycles) { 
                        if (vaxOutput.scriptName) lastValidOutput.scriptName = vaxOutput.scriptName;
                        if (vaxOutput.replaceString) lastValidOutput.replaceString = vaxOutput.replaceString; // Vax should be creating this in the correct format on final turn
                    }

                    if (this.isProcessingAiRules === false) { console.warn("Rule processing aborted by user/system."); return addedCount; }
                }

                // Validation for final rule from iterative twins
                if (lastValidOutput.scriptName && lastValidOutput.findRegex && lastValidOutput.replaceString) {
                    try { new RegExp(lastValidOutput.findRegex); }
                    catch (e) { console.warn(`${LOG_PREFIX} Iterative Twins produced invalid regex for '${lastValidOutput.scriptName}', skipping: ${e.message}`); continue; }

                    const alternativesMatch = lastValidOutput.replaceString.match(/^\{\{random:([\s\S]+?)\}\}$/);
                    let alternativesArray = [];
                    if (alternativesMatch && alternativesMatch[1]) {
                        alternativesArray = alternativesMatch[1].split(',').map(s => s.trim()).filter(s => s);
                    }

                    if (alternativesArray.length < MIN_ALTERNATIVES_PER_RULE) {
                        console.warn(`${LOG_PREFIX} Iterative Twins rule '${lastValidOutput.scriptName}' has insufficient alternatives (found ${alternativesArray.length}, need ${MIN_ALTERNATIVES_PER_RULE}) or malformed replaceString. Original: "${lastValidOutput.replaceString}", Skipping.`);
                        continue;
                    }

                    const newRule = {
                        id: `DYN_TWIN_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        scriptName: lastValidOutput.scriptName,
                        findRegex: lastValidOutput.findRegex,
                        replaceString: lastValidOutput.replaceString, // Should be correctly formatted by Vax
                        disabled: false,
                        isStatic: false,
                        isNew: true,
                    };
                    dynamicRulesRef.push(newRule);
                    addedCount++;
                    console.log(`${LOG_PREFIX} Iterative Twins successfully generated rule: ${newRule.scriptName}`);
                } else {
                    console.warn(`${LOG_PREFIX} Iterative Twins failed to produce a complete rule for candidate: ${candidateData.candidate}. Final state:`, lastValidOutput);
                }

            } catch (error) {
                console.error(`${LOG_PREFIX} Error during iterative twin generation for candidate ${candidateData.candidate}:`, error);
                this.toastr.error(`Error with iterative regex for ${candidateData.candidate.substring(0,20)}... See console.`);
            }
        } 

        if (addedCount > 0) {
            this.settings.dynamicRules = dynamicRulesRef;
            this.saveSettingsDebounced();
            if (this.updateGlobalRegexArrayCallback) {
                await this.updateGlobalRegexArrayCallback();
            } else {
                this.compileActiveRules();
            }
        }
        this.toastr.success(`Iterative Twins rule generation finished. Added ${addedCount} rules.`, "Project Gremlin");
        return addedCount;
    }

    parseTwinResponse(rawResponse, twinName) {
        if (!rawResponse || !rawResponse.trim()) {
            console.warn(`${LOG_PREFIX} ${twinName} (Iterative Regex) returned empty response.`);
            return {};
        }
        try {
            const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*?\}|\[[\s\S]*?\])/s);
            if (jsonMatch) {
                const jsonString = jsonMatch[1] || jsonMatch[2]; 
                return JSON.parse(jsonString);
            }
            return JSON.parse(rawResponse); 
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to parse JSON from ${twinName} (Iterative Regex). Error: ${e.message}. Raw:`, rawResponse);
            this.toastr.warning(`${twinName} (Iterative Regex) output unparseable. See console.`);
            return {};
        }
    }
    
    constructTwinIterativePrompt(twinRole, currentCycle, totalCycles, candidateData, currentFindRegex, currentAlternatives, previousTwinNotes = "") {
        const isFinalVaxTurn = twinRole === 'vax' && currentCycle === totalCycles;

        let prompt = `You are ${twinRole === 'vex' ? 'Vex, the creative wordsmith' : 'Vax, the logical regex technician'}, collaborating on a rule for a repetitive phrase.
Original Candidate: "${candidateData.candidate}"
Context: "${candidateData.enhanced_context}"
Current Cycle: ${currentCycle} of ${totalCycles}. Your turn as ${twinRole}.
`;

        if (currentFindRegex) {
            prompt += `\nCurrent findRegex (from previous step, refine if needed): \`${currentFindRegex}\`\n`;
        } else {
            prompt += `\nNo findRegex yet. Please propose one if you are Vax, or Vex can start drafting one.\n`;
        }

        if (currentAlternatives && currentAlternatives.length > 0) {
            prompt += `Current Alternatives (list of strings, from previous step - Review, Refine, Expand):\n${JSON.stringify(currentAlternatives, null, 2)}\n`;
        } else {
            prompt += `\nNo alternatives yet. Please start generating them if you are Vex, or Vax can review Vex's initial set.\n`;
        }
        
        if (previousTwinNotes) {
            prompt += `\nNotes from your partner (${twinRole === 'vex' ? 'Vax' : 'Vex'} from previous turn):\n${previousTwinNotes}\n`;
        }

        prompt += "\nYour Specific Tasks for THIS Turn:\n";

        if (twinRole === 'vex') {
            prompt += "- Focus on CREATIVITY and DIVERSITY for alternatives. Generate new ones, refine existing ones to be more evocative and distinct.\n";
            prompt += "- If `findRegex` exists, ensure your alternatives match its capture groups. If not, you can suggest a basic `findRegex` structure that would support good alternatives.\n";
            prompt += `- Aim to have a strong list of at least 7-10 good alternatives after your turn. Quality over quantity if forced, but try for both.\n`;
            prompt += `- Provide brief \`notes_for_vax\` outlining your changes, any regex thoughts, or areas Vax should focus on for technical refinement.\n`;
            prompt += 'Output JSON with keys: "findRegex" (string, your best version or proposal), "alternatives" (array of strings, your refined/expanded list), "notes_for_vax" (string, which is optional).\n'; 
        } else { // Vax's turn
            prompt += "- Focus on TECHNICAL PRECISION for `findRegex`. Ensure it's robust, correctly uses capture groups, word boundaries, and generalization.\n";
            prompt += "- Review Vex's `alternatives`. Ensure they grammatically fit the `findRegex` and its capture groups. Add more technical or structural variations if appropriate.\n";
            if (isFinalVaxTurn) {
                prompt += `- THIS IS THE FINAL TURN. You MUST finalize the rule:
    - Ensure \`findRegex\` is perfect.
    - Expand/refine \`alternatives\` (your current list of alternative strings) to have AT LEAST ${MIN_ALTERNATIVES_PER_RULE} high-quality, diverse options.
    - Generate a concise, descriptive \`scriptName\` for the rule.
    - **CRITICAL \`replaceString\` FORMATTING**: Compile the final list of alternatives into a single \`replaceString\`. This string MUST be in the exact format: \`{{random:alt1,alt2,alt3,...,altN}}\`.
    - Alternatives MUST be separated by a **single comma (,)**. Do not use pipes (|) or any other separator.
    - **Refer to correctly formatted examples like**: \`"replaceString": "{{random:first option,second option,third option with $1,fourth,fifth}}" \` (Ensure you use actual generated alternatives, not these placeholders).
Output JSON with keys: "scriptName" (string), "findRegex" (string), "replaceString" (string). All fields are mandatory.\n`;
            } else {
                prompt += `- Aim to solidify the \`findRegex\` and ensure the \`alternatives\` list is growing well.\n`;
                prompt += `- Provide brief \`notes_for_vex\` outlining your regex changes, suggestions for alternative types Vex could explore, or quality checks.\n`;
                prompt += 'Output JSON with keys: "findRegex" (string, your refined version), "alternatives" (array of strings, your refined/expanded list), "notes_for_vex" (string, which is optional).\n';
            }
        }
        prompt += "\nIMPORTANT: Output ONLY the JSON object. No other text or markdown.\nIf, on Vax's final turn, you determine this candidate cannot be made into a high-quality rule meeting all criteria (especially the ${MIN_ALTERNATIVES_PER_RULE} alternatives and the **exact** \`replaceString\` format), output an empty JSON object: `{}`.\n";
        return prompt;
    }


    async handleGenerateRulesFromAnalysisClick(dynamicRulesRef, regexNavigatorRef) {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        if (this.isProcessingAiRules) { this.toastr.warning("Prose Polisher: AI rule generation is already in progress."); return; }
        
        this.performIntermediateAnalysis();
        
        const getOriginalFromKey = (lemmatizedKey) => {
            if (!lemmatizedKey) return lemmatizedKey; 
            if (lemmatizedKey.includes('/')) return lemmatizedKey; 
            const data = this.ngramFrequencies.get(lemmatizedKey);
            return data ? data.original : lemmatizedKey; 
        };

        const patternCandidates = this.analyzedLeaderboardData.merged.map(entry => entry[0]); 
        const individualCandidatesOriginal = this.analyzedLeaderboardData.remaining.map(entry => entry[0]);
        const slopCandidatesOriginal = Array.from(this.slopCandidates).map(getOriginalFromKey);


        const allPotentialCandidates = [...new Set([...slopCandidatesOriginal, ...patternCandidates, ...individualCandidatesOriginal])];
        
        if (allPotentialCandidates.length === 0) {
             this.toastr.info("Prose Polisher: No slop candidates or patterns identified. Run analysis or wait for more messages.");
             return;
        }

        const candidatesForTwinsPreScreen = allPotentialCandidates.slice(0, TWINS_PRESCREEN_BATCH_SIZE);
        let validCandidatesForGeneration = [];
        if (candidatesForTwinsPreScreen.length > 0) {
            validCandidatesForGeneration = await this.callTwinsForSlopPreScreening(candidatesForTwinsPreScreen);
        }

        const batchToProcess = validCandidatesForGeneration.slice(0, BATCH_SIZE);

        if (batchToProcess.length === 0) {
            this.toastr.info("Prose Polisher: Twins' pre-screening found no valid slop candidates for rule generation.");
            return;
        }
        
        this.isProcessingAiRules = true; 
        let newRulesCount = 0;

        try {
            if (this.settings.regexGenerationMethod === 'twins') {
                newRulesCount = await this.generateRulesIterativelyWithTwins(batchToProcess, dynamicRulesRef, this.settings.regexTwinsCycles);
            } else { 
                const gremlinRoleForRegexGen = this.settings.regexGeneratorRole || 'writer';
                const roleForGenUpper = gremlinRoleForRegexGen.charAt(0).toUpperCase() + gremlinRoleForRegexGen.slice(1);
                this.toastr.info(`Prose Polisher: Starting AI rule generation for ${batchToProcess.length} pre-screened candidates (using ${roleForGenUpper} settings)...`);
                newRulesCount = await this.generateAndSaveDynamicRulesWithSingleGremlin(batchToProcess, dynamicRulesRef, gremlinRoleForRegexGen);
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Top-level error during rule generation:`, error);
            this.toastr.error("An unexpected error occurred during rule generation. Check console.");
        } finally {
            this.isProcessingAiRules = false; 
        }

        batchToProcess.forEach(processedCandidate => {
            let keyToDelete = null;
            for (const [lemmatizedKey, data] of this.ngramFrequencies.entries()) {
                if (data.original === processedCandidate.candidate) { 
                    keyToDelete = lemmatizedKey;
                    break; 
                }
            }
            if (keyToDelete) {
                this.slopCandidates.delete(keyToDelete);
                if (this.ngramFrequencies.has(keyToDelete)) {
                     this.ngramFrequencies.get(keyToDelete).score = 0; 
                }
            }
        });

        if (newRulesCount > 0) {
            this.toastr.success(`Prose Polisher: AI generated and saved ${newRulesCount} new rule(s) for the batch!`);
            if (regexNavigatorRef) {
                regexNavigatorRef.renderRuleList();
            }
        } else if (batchToProcess.length > 0) {
            this.toastr.info("Prose Polisher: AI rule generation complete for the batch. No new rules were created (or an error occurred).");
        }
        
        this.performIntermediateAnalysis(); 
        
        const currentSlopOriginalsAfterProcessing = Array.from(this.slopCandidates).map(getOriginalFromKey);
        const currentPatternCandidatesAfterProcessing = this.analyzedLeaderboardData.merged.map(entry => entry[0]);
        const currentIndividualCandidatesOriginalAfterProcessing = this.analyzedLeaderboardData.remaining.map(entry => entry[0]);
        const totalRemainingUnique = new Set([...currentSlopOriginalsAfterProcessing, ...currentPatternCandidatesAfterProcessing, ...currentIndividualCandidatesOriginalAfterProcessing]).size;


        if (totalRemainingUnique > 0) {
            this.toastr.info(`Prose Polisher: Approx ${totalRemainingUnique} more unique candidates/patterns remaining. Click "Generate AI Rules" again to process the next batch.`);
        } else if (newRulesCount === 0 && batchToProcess.length > 0) { 
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed or filtered by the AI.");
        } else if (newRulesCount > 0 && totalRemainingUnique === 0) { 
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed.");
        }
    }

    showFrequencyLeaderboard() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        const { merged: mergedEntries, remaining: remainingEntries } = this.analyzedLeaderboardData;
        console.log(`${LOG_PREFIX} showFrequencyLeaderboard: mergedEntries`, mergedEntries);
        console.log(`${LOG_PREFIX} showFrequencyLeaderboard: remainingEntries`, remainingEntries);
        let contentHtml;
        if (mergedEntries.length === 0 && remainingEntries.length === 0) {
            contentHtml = '<p>No repetitive phrases have been detected that meet display criteria.</p>';
        } else {
            const mergedRows = mergedEntries.map(([phrase, score]) => `<tr class="is-pattern"><td>${this.escapeHtml(phrase)}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            const remainingRows = remainingEntries.map(([phrase, score]) => `<tr><td>${this.escapeHtml(phrase)}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            contentHtml = `<p>The following have been detected as repetitive. Phrases in <strong>bold orange</strong> are detected patterns. Score is based on frequency, uniqueness, length, and context. Higher is worse.</p>
                           <table class="prose-polisher-frequency-table">
                               <thead><tr><th>Repetitive Phrase or Pattern</th><th>Slop Score</th></tr></thead>
                               <tbody>${mergedRows}${remainingRows}</tbody>
                           </table>`;
        }
        this.callGenericPopup(contentHtml, this.POPUP_TYPE.TEXT, "Live Frequency Data (Slop Score)", { wide: true, large: true });
    }

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    showWhitelistManager() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        const settings = this.settings;
        const container = document.createElement('div');
        container.className = 'prose-polisher-whitelist-manager';
        container.innerHTML = `
            <h4>Whitelist Manager</h4>
            <p>Add approved words to this list (e.g., character names, specific jargon). Phrases containing these words will be <strong>ignored</strong> by the frequency analyzer. A default list of common proper names and common English words is already included for scoring purposes.</p>
            <div class="list-container">
                <ul id="pp-whitelist-list"></ul>
            </div>
            <div class="add-controls">
                <input type="text" id="pp-whitelist-input" class="text_pole" placeholder="Add a word to your whitelist...">
                <button id="pp-whitelist-add-btn" class="menu_button">Add</button>
            </div>
        `;
        const listElement = container.querySelector('#pp-whitelist-list');
        const inputElement = container.querySelector('#pp-whitelist-input');
        const addButton = container.querySelector('#pp-whitelist-add-btn');

        const renderWhitelist = () => {
            listElement.innerHTML = '';
            (settings.whitelist || []).sort().forEach(originalWord => {
                const item = document.createElement('li');
                item.className = 'list-item';
                const displayWord = this.escapeHtml(originalWord);
                item.innerHTML = `<span>${displayWord}</span><i class="fa-solid fa-trash-can delete-btn" data-word="${originalWord}"></i>`;
                item.querySelector('.delete-btn').addEventListener('pointerup', (event) => {
                    const wordToRemove = event.target.dataset.word; 
                    settings.whitelist = (settings.whitelist || []).filter(w => w !== wordToRemove);
                    this.saveSettingsDebounced();
                    this.updateEffectiveWhitelist(); 
                    renderWhitelist();
                });
                listElement.appendChild(item);
            });
        };

        const addWord = () => {
            const newWord = inputElement.value.trim().toLowerCase();
            if (newWord && !(settings.whitelist || []).includes(newWord)) {
                if (!settings.whitelist) settings.whitelist = [];
                settings.whitelist.push(newWord);
                this.saveSettingsDebounced();
                this.updateEffectiveWhitelist(); 
                renderWhitelist();
                inputElement.value = '';
            }
            inputElement.focus();
        };

        addButton.addEventListener('pointerup', addWord);
        inputElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });

        renderWhitelist();
        this.callGenericPopup(container, this.POPUP_TYPE.DISPLAY, "Whitelist Manager", { wide: false, large: false });
    }

    showBlacklistManager() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        const settings = this.settings;
        const container = document.createElement('div');
        container.className = 'prose-polisher-blacklist-manager';
        container.innerHTML = `
            <h4>Blacklist Manager (Weighted)</h4>
            <p>Add words to this list with a weight (1-10). Any phrase containing these words will get a score boost equal to the weight, making them much more likely to be flagged as slop.</p>
            <div class="list-container">
                <ul id="pp-blacklist-list"></ul>
            </div>
            <div class="add-controls">
                <input type="text" id="pp-blacklist-input" class="text_pole" placeholder="e.g., suddenly, began to" style="flex-grow: 3;">
                <input type="number" id="pp-blacklist-weight" class="text_pole" placeholder="Weight" value="3" min="1" max="10" style="flex-grow: 1;">
                <button id="pp-blacklist-add-btn" class="menu_button">Add</button>
            </div>
        `;
        const listElement = container.querySelector('#pp-blacklist-list');
        const inputElement = container.querySelector('#pp-blacklist-input');
        const weightElement = container.querySelector('#pp-blacklist-weight');
        const addButton = container.querySelector('#pp-blacklist-add-btn');

        const renderBlacklist = () => {
            listElement.innerHTML = '';
            const sortedBlacklist = Object.entries(settings.blacklist || {}).sort((a, b) => a[0].localeCompare(b[0]));
            
            sortedBlacklist.forEach(([originalWordKey, weight]) => {
                const item = document.createElement('li');
                item.className = 'list-item';
                const displayWord = this.escapeHtml(originalWordKey);
                item.innerHTML = `<span><strong>${displayWord}</strong> (Weight: ${weight})</span><i class="fa-solid fa-trash-can delete-btn" data-word="${originalWordKey}"></i>`;
                
                item.querySelector('.delete-btn').addEventListener('pointerup', (event) => {
                    const wordKeyToRemove = event.target.dataset.word; 
                    if (wordKeyToRemove && settings.blacklist && settings.blacklist.hasOwnProperty(wordKeyToRemove)) {
                        delete settings.blacklist[wordKeyToRemove];
                        this.saveSettingsDebounced();
                        renderBlacklist(); 
                    }
                });
                listElement.appendChild(item);
            });
        }; 

        const addWord = () => {
            const newWord = inputElement.value.trim().toLowerCase();
            const weight = parseInt(weightElement.value, 10);

            if (newWord && !isNaN(weight) && weight >= 1 && weight <= 10) {
                if (!settings.blacklist) settings.blacklist = {};
                settings.blacklist[newWord] = weight;
                this.saveSettingsDebounced();
                renderBlacklist();
                inputElement.value = '';
                inputElement.focus();
            } else {
                this.toastr.warning("Please enter a valid word and a weight between 1 and 10.");
            }
        };

        addButton.addEventListener('pointerup', addWord);
        inputElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });
        weightElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });
        
        renderBlacklist();
        this.callGenericPopup(container, this.POPUP_TYPE.DISPLAY, "Blacklist Manager", { wide: false, large: false });
    }


    clearFrequencyData() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        this.ngramFrequencies.clear();
        this.slopCandidates.clear();
        this.messageCounterForTrigger = 0;
        this.analyzedLeaderboardData = { merged: [], remaining: [] };
        this.toastr.success("Prose Polisher frequency data cleared!");
    }

    incrementProcessedMessages() {
         this.totalAiMessagesProcessed++;
    }

    checkDynamicRuleTrigger(dynamicRulesRef, regexNavigatorRef) { 
        if (this.isProcessingAiRules) return; 

        if (this.settings.isDynamicEnabled && this.slopCandidates.size > 0) {
            this.messageCounterForTrigger++;
            if (this.messageCounterForTrigger >= this.settings.dynamicTriggerCount) {
                this.messageCounterForTrigger = 0;
                
                const getOriginalFromKey = (lemmatizedKey) => {
                    if (!lemmatizedKey) return lemmatizedKey;
                    const data = this.ngramFrequencies.get(lemmatizedKey);
                    return data ? data.original : lemmatizedKey;
                };
                const slopCandidatesOriginal = Array.from(this.slopCandidates).map(getOriginalFromKey);
                const candidatesForAutoTriggerOriginal = slopCandidatesOriginal.slice(0, TWINS_PRESCREEN_BATCH_SIZE);


                if (candidatesForAutoTriggerOriginal.length > 0) {
                    this.toastr.info(`Prose Polisher: Auto-triggering Twins pre-screening for ${candidatesForAutoTriggerOriginal.length} candidates...`, "Project Gremlin");
                    this.callTwinsForSlopPreScreening(candidatesForAutoTriggerOriginal, this.compiledRegexes).then(async validCandidatesForGeneration => {
                        if (validCandidatesForGeneration.length > 0) {
                            const batchToProcess = validCandidatesForGeneration.slice(0, BATCH_SIZE); 
                            this.isProcessingAiRules = true; 
                            let newRulesCount = 0;
                            try {
                                if (this.settings.regexGenerationMethod === 'twins') {
                                    this.toastr.info(`Prose Polisher: Auto-triggering Iterative Twins rule generation for ${batchToProcess.length} pre-screened candidates...`, "Project Gremlin");
                                    newRulesCount = await this.generateRulesIterativelyWithTwins(batchToProcess, dynamicRulesRef, this.settings.regexTwinsCycles);
                                } else {
                                    const gremlinRoleForRegexGen = this.settings.regexGeneratorRole || 'writer';
                                    const roleForGenUpper = gremlinRoleForRegexGen.charAt(0).toUpperCase() + gremlinRoleForRegexGen.slice(1);
                                    this.toastr.info(`Prose Polisher: Auto-triggering Single Gremlin (${roleForGenUpper}) rule generation for ${batchToProcess.length} pre-screened candidates...`, "Project Gremlin");
                                    newRulesCount = await this.generateAndSaveDynamicRulesWithSingleGremlin(batchToProcess, dynamicRulesRef, gremlinRoleForRegexGen);
                                }
                            } catch (error) {
                                console.error(`${LOG_PREFIX} Error during auto-triggered rule generation:`, error);
                                this.toastr.error("Error during auto-triggered rule generation. See console.");
                            } finally {
                                this.isProcessingAiRules = false;
                            }


                            if (newRulesCount > 0) {
                                batchToProcess.forEach(processedCandidate => {
                                    let keyToDelete = null;
                                    for (const [lemmatizedKey, data] of this.ngramFrequencies.entries()) {
                                        if (data.original === processedCandidate.candidate) {
                                            keyToDelete = lemmatizedKey;
                                            break;
                                        }
                                    }
                                    if (keyToDelete) {
                                        this.slopCandidates.delete(keyToDelete);
                                        if (this.ngramFrequencies.has(keyToDelete)) {
                                            this.ngramFrequencies.get(keyToDelete).score = 0; 
                                        }
                                    }
                                });
                                if (regexNavigatorRef) regexNavigatorRef.renderRuleList();
                            }
                        } else {
                            this.toastr.info("Prose Polisher: Twins' pre-screening found no valid candidates for auto-rule generation.", "Project Gremlin");
                        }
                    }).catch(error => {
                        console.error(`${LOG_PREFIX} Error in auto-trigger pre-screening chain:`, error);
                        this.toastr.error("Error during auto-trigger pre-screening. See console.");
                        this.isProcessingAiRules = false; 
                    });
                }
            }
        } else {
            this.messageCounterForTrigger = 0;
        }
    }

    async manualAnalyzeChatHistory() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) {
            this.toastr.info("SillyTavern is still loading, please wait.");
            return;
        }
        if (this.isAnalyzingHistory) {
            this.toastr.warning("Prose Polisher: Chat history analysis is already in progress.");
            return;
        }

        this.isAnalyzingHistory = true;
        this.toastr.info("Prose Polisher: Starting full chat history analysis. This may take a moment...", "Chat Analysis", { timeOut: 5000 });
        console.log(`${LOG_PREFIX} Starting manual chat history analysis.`);

        const context = getContext();
        if (!context || !context.chat) {
            this.toastr.error("Prose Polisher: Could not get chat context for analysis.");
            this.isAnalyzingHistory = false;
            return;
        }
        const chatMessages = context.chat;
        console.log(`${LOG_PREFIX} Chat messages being sent to worker:`, chatMessages);
        const compiledRegexes = this.compiledRegexes; // Get compiled regexes from Analyzer instance

        const worker = new Worker('./scripts/extensions/third-party/ProsePolisher/analyzer.worker.js', { type: 'module' });

        worker.postMessage({
            type: 'startAnalysis',
            chatMessages: chatMessages,
            settings: this.settings,
            compiledRegexes: compiledRegexes,
        });

        worker.onmessage = (e) => {
            const { type, processed, total, aiAnalyzed, analyzedLeaderboardData, slopCandidates } = e.data;
            if (type === 'progress') {
                this.toastr.info(`Prose Polisher: Analyzing chat history... ${processed}/${total} messages processed.`, "Chat Analysis", { timeOut: 1000 });
                console.log(`${LOG_PREFIX} [Manual Analysis] Processed ${processed}/${total} messages...`);
            } else if (type === 'complete') {
                console.log(`${LOG_PREFIX} Worker complete message received. Data from worker:`, e.data);
                this.analyzedLeaderboardData = analyzedLeaderboardData;
                this.slopCandidates = new Set(slopCandidates); // Reconstruct Set from array
                this.isAnalyzingHistory = false;
                this.toastr.success(`Prose Polisher: Chat history analysis complete! Analyzed ${aiAnalyzed} AI messages. View Frequency Data to see results.`, "Chat Analysis Complete", { timeOut: 7000 });
                console.log(`${LOG_PREFIX} Manual chat history analysis complete. Analyzed ${aiAnalyzed} AI messages.`, { analyzedLeaderboardData, slopCandidates });
                worker.terminate(); // Terminate worker after completion
                this.showFrequencyLeaderboard(); // Display results after analysis
            }
        };

        worker.onerror = (error) => {
            console.error(`${LOG_PREFIX} Error during manual chat history analysis in worker:`, error);
            this.toastr.error("Prose Polisher: An error occurred during chat analysis. Check console.", "Chat Analysis Error");
            this.isAnalyzingHistory = false;
            worker.terminate();
        };
    }
}
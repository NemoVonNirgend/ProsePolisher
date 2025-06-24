// C:\SillyTavern\public\scripts\extensions\third-party\ProsePolisher\analyzer.js
import { extension_settings, getContext } from '../../../extensions.js'; // getContext might not be needed here anymore
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
// openai_setting_names is not directly used here, API keys are fetched in generateAndSaveDynamicRules
// import { openai_setting_names } from '../../../../scripts/openai.js';
// REMOVED: import { SUGGESTED_MODELS } from './projectgremlin.js'; // This was causing the error

// Import the reinstated local data
import { commonWords } from './common_words.js';
import { defaultNames } from './default_names.js';


const LOG_PREFIX = `[ProsePolisher:Analyzer]`;

// --- Constants ---
const SLOP_THRESHOLD = 3; // This is now a score threshold
const BATCH_SIZE = 5;
const MANUAL_ANALYSIS_CHUNK_SIZE = 20; // How many messages to process before a small pause/log
const HEAVY_ANALYSIS_INTERVAL = 200;
const CANDIDATE_LIMIT_FOR_ANALYSIS = 2000;
const PRUNE_AFTER_MESSAGES = 20;
// PRUNE_CHECK_INTERVAL is now managed in content.js as it relates to event frequency
const NGRAM_MIN = 3;
const NGRAM_MAX = 10;
const PATTERN_MIN_COMMON_WORDS = 3;


// --- Utility Functions (Reinstated/Updated) ---
function generateNgrams(text, n) {
    const words = text.replace(/[.,!?]/g, '').toLowerCase().split(/\s+/).filter(w => w);
    const ngrams = [];
    for (let i = 0; i <= words.length - n; i++) {
        ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
}

// More aggressive stripMarkup from old_content.js
function stripMarkup(text) {
    if (!text) return '';
    let cleanText = text;
    // Remove specific HTML blocks
    cleanText = cleanText.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    // Remove all other HTML tags
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    // Remove markdown emphasis, quotes, parentheses
    cleanText = cleanText.replace(/(?:\*|_|~|`)+(.+?)(?:\*|_|~|`)+/g, '$1'); // Bold, italic, strikethrough, code
    cleanText = cleanText.replace(/"(.*?)"/g, '$1'); // Content within double quotes
    cleanText = cleanText.replace(/\((.*?)\)/g, '$1'); // Content within parentheses
    // Trim and remove leading/trailing asterisks that might be left from incomplete markdown
    cleanText = cleanText.trim().replace(/^[\s*]+|[\s*]+$/g, '');
    return cleanText;
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
    constructor(settings, callGenericPopup, POPUP_TYPE, toastr, saveSettingsDebounced, compileActiveRules, isPhraseHandledByRegex, updateGlobalRegexArrayCallback) {
        this.settings = settings; // Reference to extension_settings.ProsePolisher
        this.callGenericPopup = callGenericPopup;
        this.POPUP_TYPE = POPUP_TYPE;
        this.toastr = toastr;
        this.saveSettingsDebounced = saveSettingsDebounced;
        this.compileActiveRules = compileActiveRules; // Callback to recompile in content.js
        this.isPhraseHandledByRegex = isPhraseHandledByRegex; // Callback to check against compiled rules in content.js
        this.updateGlobalRegexArrayCallback = updateGlobalRegexArrayCallback; // Callback to update global regex in content.js

        // State variables
        this.ngramFrequencies = new Map();
        this.slopCandidates = new Set();
        this.analyzedLeaderboardData = { merged: [], remaining: [] };
        this.messageCounterForTrigger = 0;
        this.totalAiMessagesProcessed = 0;
        this.isProcessingAiRules = false;
        this.isAnalyzingHistory = false;

        this.effectiveWhitelist = new Set();
        this.updateEffectiveWhitelist(); // Initial population
    }

    updateEffectiveWhitelist() {
        const userWhitelist = new Set((this.settings.whitelist || []).map(w => w.toLowerCase()));
        this.effectiveWhitelist = new Set([...defaultNames, ...userWhitelist, ...commonWords]); // commonWords also added to effectiveWhitelist for scoring
        console.log(`${LOG_PREFIX} Analyzer effective whitelist updated. Size: ${this.effectiveWhitelist.size}`);
    }

    // Reinstated from old_content.js
    isPhraseLowQuality(phrase) {
        const words = phrase.split(' ');
        if (words.length < 3) return true; // Too short
        // Check ratio of common words (now using effectiveWhitelist which includes commonWords)
        const commonWordCount = words.reduce((count, word) => count + (this.effectiveWhitelist.has(word.toLowerCase()) ? 1 : 0), 0);
        if ((commonWordCount / words.length) > 0.7) return true; // Too many common words
        // Check if starts or ends with a common word
        if (this.effectiveWhitelist.has(words[0].toLowerCase()) || this.effectiveWhitelist.has(words[words.length - 1].toLowerCase())) return true;
        return false;
    }

    // Updated to use effectiveWhitelist
    isPhraseWhitelistedLocal(phrase) { // Renamed to avoid conflict if content.js has one
        if (this.effectiveWhitelist.size === 0) return false;
        const lowerCasePhrase = phrase.toLowerCase();
        // Check if *any* word in the phrase is in the effective whitelist
        const words = lowerCasePhrase.split(/\s+/).filter(w => w);
        for (const word of words) {
            if (this.effectiveWhitelist.has(word)) {
                return true;
            }
        }
        return false;
    }

    isPhraseBlacklistedLocal(phrase) { // Renamed
        const blacklist = this.settings.blacklist || [];
        if (blacklist.length === 0) return false;
        const lowerCasePhrase = phrase.toLowerCase();
        const words = lowerCasePhrase.split(/\s+/).filter(w => w);
        for (const word of words) {
            if (blacklist.includes(word)) { // Assuming blacklist is an array of strings
                return true;
            }
        }
        return false;
    }


    // --- Core Analysis Logic (Updated with Score) ---
    analyzeAndTrackFrequency(text) {
        const cleanText = stripMarkup(text); // Uses updated stripMarkup
        if (!cleanText.trim()) return;

        const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
        for (const sentence of sentences) {
            for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
                const ngrams = generateNgrams(sentence, n);
                for (const ngram of ngrams) {
                    // Using local checks and reinstated isPhraseLowQuality
                    if (this.isPhraseHandledByRegex(ngram) || this.isPhraseWhitelistedLocal(ngram) || this.isPhraseLowQuality(ngram)) {
                        continue;
                    }

                    const currentData = this.ngramFrequencies.get(ngram) || { count: 0, score: 0, lastSeenMessageIndex: this.totalAiMessagesProcessed };
                    
                    let scoreBoost = 1; // Base score increment
                    const words = ngram.split(' ');
                    // Calculate uncommon word count based on words NOT in effectiveWhitelist (which includes commonWords & defaultNames & user whitelist)
                    const uncommonWordCount = words.reduce((count, word) => count + (!this.effectiveWhitelist.has(word.toLowerCase()) ? 1 : 0), 0);

                    if (uncommonWordCount > 1) { // Boost if more than one uncommon word
                        scoreBoost += 1; // Simple boost, can be made more complex
                    }
                    
                    if (this.isPhraseBlacklistedLocal(ngram)) {
                        scoreBoost += SLOP_THRESHOLD; // Significant boost for blacklisted items
                    }

                    const newCount = currentData.count + 1;
                    const newScore = currentData.score + scoreBoost;

                    this.ngramFrequencies.set(ngram, {
                        count: newCount, // Keep count for raw frequency if ever needed
                        score: newScore, // Primary metric for slop
                        lastSeenMessageIndex: this.totalAiMessagesProcessed // Update last seen index
                    });

                    // Candidate if score reaches threshold
                    if (newScore >= SLOP_THRESHOLD && currentData.score < SLOP_THRESHOLD) {
                        this.processNewSlopCandidate(ngram);
                    }
                }
            }
        }
    }

    processNewSlopCandidate(newPhrase) {
        let isSubstring = false;
        const phrasesToRemove = [];
        for (const existingPhrase of this.slopCandidates) {
            if (existingPhrase.includes(newPhrase)) { isSubstring = true; break; }
            if (newPhrase.includes(existingPhrase)) { phrasesToRemove.push(existingPhrase); }
        }
        if (!isSubstring) {
            phrasesToRemove.forEach(phrase => this.slopCandidates.delete(phrase));
            this.slopCandidates.add(newPhrase);
        }
    }

    // Updated to use score
    pruneOldNgrams() {
        let prunedCount = 0;
        for (const [ngram, data] of this.ngramFrequencies.entries()) {
            if ((this.totalAiMessagesProcessed - data.lastSeenMessageIndex > PRUNE_AFTER_MESSAGES) && data.score < SLOP_THRESHOLD) {
                this.ngramFrequencies.delete(ngram);
                this.slopCandidates.delete(ngram); // Also remove from candidates if pruned
                prunedCount++;
            }
        }
        if (prunedCount > 0) console.log(`${LOG_PREFIX} Pruned ${prunedCount} old/low-score n-grams.`);
    }

    // Updated to use score
    pruneDuringManualAnalysis() {
        let prunedCount = 0;
        for (const [ngram, data] of this.ngramFrequencies.entries()) {
            // More aggressive pruning during manual analysis for very low scores
            if (data.score < 2 && data.count < 2) { // Example: prune if score is less than 2 AND seen only once
                this.ngramFrequencies.delete(ngram);
                this.slopCandidates.delete(ngram);
                prunedCount++;
            }
        }
        if (prunedCount > 0) {
            console.log(`${LOG_PREFIX} [Manual Analysis] Pruned ${prunedCount} very low-score n-grams from chunk.`);
        }
    }

    // Updated to use score
    findAndMergePatterns(frequenciesObject) { // frequenciesObject should contain { phrase: score }
        const culledFrequencies = cullSubstrings(frequenciesObject);
        const candidates = Object.entries(culledFrequencies).sort((a, b) => a[0].localeCompare(b[0])); // Sort by phrase for consistent grouping
        const mergedPatterns = {};
        const consumedIndices = new Set();

        for (let i = 0; i < candidates.length; i++) {
            if (consumedIndices.has(i)) continue;

            const [phraseA, scoreA] = candidates[i]; // Now scoreA
            const wordsA = phraseA.split(' ');
            let currentGroup = [{ index: i, phrase: phraseA, score: scoreA }]; // Store score

            for (let j = i + 1; j < candidates.length; j++) {
                const [phraseB, scoreB] = candidates[j]; // Now scoreB
                const wordsB = phraseB.split(' ');
                let commonPrefix = [];
                for (let k = 0; k < Math.min(wordsA.length, wordsB.length); k++) {
                    if (wordsA[k] === wordsB[k]) commonPrefix.push(wordsA[k]);
                    else break;
                }
                if (commonPrefix.length >= PATTERN_MIN_COMMON_WORDS) {
                     if (!consumedIndices.has(j)) {
                        currentGroup.push({ index: j, phrase: phraseB, score: scoreB }); // Store score
                     }
                } else {
                    break;
                }
            }

            if (currentGroup.length > 1) {
                let totalScore = 0; // Sum up scores for the pattern
                const variations = new Set();
                let commonPrefixString = '';
                const firstWords = currentGroup[0].phrase.split(' ');

                currentGroup.forEach(item => {
                    totalScore += item.score; // Sum scores
                    consumedIndices.add(item.index);
                    const itemWords = item.phrase.split(' ');
                    if (commonPrefixString === '') {
                        let prefixLength = firstWords.length;
                        for (let k = 1; k < currentGroup.length; k++) {
                            const otherWords = currentGroup[k].phrase.split(' ');
                            let currentPrefixLength = 0;
                            while(currentPrefixLength < prefixLength && currentPrefixLength < otherWords.length && firstWords[currentPrefixLength] === otherWords[currentPrefixLength]) {
                                currentPrefixLength++;
                            }
                            prefixLength = currentPrefixLength;
                        }
                        commonPrefixString = firstWords.slice(0, prefixLength).join(' ');
                    }
                    const variationPart = itemWords.slice(commonPrefixString.split(' ').length).join(' ').trim();
                    if (variationPart) variations.add(variationPart);
                });
                if (variations.size > 0 && commonPrefixString.length > 0) { // Ensure common prefix is not empty
                    const pattern = `${commonPrefixString} ${Array.from(variations).join('/')}`;
                    mergedPatterns[pattern] = totalScore; // Store total score for the pattern
                } else {
                     currentGroup.forEach(item => consumedIndices.add(item.index)); 
                }
            }
        }

        const remaining = {};
        for (let i = 0; i < candidates.length; i++) {
            if (!consumedIndices.has(i)) {
                const [phrase, score] = candidates[i];
                remaining[phrase] = score; // Store score for remaining
            }
        }
        return { merged: mergedPatterns, remaining: remaining };
    }

    // Updated to use score
    performIntermediateAnalysis() {
        const allCandidatesWithScores = [];
        for (const [phrase, data] of this.ngramFrequencies.entries()) {
            if (data.score > 1) { // Only consider phrases with score > 1
                allCandidatesWithScores.push([phrase, data.score]);
            }
        }
        allCandidatesWithScores.sort((a, b) => b[1] - a[1]); // Sort by score desc
        const limitedCandidates = allCandidatesWithScores.slice(0, CANDIDATE_LIMIT_FOR_ANALYSIS);

        if (allCandidatesWithScores.length > CANDIDATE_LIMIT_FOR_ANALYSIS) {
            console.log(`${LOG_PREFIX} [Perf] Limited candidates from ${allCandidatesWithScores.length} to ${CANDIDATE_LIMIT_FOR_ANALYSIS} BEFORE heavy processing.`);
        }
        const { merged, remaining } = this.findAndMergePatterns(Object.fromEntries(limitedCandidates));
        const mergedEntries = Object.entries(merged);
        mergedEntries.sort((a, b) => b[1] - a[1]);
        const allRemainingEntries = Object.entries(remaining);
        allRemainingEntries.sort((a, b) => b[1] - a[1]);
        this.analyzedLeaderboardData = {
            merged: mergedEntries,
            remaining: allRemainingEntries,
        };
    }

    // --- Rule Generation (Updated Prompt & API Call) ---
    async generateAndSaveDynamicRules(candidates, dynamicRulesRef) { // dynamicRulesRef is the array from content.js
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { // Check if window.isAppReady exists and is false
             console.warn(`${LOG_PREFIX} generateAndSaveDynamicRules called before app ready (window.isAppReady is false or undefined).`);
             this.toastr.info("SillyTavern is still loading, please wait to generate rules.");
             return 0;
        }
        if (candidates.length === 0) return 0;
        if (this.isProcessingAiRules) {
             console.warn(`${LOG_PREFIX} AI rule generation already in progress.`);
             return 0;
        }
        this.isProcessingAiRules = true;
        let addedCount = 0;
        console.log(`${LOG_PREFIX} Sending ${candidates.length} candidates/patterns for dynamic rule generation...`);
        const exampleOutputStructure = { scriptName: "Slopfix - A slow smile", findRegex: "\\b[Aa]\\s+(slow|small)\\s+smile\\s+(spreads?|creeps?)\\s+([Hh]is|[Hh]er)\\s+face\\b", replaceString: "{{random:A $1 smile touched $3 face,The corners of $3 mouth turned up in a $1 smile,A faint $1 smile played on $3 lips,$3 features softened with a $1 smile,Warmth infused $3 expression as a $1 smile appeared}}" };
        
        const systemPrompt = `You are a silent, efficient regex generation engine. Your SOLE purpose is to convert patterns of repetitive phrases into a single, valid JSON array of correction rules.

    **CRITICAL INSTRUCTIONS:**
    1.  **OUTPUT JSON ONLY:** Your entire response MUST be a raw JSON array \\\`[...]\\\`. Do NOT include any other text, explanations, apologies, or "thinking" blocks like \`<think>\`. Your output must be immediately parsable with \\\`JSON.parse()\\\`.
    2.  **ANALYZE INPUT PATTERNS:** The input phrases are patterns. Variations are separated by slashes ('/'). You MUST generalize from these patterns.
        -   **Example Input:** \`shakes his head frantically/slightly/violently\`
        -   **Your Task:** Recognize that 'frantically/slightly/violently' are variable adverbs. Your 'findRegex' should capture them. e.g., \`shakes (his|her) head (frantically|slightly|violently)\`
        -   **Example Input:** \`muffled against his chest/shirt/t-shirt\`
        -   **Your Task:** Recognize 'chest/shirt/t-shirt' are variable nouns. Your 'findRegex' should capture them. e.g., \`muffled against (his|her) (chest|shirt|t-shirt)\`
    3.  **GENERATE HIGH-QUALITY RULES:** For each valid pattern, create a JSON object with 'scriptName', 'findRegex', and 'replaceString'.
        -   **'findRegex'**: A valid JavaScript regex string. Use capture groups \`()\` for variable parts. Generalize pronouns (e.g., \`([Hh]is|[Hh]er|[Tt]heir)\`).
        -   **'replaceString'**: MUST contain **at least five (5)** creative, well-written alternatives in a \`{{random:alt1,alt2,...}}\` block. Use \`$1\`, \`$2\` for capture groups. Alternatives must be grammatically seamless. Avoid "purple prose."
    4.  **REJECT BAD PATTERNS:** If a pattern is too generic, conversational (e.g., "he said that"), or you cannot generate 5+ high-quality alternatives, **DO NOT** create a rule for it. Omit its object from the output array.
    5.  **FINAL OUTPUT:** If you create rules, your entire response is the JSON array. If you reject all candidates, your entire response is an empty array: \`[]\`.

    **EXAMPLE OF A SINGLE RULE OBJECT:**
    ${JSON.stringify(exampleOutputStructure, null, 2)}`;

        const userPrompt = `Detected repetitive phrase patterns:\n- ${candidates.join('\n- ')}\n\nGenerate the JSON array of regex rules now. Follow all instructions precisely.`;

        try {
            const apiUrl = 'https://text.pollinations.ai/openai'; 
            const modelName = 'deepseek-reasoning'; 

            const body = {
                model: modelName,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                response_format: { type: 'json_object' } 
            };

            console.log(`${LOG_PREFIX} Attempting rule generation via direct fetch to ${apiUrl} with JSON object response format.`);
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            
            const responseText = await response.text(); 
            if (!response.ok) {
                console.error(`${LOG_PREFIX} API Error (${response.status}): ${response.statusText}. Response: ${responseText.substring(0, 500)}`);
                this.toastr.error(`Prose Polisher: AI rule generation API error (${response.status}). See console.`);
                throw new Error(`API Error (${response.status}): ${response.statusText}`);
            }
            
            let newRules = [];
            try {
                const responseObject = JSON.parse(responseText); 
                const contentString = responseObject.choices[0]?.message?.content;
                if (!contentString) {
                    console.error(`${LOG_PREFIX} AI response content missing or malformed. Full response:`, responseObject);
                    throw new Error("AI response content missing or malformed.");
                }
                // Try to extract JSON array even if it's embedded
                const jsonMatch = contentString.match(/(\[[\s\S]*?\])/s); 
                if (jsonMatch && jsonMatch[1]) {
                    newRules = JSON.parse(jsonMatch[1]);
                } else {
                    console.error(`${LOG_PREFIX} Content from AI was not a parseable JSON array string. Content:`, contentString);
                    throw new Error("Content from AI was not a JSON array string.");
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to parse JSON from AI response. Error: ${e.message}. Raw response text:`, responseText);
                this.toastr.error("Prose Polisher: AI rule generation returned invalid data. See console.");
                // return 0; // Exit if parsing fails
            }

            for (const rule of newRules) {
                if (rule && rule.scriptName && rule.findRegex && rule.replaceString) {
                    try { new RegExp(rule.findRegex); } catch (e) { console.warn(`${LOG_PREFIX} AI generated an invalid regex for rule '${rule.scriptName}', skipping: ${e.message}`); continue; }
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
            console.error(`${LOG_PREFIX} Error during dynamic rule generation:`, error);
            // Toastr already handled for API error and parsing error
            if (!error.message.startsWith("API Error") && !error.message.startsWith("Content from AI")) {
                this.toastr.error("Prose Polisher: AI rule generation failed. See console for details.");
            }
        } finally {
            this.isProcessingAiRules = false;
            console.log(`${LOG_PREFIX} Dynamic rule generation finished. Added ${addedCount} rules.`);
            return addedCount;
        }
    }

    async manualAnalyzeChatHistory() {
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') {
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
        const totalMessages = chatMessages.length;
        let processedMessages = 0;
        let aiMessagesAnalyzed = 0;

        try {
            for (let i = 0; i < totalMessages; i++) {
                const message = chatMessages[i];
                if (message.is_user || !message.mes || typeof message.mes !== 'string') {
                    processedMessages++;
                    continue;
                }

                this.analyzeAndTrackFrequency(message.mes);
                aiMessagesAnalyzed++;
                processedMessages++;

                if (processedMessages % MANUAL_ANALYSIS_CHUNK_SIZE === 0) {
                    this.pruneDuringManualAnalysis(); 
                    console.log(`${LOG_PREFIX} [Manual Analysis] Processed ${processedMessages}/${totalMessages} messages...`);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            this.performIntermediateAnalysis();

            console.log(`${LOG_PREFIX} Manual chat history analysis complete. Analyzed ${aiMessagesAnalyzed} AI messages.`);
            this.toastr.success(`Prose Polisher: Chat history analysis complete! Analyzed ${aiMessagesAnalyzed} AI messages. View Frequency Data to see results.`, "Chat Analysis Complete", { timeOut: 7000 });

        } catch (error) {
            console.error(`${LOG_PREFIX} Error during manual chat history analysis:`, error);
            this.toastr.error("Prose Polisher: An error occurred during chat analysis. Check console.", "Chat Analysis Error");
        } finally {
            this.isAnalyzingHistory = false;
        }
    }


    async handleGenerateRulesFromAnalysisClick(dynamicRulesRef, regexNavigatorRef) {
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        if (this.isProcessingAiRules) { this.toastr.warning("Prose Polisher: AI rule generation is already in progress."); return; }
        
        this.performIntermediateAnalysis();
        const patternCandidates = this.analyzedLeaderboardData.merged.map(entry => entry[0]); 
        const individualCandidates = this.analyzedLeaderboardData.remaining.map(entry => entry[0]); 
        
        let allPotentialCandidates = [...patternCandidates, ...individualCandidates];
        
        if (allPotentialCandidates.length === 0 && this.slopCandidates.size === 0) {
             this.toastr.info("Prose Polisher: No slop candidates or patterns identified. Run analysis or wait for more messages.");
             return;
        }

        // Prioritize slopCandidates, then add unique patterns/individuals
        const candidatesForAI = Array.from(this.slopCandidates); 
        patternCandidates.forEach(p => { if (!candidatesForAI.includes(p)) candidatesForAI.push(p); });
        individualCandidates.forEach(i => { if (!candidatesForAI.includes(i)) candidatesForAI.push(i); });

        const batchToProcess = candidatesForAI.slice(0, BATCH_SIZE);

        if (batchToProcess.length === 0) {
            this.toastr.info("Prose Polisher: No more candidates to process in this batch.");
            return;
        }

        this.toastr.info(`Prose Polisher: Starting AI rule generation for ${batchToProcess.length} candidate patterns/phrases...`);
        const newRulesCount = await this.generateAndSaveDynamicRules(batchToProcess, dynamicRulesRef);

        // Remove processed candidates from slopCandidates (if they were there)
        batchToProcess.forEach(candidate => {
            this.slopCandidates.delete(candidate);
        });

        if (newRulesCount > 0) {
            this.toastr.success(`Prose Polisher: AI generated and saved ${newRulesCount} new rule(s) for the batch!`);
            if (regexNavigatorRef) {
                regexNavigatorRef.renderRuleList();
                regexNavigatorRef.open();
            }
        } else {
            this.toastr.info("Prose Polisher: AI rule generation complete for the batch. No new rules were created (or an error occurred).");
        }
        
        // Recalculate remaining based on what's left in slopCandidates and what wasn't in the batch from patterns/individuals
        const remainingSlop = Array.from(this.slopCandidates);
        const remainingPatterns = patternCandidates.filter(p => !batchToProcess.includes(p) && !remainingSlop.includes(p));
        const remainingIndividuals = individualCandidates.filter(i => !batchToProcess.includes(i) && !remainingSlop.includes(i) && !remainingPatterns.includes(i));
        const totalRemainingUnique = new Set([...remainingSlop, ...remainingPatterns, ...remainingIndividuals]).size;


        if (totalRemainingUnique > 0) {
            this.toastr.info(`Prose Polisher: Approx ${totalRemainingUnique} more unique candidates/patterns remaining. Click "Generate AI Rules" again to process the next batch.`);
        } else if (newRulesCount === 0 && batchToProcess.length > 0) {
             // If no rules were made from the batch, but there were candidates
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed or filtered by the AI.");
        } else if (newRulesCount > 0) {
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed.");
        }
    }

    showFrequencyLeaderboard() {
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        if (!this.isAnalyzingHistory) { 
            this.performIntermediateAnalysis();
        }
        const { merged: mergedEntries, remaining: remainingEntries } = this.analyzedLeaderboardData;
        let contentHtml;
        if (mergedEntries.length === 0 && remainingEntries.length === 0) {
            contentHtml = '<p>No repetitive phrases have been detected that meet display criteria.</p>';
        } else {
            const mergedRows = mergedEntries.map(([phrase, score]) => `<tr class="is-pattern"><td>${phrase}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            const remainingRows = remainingEntries.map(([phrase, score]) => `<tr><td>${phrase}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            contentHtml = `<p>The following have been detected as repetitive. Phrases in <strong>bold orange</strong> are detected patterns. Score is based on frequency and stylistic uniqueness.</p>
                           <table class="prose-polisher-frequency-table">
                               <thead><tr><th>Repetitive Phrase or Pattern</th><th>Slop Score</th></tr></thead>
                               <tbody>${mergedRows}${remainingRows}</tbody>
                           </table>`;
        }
        this.callGenericPopup(contentHtml, this.POPUP_TYPE.TEXT, "Live Frequency Data (Slop Score)", { wide: true, large: true });
    }

    showWhitelistManager() {
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        const settings = this.settings;
        const container = document.createElement('div');
        container.className = 'prose-polisher-whitelist-manager';
        container.innerHTML = `
            <h4>Whitelist Manager</h4>
            <p>Add approved words to this list (e.g., character names, specific jargon). Phrases containing these words will be <strong>ignored</strong> by the frequency analyzer. A default list of common proper names and common English words is already included for scoring purposes but won't prevent analysis unless explicitly added here by you.</p>
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
            (settings.whitelist || []).sort().forEach(word => {
                const item = document.createElement('li');
                item.className = 'list-item';
                item.innerHTML = `<span>${word}</span><i class="fa-solid fa-trash-can delete-btn" data-word="${word}"></i>`;
                item.querySelector('.delete-btn').addEventListener('pointerup', () => {
                    settings.whitelist = (settings.whitelist || []).filter(w => w !== word);
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
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        const settings = this.settings;
        const container = document.createElement('div');
        container.className = 'prose-polisher-blacklist-manager';
        container.innerHTML = `
            <h4>Blacklist Manager</h4>
            <p>Add banned words to this list. Any phrase containing these words will be <strong>heavily prioritized</strong> for slop analysis (higher score), making them much more likely to have rules generated.</p>
            <div class="list-container">
                <ul id="pp-blacklist-list"></ul>
            </div>
            <div class="add-controls">
                <input type="text" id="pp-blacklist-input" class="text_pole" placeholder="Add a word to prioritize...">
                <button id="pp-blacklist-add-btn" class="menu_button">Add</button>
            </div>
        `;
        const listElement = container.querySelector('#pp-blacklist-list');
        const inputElement = container.querySelector('#pp-blacklist-input');
        const addButton = container.querySelector('#pp-blacklist-add-btn');

        const renderBlacklist = () => {
            listElement.innerHTML = '';
            (settings.blacklist || []).sort().forEach(word => {
                const item = document.createElement('li');
                item.className = 'list-item';
                item.innerHTML = `<span>${word}</span><i class="fa-solid fa-trash-can delete-btn" data-word="${word}"></i>`;
                item.querySelector('.delete-btn').addEventListener('pointerup', () => {
                    settings.blacklist = (settings.blacklist || []).filter(w => w !== word);
                    this.saveSettingsDebounced();
                    renderBlacklist(); // No need to updateEffectiveWhitelist for blacklist
                });
                listElement.appendChild(item);
            });
        };

        const addWord = () => {
            const newWord = inputElement.value.trim().toLowerCase();
            if (newWord && !(settings.blacklist || []).includes(newWord)) {
                if (!settings.blacklist) settings.blacklist = [];
                settings.blacklist.push(newWord);
                this.saveSettingsDebounced();
                renderBlacklist();
                inputElement.value = '';
            }
            inputElement.focus();
        };
        addButton.addEventListener('pointerup', addWord);
        inputElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });
        renderBlacklist();
        this.callGenericPopup(container, this.POPUP_TYPE.DISPLAY, "Blacklist Manager", { wide: false, large: false });
    }


    clearFrequencyData() {
        if (!window.isAppReady && typeof window.isAppReady !== 'undefined') { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        this.ngramFrequencies.clear();
        this.slopCandidates.clear();
        this.messageCounterForTrigger = 0;
        // this.totalAiMessagesProcessed = 0; // Don't reset this, as it's a global counter for pruning logic
        this.analyzedLeaderboardData = { merged: [], remaining: [] };
        this.toastr.success("Prose Polisher frequency data cleared!");
    }

    incrementProcessedMessages() {
         this.totalAiMessagesProcessed++;
    }

    checkDynamicRuleTrigger(dynamicRulesRef, regexNavigatorRef) { 
        if (this.settings.isDynamicEnabled && (this.slopCandidates.size > 0 || this.analyzedLeaderboardData.merged.length > 0)) {
            this.messageCounterForTrigger++;
            if (this.messageCounterForTrigger >= this.settings.dynamicTriggerCount) {
                this.messageCounterForTrigger = 0;
                
                let candidatesForAutoTrigger = Array.from(this.slopCandidates);
                if (candidatesForAutoTrigger.length < BATCH_SIZE) {
                    const patternCandidates = this.analyzedLeaderboardData.merged.map(entry => entry[0]);
                    patternCandidates.forEach(p => {
                        if (candidatesForAutoTrigger.length < BATCH_SIZE && !candidatesForAutoTrigger.includes(p)) {
                            candidatesForAutoTrigger.push(p);
                        }
                    });
                }
                candidatesForAutoTrigger = candidatesForAutoTrigger.slice(0, BATCH_SIZE);

                if (candidatesForAutoTrigger.length > 0) {
                    this.toastr.info(`Prose Polisher: Auto-triggering AI rule generation for ${candidatesForAutoTrigger.length} slop phrases/patterns...`);
                    this.generateAndSaveDynamicRules(candidatesForAutoTrigger, dynamicRulesRef).then(newRulesCount => {
                        if (newRulesCount > 0) {
                            // Remove successfully processed candidates from slopCandidates
                            candidatesForAutoTrigger.forEach(candidate => this.slopCandidates.delete(candidate));
                            if (regexNavigatorRef) regexNavigatorRef.renderRuleList();
                        }
                    });
                }
            }
        } else {
            this.messageCounterForTrigger = 0;
        }
    }
}
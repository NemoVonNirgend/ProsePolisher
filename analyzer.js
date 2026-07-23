import { getContext } from '../../../extensions.js';
import { generateText } from './generation.js';
import { normalizeRule, validateGeneratedRule } from './rule-utils.js';
import { prompts } from './prompts.js'; // <-- IMPORT THE NEW PROMPTS FILE

// Import all new and existing data files
import { commonWords } from './common_words.js';
import { defaultNames } from './default_names.js';
import { lemmaMap } from './lemmas.js';

const LOG_PREFIX = `[ProsePolisher:Analyzer]`;

// Constants
const BATCH_SIZE = 15; // Number of final candidates to send to AI for regex generation
const PRESCREEN_BATCH_SIZE = 50; // Maximum candidates sent for AI review
const CANDIDATE_LIMIT_FOR_ANALYSIS = 2000;
const NGRAM_MIN = 3; // The minimum n-gram size is fundamental to the logic.
const MIN_ALTERNATIVES_PER_RULE = 15;


// Utility Functions
function stripMarkup(text) {
    if (!text) return '';
    let cleanText = text;

    // Remove code blocks first
    cleanText = cleanText.replace(/(?:```|~~~)\w*\s*[\s\S]*?(?:```|~~~)/g, ' ');
    // Remove specific HTML tags and their content
    cleanText = cleanText.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    // Remove any remaining HTML tags
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    // Remove markdown emphasis but keep the text
    cleanText = cleanText.replace(/(?:\*|_|~|`)+(.+?)(?:\*|_|~|`)+/g, '$1');
    // Remove content in quotes and parentheses, which often cause fragments
    cleanText = cleanText.replace(/"(.*?)"/g, ' $1 ');
    cleanText = cleanText.replace(/\((.*?)\)/g, ' $1 ');
    // Collapse multiple spaces and trim
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

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
        this.analyzedLeaderboardData = { merged: {}, remaining: {} };
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
        let maxWeight = 0;
        for (const blacklistedTerm in blacklist) {
            if (lowerCasePhrase.includes(blacklistedTerm)) {
                maxWeight = Math.max(maxWeight, blacklist[blacklistedTerm]);
            }
        }
        return maxWeight;
    }

    analyzeAndTrackFrequency(text) {
        const cleanText = stripMarkup(text);
        if (!cleanText.trim()) return;

        const NGRAM_MAX = this.settings.ngramMax || 10;
        const SLOP_THRESHOLD = this.settings.slopThreshold || 3.0;

        // CRITICAL CHANGE: Split text into sentences first to prevent cross-sentence n-grams.
        const sentences = cleanText.match(/[^.!?]+[.!?]+["]?/g) || [cleanText];

        for (const sentence of sentences) {
            if (!sentence.trim()) continue;

            const isDialogue = /["']/.test(sentence.trim().substring(0, 10));
            const chunkType = isDialogue ? 'dialogue' : 'narration';

            const originalWords = sentence.replace(/[.,!?]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
            const lemmatizedWords = originalWords.map(word => lemmaMap.get(word) || word);

            for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
                if (originalWords.length < n) continue;

                const originalNgrams = generateNgrams(originalWords, n);
                const lemmatizedNgrams = generateNgrams(lemmatizedWords, n);

                for (let i = 0; i < originalNgrams.length; i++) {
                    const originalNgram = originalNgrams[i];
                    const lemmatizedNgram = lemmatizedNgrams[i];

                    if (this.compiledRegexes.some(regex => regex.test(originalNgram.toLowerCase())) || this.isPhraseLowQuality(originalNgram)) {
                        continue;
                    }

                    const currentData = this.ngramFrequencies.get(lemmatizedNgram) || { count: 0, score: 0, lastSeenMessageIndex: this.totalAiMessagesProcessed, original: originalNgram, contextSentence: sentence };

                    let scoreIncrement = 1.0;
                    
                    scoreIncrement += (n - NGRAM_MIN) * 0.2;
                    const uncommonWordCount = originalNgram.split(' ').reduce((count, word) => count + (this.effectiveWhitelist.has(word) ? 0 : 1), 0);
                    scoreIncrement += uncommonWordCount * 0.5;
                    scoreIncrement += this.getBlacklistWeight(originalNgram);
                    if (chunkType === 'narration') {
                        scoreIncrement *= 1.25;
                    }

                    const newCount = currentData.count + 1;
                    const newScore = currentData.score + scoreIncrement;

                    this.ngramFrequencies.set(lemmatizedNgram, {
                        count: newCount,
                        score: newScore,
                        lastSeenMessageIndex: this.totalAiMessagesProcessed,
                        original: originalNgram, 
                        contextSentence: sentence,
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
        const PRUNE_AFTER_MESSAGES = this.settings.pruningCycle || 20;
        const SLOP_THRESHOLD = this.settings.slopThreshold || 3.0;
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
        const PATTERN_MIN_COMMON_WORDS = this.settings.patternMinCommon || 3;
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
            merged: Object.fromEntries(mergedEntries),
            remaining: Object.fromEntries(allRemainingEntries),
        };
    }

    async reviewSlopCandidates(candidates) {
        if (!candidates || candidates.length === 0) return [];

        const systemPrompt = prompts.reviewSlopCandidates;
        const userPrompt = `Evaluate these candidates using only their supplied real chat context:\n${JSON.stringify(candidates, null, 2)}\n\nProvide the JSON array of evaluations now.`;

        try {
            this.toastr.info("Prose Polisher: Reviewing slop candidates...", "Prose Polisher", { timeOut: 7000 });
            const rawResponse = await generateText(`${systemPrompt}\n\n${userPrompt}`);
            if (!rawResponse || !rawResponse.trim()) {
                console.warn(`${LOG_PREFIX} Candidate review returned an empty response.`);
                return candidates;
            }

            let reviewResults = [];
            try {
                const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*?\])/s);
                if (jsonMatch) {
                    const jsonString = jsonMatch[1] || jsonMatch[2];
                    const parsedData = JSON.parse(jsonString);
                    reviewResults = Array.isArray(parsedData) ? parsedData : [parsedData];
                } else {
                     const parsedData = JSON.parse(rawResponse);
                     reviewResults = Array.isArray(parsedData) ? parsedData : [parsedData];
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to parse JSON from candidate-review response. Error: ${e.message}. Raw response:`, rawResponse);
                this.toastr.error("Prose Polisher: Candidate review returned invalid data. See console.");
                return candidates;
            }

            const sourceByCandidate = new Map(candidates.map(candidate => [candidate.candidate, candidate]));
            const validCandidates = reviewResults
                .filter(result => result.valid_for_regex && sourceByCandidate.has(result.candidate))
                .map(result => sourceByCandidate.get(result.candidate));
            
            const rejectedCount = reviewResults.length - validCandidates.length;
            if (rejectedCount > 0) {
                 console.log(`${LOG_PREFIX} Candidate review rejected ${rejectedCount} slop candidates during pre-screening.`);
            }

            this.toastr.success(`Prose Polisher reviewed ${candidates.length} candidates. ${validCandidates.length} approved.`, "Prose Polisher", { timeOut: 4000 });
            return validCandidates;

        } catch (error) {
            console.error(`${LOG_PREFIX} Error during candidate review:`, error);
            this.toastr.error(`Candidate review failed: ${error.message}. Proceeding with raw candidates.`, "Prose Polisher");
            return candidates;
        }
    }

    async generateAndSaveDynamicRules(candidatesForGeneration, dynamicRulesRef) {
        if (!window.isAppReady) {
            this.toastr.info('SillyTavern is still loading, please wait to generate rules.');
            return 0;
        }

        const defaultPrompt = prompts.generateAndSaveDynamicRules.replace(
            /\$\{MIN_ALTERNATIVES_PER_RULE\}/g,
            MIN_ALTERNATIVES_PER_RULE,
        );
        const promptTemplate = this.settings.regexGenerationInstructions || defaultPrompt;
        const candidatePayload = JSON.stringify(candidatesForGeneration, null, 2);
        const fullPrompt = promptTemplate.includes('{{CANDIDATES}}')
            ? promptTemplate.replaceAll('{{CANDIDATES}}', candidatePayload)
            : `${promptTemplate}\n\nGenerate rules for these candidates:\n${candidatePayload}`;

        let addedCount = 0;
        try {
            this.toastr.info(
                `Generating replacement rules for ${candidatesForGeneration.length} candidates using the current connection...`,
                'Prose Polisher',
                { timeOut: 25000 },
            );
            const rawResponse = await generateText(fullPrompt);
            if (!rawResponse?.trim()) {
                this.toastr.warning('Rule generation returned no data.');
                return 0;
            }

            let generatedRules;
            try {
                const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*?\])/s);
                const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : rawResponse);
                generatedRules = Array.isArray(parsed) ? parsed : [parsed];
            } catch (error) {
                console.error(`${LOG_PREFIX} Failed to parse generated rules:`, error, rawResponse);
                this.toastr.error('Rule generation returned invalid JSON. See the console.');
                return 0;
            }

            for (const candidateRule of generatedRules) {
                if (!candidateRule?.scriptName || !candidateRule?.findRegex ||
                    (!candidateRule?.alternatives && !candidateRule?.replaceString)) {
                    continue;
                }

                const rule = normalizeRule(candidateRule);
                const validation = validateGeneratedRule(rule, MIN_ALTERNATIVES_PER_RULE);
                if (!validation.valid) {
                    console.warn(`${LOG_PREFIX} Rejected generated rule '${rule.scriptName}':`, validation.errors);
                    continue;
                }

                rule.id = `DYN_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                rule.disabled = !this.settings.autoActivateGeneratedRules;
                rule.isStatic = false;
                rule.isNew = true;
                dynamicRulesRef.push(rule);
                addedCount++;
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
            console.error(`${LOG_PREFIX} Dynamic rule generation failed:`, error);
            this.toastr.error(`Rule generation failed: ${error.message}`);
        }

        console.log(`${LOG_PREFIX} Rule generation finished. Added ${addedCount} rules.`);
        return addedCount;
    }

    async handleGenerateRulesFromAnalysisClick(dynamicRulesRef, regexNavigatorRef) {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        if (this.isProcessingAiRules) { this.toastr.warning("Prose Polisher: AI rule generation is already in progress."); return; }
        
        this.performIntermediateAnalysis();
        
        // --- START: REVISED CANDIDATE GATHERING LOGIC ---
        const candidatesForAi = [];
        const contextMap = new Map();
        for (const data of this.ngramFrequencies.values()) {
            contextMap.set(data.original, data.contextSentence);
        }

        // 1. Process merged patterns
        for (const [pattern, score] of Object.entries(this.analyzedLeaderboardData.merged)) {
            candidatesForAi.push({
                candidate: pattern,
                enhanced_context: pattern, // For patterns, the pattern itself is the best context
                score: score,
            });
        }

        // 2. Process remaining individual phrases
        for (const [phrase, score] of Object.entries(this.analyzedLeaderboardData.remaining)) {
            candidatesForAi.push({
                candidate: phrase,
                enhanced_context: contextMap.get(phrase) || phrase, // Use real sentence context
                score: score,
            });
        }

        // 3. Sort all candidates together by score
        candidatesForAi.sort((a, b) => b.score - a.score);
        
        if (candidatesForAi.length === 0) {
             this.toastr.info("Prose Polisher: No slop candidates or patterns identified. Run analysis or wait for more messages.");
             return;
        }
        // --- END: REVISED CANDIDATE GATHERING LOGIC ---

        const candidatesForPreScreening = candidatesForAi.slice(0, PRESCREEN_BATCH_SIZE);
        let validCandidatesForGeneration = [];
        
        if (this.settings.skipTriageCheck) {
            console.log(`${LOG_PREFIX} [Manual Gen] Skip Triage is enabled. Using direct candidates.`);
            validCandidatesForGeneration = candidatesForPreScreening;
        } else {
            validCandidatesForGeneration = await this.reviewSlopCandidates(candidatesForPreScreening);
        }

        const batchToProcess = validCandidatesForGeneration.slice(0, BATCH_SIZE);

        if (batchToProcess.length === 0) {
            this.toastr.info("Prose Polisher: AI pre-screening found no valid slop candidates for rule generation.");
            return;
        }
        
        this.isProcessingAiRules = true; 
        let newRulesCount = 0;

        try {
            this.toastr.info(
                `Starting AI rule generation for ${batchToProcess.length} candidates using the current connection...`,
            );
            newRulesCount = await this.generateAndSaveDynamicRules(batchToProcess, dynamicRulesRef);
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
        
        const remainingCandidateCount = Object.keys(this.analyzedLeaderboardData.merged).length + Object.keys(this.analyzedLeaderboardData.remaining).length;

        if (remainingCandidateCount > 0) {
            this.toastr.info(`Prose Polisher: Approx ${remainingCandidateCount} more unique candidates/patterns remaining. Click "Generate AI Rules" again to process the next batch.`);
        } else if (newRulesCount === 0 && batchToProcess.length > 0) { 
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed or filtered by the AI.");
        } else if (newRulesCount > 0 && remainingCandidateCount === 0) { 
             this.toastr.info("Prose Polisher: All identified slop candidates and patterns have been processed.");
        }
    }

    showFrequencyLeaderboard() {
        if (typeof window.isAppReady === 'undefined' || !window.isAppReady) { this.toastr.info("SillyTavern is still loading, please wait."); return; }
        
        const { merged: mergedEntries, remaining: remainingEntries } = this.analyzedLeaderboardData;
        let contentHtml;
        const isProcessedDataAvailable = (mergedEntries && Object.keys(mergedEntries).length > 0) || (remainingEntries && Object.keys(remainingEntries).length > 0);

        if (isProcessedDataAvailable) {
            // Path 1: Show the fully processed, patterned data (the best view)
            const mergedRows = Object.entries(mergedEntries).map(([phrase, score]) => `<tr class="is-pattern"><td>${this.escapeHtml(phrase)}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            const remainingRows = Object.entries(remainingEntries).map(([phrase, score]) => `<tr><td>${this.escapeHtml(phrase)}</td><td>${score.toFixed(1)}</td></tr>`).join('');
            
            contentHtml = `<p>Showing <strong>processed and patterned</strong> slop data. Phrases in <strong>bold orange</strong> are detected patterns. This list updates automatically every 10 messages.</p>
                           <table class="prose-polisher-frequency-table">
                               <thead><tr><th>Repetitive Phrase or Pattern</th><th>Slop Score</th></tr></thead>
                               <tbody>${mergedRows}${remainingRows}</tbody>
                           </table>`;
        } else if (this.ngramFrequencies.size > 0) {
            // Path 2 (Fallback): Show raw, unprocessed data for immediate feedback
            const rawEntries = Array.from(this.ngramFrequencies.values())
                .filter(data => data.score > 0) // Only show items with a score
                .sort((a, b) => b.score - a.score);

            const rawRows = rawEntries.map(data => `<tr><td>${this.escapeHtml(data.original)}</td><td>${data.score.toFixed(1)}</td></tr>`).join('');
            
            contentHtml = `<p>Showing <strong>raw, unprocessed</strong> n-grams detected so far. This data is collected on every AI message and will be processed into patterns periodically.</p>
                           <table class="prose-polisher-frequency-table">
                               <thead><tr><th>Detected Phrase</th><th>Slop Score</th></tr></thead>
                               <tbody>${rawRows}</tbody>
                           </table>`;
        } else {
            // Path 3 (Final Fallback): Nothing has been detected at all
            contentHtml = '<p>No repetitive phrases have been detected yet. Send some AI messages to begin analysis.</p>';
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
        this.analyzedLeaderboardData = { merged: {}, remaining: {} };
        this.toastr.success("Prose Polisher frequency data cleared!");
    }

    incrementProcessedMessages() {
         this.totalAiMessagesProcessed++;
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
        const worker = new Worker('./scripts/extensions/third-party/ProsePolisher/analyzer.worker.js', { type: 'module' });

        // Serialize RegExp objects into strings for the worker, as RegExp objects cannot be cloned.
        const compiledRegexSources = this.compiledRegexes.map(r => r.source);

        worker.postMessage({
            type: 'startAnalysis',
            chatMessages: chatMessages,
            settings: this.settings,
            compiledRegexSources: compiledRegexSources, // Pass serializable sources instead of RegExp objects
        });

        worker.onmessage = (e) => {
            const { type, processed, total, aiAnalyzed, analyzedLeaderboardData, slopCandidates, ngramFrequencies } = e.data;
            if (type === 'progress') {
                this.toastr.info(`Prose Polisher: Analyzing chat history... ${processed}/${total} messages processed.`, "Chat Analysis", { timeOut: 1000 });
                console.log(`${LOG_PREFIX} [Manual Analysis] Processed ${processed}/${total} messages...`);
            } else if (type === 'complete') {
                console.log(`${LOG_PREFIX} Worker complete message received. Data from worker:`, e.data);

                // Fully synchronize the main analyzer's state with the worker's results.
                this.analyzedLeaderboardData = analyzedLeaderboardData;
                this.ngramFrequencies = ngramFrequencies; // Adopt the frequency map from the worker.
                this.slopCandidates = new Set(slopCandidates); // Reconstruct Set from array
                this.isAnalyzingHistory = false;

                // Prime the trigger counter if the analysis found slop, so self-learning can fire on the next message.
                if (slopCandidates && slopCandidates.length > 0) {
                    this.messageCounterForTrigger = this.settings.dynamicTriggerCount;
                    console.log(`${LOG_PREFIX} Manual analysis found slop. Priming trigger counter to ${this.messageCounterForTrigger}.`);
                    this.toastr.info("Prose Polisher: Slop found! Self-learning is armed and will trigger on your next message.", "Chat Analysis Complete");
                } else {
                    this.toastr.success(`Prose Polisher: Chat history analysis complete! Analyzed ${aiAnalyzed} AI messages. No new slop candidates found.`, "Chat Analysis Complete", { timeOut: 7000 });
                }
                
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

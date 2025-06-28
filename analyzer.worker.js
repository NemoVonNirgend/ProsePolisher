import { commonWords } from './common_words.js';
import { defaultNames } from './default_names.js';
import { lemmaMap } from './lemmas.js';

// Constants
const NGRAM_MIN = 3; // The minimum n-gram size is fundamental to the logic.
const CANDIDATE_LIMIT_FOR_ANALYSIS = 2000;

// Utility Functions (copied from analyzer.js)
function stripMarkup(text) {
    if (!text) return '';
    let cleanText = text;

    cleanText = cleanText.replace(/(?:```|~~~)\w*\s*[\s\S]*?(?:```|~~~)/g, ' ');
    cleanText = cleanText.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    cleanText = cleanText.replace(/(?:\*|_|~|`)+(.+?)(?:\*|_|~|`)+/g, '$1');
    cleanText = cleanText.replace(/"(.*?)"/g, ' $1 ');
    cleanText = cleanText.replace(/\((.*?)\)/g, ' $1 ');
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

class AnalyzerWorker {
    constructor(settings, compiledRegexSources) {
        this.settings = settings;
        // Reconstruct RegExp objects from their string sources
        this.compiledRegexes = (compiledRegexSources || []).map(source => {
            try {
                return new RegExp(source, 'i');
            } catch (e) {
                console.warn(`[ProsePolisher:AnalyzerWorker] Invalid regex source received: ${source}`, e);
                return null;
            }
        }).filter(Boolean);

        this.ngramFrequencies = new Map();
        this.slopCandidates = new Set();
        this.analyzedLeaderboardData = { merged: {}, remaining: {} };
        this.totalAiMessagesProcessed = 0;

        this.effectiveWhitelist = new Set();
        this.updateEffectiveWhitelist();
    }

    updateEffectiveWhitelist() {
        const userWhitelist = new Set((this.settings.whitelist || []).map(w => w.toLowerCase()));
        this.effectiveWhitelist = new Set([...defaultNames, ...commonWords, ...userWhitelist]);
    }

    isPhraseLowQuality(phrase) {
        const words = phrase.toLowerCase().split(' ');

        if (words.length < NGRAM_MIN) return true;

        const allWhitelisted = words.every(word => this.effectiveWhitelist.has(word));
        if (allWhitelisted) return true;
        
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

    isPhraseHandledByRegexWorker(phrase) {
        const lowerCasePhrase = phrase.toLowerCase();
        for (const regex of this.compiledRegexes) {
            if (regex.test(lowerCasePhrase)) {
                return true;
            }
        }
        return false;
    }

    analyzeAndTrackFrequency(text) {
        const cleanText = stripMarkup(text);
        if (!cleanText.trim()) return;

        const NGRAM_MAX = this.settings.ngramMax || 10;
        const SLOP_THRESHOLD = this.settings.slopThreshold || 3.0;

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

                    if (this.isPhraseHandledByRegexWorker(originalNgram) || this.isPhraseLowQuality(originalNgram)) {
                        continue;
                    }

                    const currentData = this.ngramFrequencies.get(lemmatizedNgram) || { count: 0, score: 0, lastSeenMessageIndex: this.totalAiMessagesProcessed, original: originalNgram };

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
        if (prunedCount > 0) console.log(`[ProsePolisher:AnalyzerWorker] Pruned ${prunedCount} old/low-score n-grams.`);
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
            console.log(`[ProsePolisher:AnalyzerWorker] [Manual Analysis] Pruned ${prunedCount} very low-score n-grams from chunk.`);
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
            console.log(`[ProsePolisher:AnalyzerWorker] [Perf] Limited candidates from ${Object.keys(candidatesWithData).length} to ${CANDIDATE_LIMIT_FOR_ANALYSIS} BEFORE heavy processing.`);
        }
        
        const { merged, remaining } = this.findAndMergePatterns(limitedCandidates);
        
        const mergedEntries = Object.entries(merged).sort((a, b) => b[1] - a[1]);
        const allRemainingEntries = Object.entries(remaining).sort((a, b) => b[1] - a[1]);
        
        this.analyzedLeaderboardData = {
            merged: Object.fromEntries(mergedEntries),
            remaining: Object.fromEntries(allRemainingEntries),
        };
    }

    // Main message handler for the worker
    async processChatHistory(chatMessages, settings) {
        this.settings = settings;
        this.updateEffectiveWhitelist(); // Update whitelist based on new settings

        this.ngramFrequencies.clear();
        this.slopCandidates.clear();
        this.totalAiMessagesProcessed = 0;

        const totalMessages = chatMessages.length;
        let processedMessages = 0;
        let aiMessagesAnalyzed = 0;

        for (let i = 0; i < totalMessages; i++) {
            const message = chatMessages[i];
            if (message.is_user || !message.mes || typeof message.mes !== 'string') {
                processedMessages++;
                continue;
            }

            this.analyzeAndTrackFrequency(message.mes);
            aiMessagesAnalyzed++;
            this.totalAiMessagesProcessed++; // Increment total messages processed for pruning logic
            processedMessages++;

            if (processedMessages % 5 === 0) { // Report progress every 5 messages
                this.pruneDuringManualAnalysis();
                postMessage({
                    type: 'progress',
                    processed: processedMessages,
                    total: totalMessages,
                    aiAnalyzed: aiMessagesAnalyzed
                });
            }
        }

        this.performIntermediateAnalysis();
        this.pruneOldNgrams(); // Final prune

        const slopCandidatesLemmatized = Array.from(this.slopCandidates);

        console.log(`[ProsePolisher:AnalyzerWorker] Sending complete message. aiMessagesAnalyzed: ${aiMessagesAnalyzed}`);
        postMessage({
            type: 'complete',
            analyzedLeaderboardData: this.analyzedLeaderboardData,
            slopCandidates: slopCandidatesLemmatized,
            ngramFrequencies: this.ngramFrequencies, // Send the full frequency map back
            aiMessagesAnalyzed: aiMessagesAnalyzed
        });
    }
}

let analyzerWorkerInstance = null;

onmessage = async function(e) {
    try {
        const { type, chatMessages, settings, compiledRegexSources } = e.data;

        if (type === 'startAnalysis') {
            if (!analyzerWorkerInstance) {
                // Pass the serializable regex sources to the constructor
                analyzerWorkerInstance = new AnalyzerWorker(settings, compiledRegexSources);
            }
            // processChatHistory no longer needs the regexes passed directly
            await analyzerWorkerInstance.processChatHistory(chatMessages, settings);
        }
    } catch (error) {
        console.error("[ProsePolisher:AnalyzerWorker] Uncaught error in worker onmessage:", error);
        throw error; // Re-throw to ensure the main thread's onerror handler is triggered.
    }
};
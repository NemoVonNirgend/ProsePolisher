// C:\SillyTavern\public\scripts\extensions\third-party\ProsePolisher\content.js
import { eventSource, event_types } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { openai_setting_names } from '../../../../scripts/openai.js';
// Import Generate is NOT needed anymore as we don't re-trigger generation

// Local module imports
import { PresetNavigator, injectNavigatorModal } from './navigator.js';
import { runGremlinPlanningPipeline, applyGremlinEnvironment, executeGen } from './projectgremlin.js';

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
export const EXTENSION_NAME = "ProsePolisher";
const LOG_PREFIX = `[${EXTENSION_NAME}]`;
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const SLOP_THRESHOLD = 3;
const BATCH_SIZE = 5;
const MANUAL_ANALYSIS_CHUNK_SIZE = 20;
const HEAVY_ANALYSIS_INTERVAL = 200;
const CANDIDATE_LIMIT_FOR_ANALYSIS = 2000;
const PRUNE_AFTER_MESSAGES = 20;
const PRUNE_CHECK_INTERVAL = 10;
const NGRAM_MIN = 3;
const NGRAM_MAX = 10;
const PATTERN_MIN_COMMON_WORDS = 3;

// --- State Variables ---
let staticRules = [];
let dynamicRules = [];
let ngramFrequencies = new Map();
let messageCounterForTrigger = 0;
let totalAiMessagesProcessed = 0;
let isProcessingAiRules = false;
let isAnalyzingHistory = false;
let regexNavigator;
let slopCandidates = new Set();
let analyzedLeaderboardData = { merged: [], remaining: [] };
let isPipelineRunning = false; // Flag to prevent recursive triggering
let isAppReady = false; // Flag to indicate if SillyTavern APP_READY event has fired
let readyQueue = []; // Queue for functions to run after APP_READY

const SUGGESTED_MODELS = {
    papa: [
        { name: "Claude 4.0 Opus (Anthropic API)", api: "claude", model: "claude-4.0-opus-20240627" },
        { name: "Gemini 2.5 Pro (Google API)", api: "google", model: "gemini-2.5-pro" },
        { name: "DeepSeek Reasoning R1 (DeepSeek API)", api: "openai", source: "DeepSeek", model: "deepseek-r1-reasoning-20240615" },
        { name: "GPT-4o (OpenAI API)", api: "openai", model: "gpt-4o" },
    ],
    twins: [
        { name: "Claude 3.7 Haiku (Anthropic API)", api: "claude", model: "claude-3.7-haiku-20240627" },
        { name: "Gemini 2.5 Flash Lite (Google API)", api: "google", model: "gemini-2.5-flash-lite-preview-06-17" },
        { name: "Llama 3.1 8B (Free / OpenRouter)", api: "openrouter", model: "meta-llama/llama-3.1-8b-instruct:free" },
        { name: "Gemma 3 4B (Free / OpenRouter)", api: "openrouter", model: "google/gemma-3-4b-it:free" },
    ],
    mama: [
        { name: "Claude 3.7 Sonnet (Anthropic API)", api: "claude", model: "claude-3.7-sonnet" },
        { name: "Gemini 2.5 Flash (Google API)", api: "google", model: "gemini-2.5-flash" },
        { name: "DeepSeek R1 (Free / OpenRouter)", api: "openrouter", model: "deepseek/deepseek-r1-0528:free" },
        { name: "GPT-4o Mini (OpenAI API)", api: "openai", model: "gpt-4o-mini" },
    ],
    writer: [
        { name: "Claude 4.0 Opus (Anthropic API)", api: "claude", model: "claude-4.0-opus-20240627" },
        { name: "Nous Hermes 3 405B (OpenRouter)", api: "openrouter", model: "nousresearch/hermes-3-llama-3.1-405b" },
        { name: "Qwen3 235B A22B (Free / OpenRouter)", api: "openrouter", model: "qwen/qwen3-235b-a22b:free" },
        { name: "WizardLM-2 8x22B (OpenRouter)", api: "openrouter", model: "microsoft/wizardlm-2-8x22b" },
        { name: "Gemma 3 27B (Free / OpenRouter)", api: "openrouter", model: "google/gemma-3-27b-it:free" },
        { name: "DeepSeek R1 (Free / OpenRouter)", api: "openrouter", model: "deepseek/deepseek-r1-0528:free" },
        { name: "DeepSeek R1T Chimera (Free / OpenRouter)", api: "openrouter", model: "tngtech/deepseek-r1t-chimera:free" },
        { name: "QwQ 32B RPR (Free / OpenRouter)", api: "openrouter", model: "arliai/qwq-32b-arliai-rpr-v1:free" },
        { name: "Mistral Nemo (Free / OpenRouter)", api: "openrouter", model: "mistralai/mistral-nemo:free" },
    ],
    auditor: [
        { name: "Claude 4.0 Opus (Anthropic API)", api: "claude", model: "claude-4.0-opus-20240627" },
        { name: "Gemini 2.5 Pro (Google API)", api: "google", model: "gemini-2.5-pro" },
        { name: "GPT-4o (OpenAI API)", api: "openai", model: "gpt-4o" },
    ],
};

const defaultSettings = {
    isStaticEnabled: true,
    isDynamicEnabled: false,
    dynamicTriggerCount: 30,
    dynamicRules: [],
    whitelist: ["the", "and", "is", "a", "it", "in", "of", "to", "was", "for", "on", "with"],
    blacklist: [],
    projectGremlinEnabled: false,
    gremlinPapaEnabled: true,
    gremlinTwinsEnabled: true,
    gremlinMamaEnabled: true,
    gremlinAuditorEnabled: false,
    gremlinPapaPreset: 'Default',
    gremlinPapaApi: 'claude',
    gremlinPapaModel: 'claude-4.0-opus-20240627',
    gremlinPapaSource: '',
    gremlinTwinsPreset: 'Default',
    gremlinTwinsApi: 'google',
    gremlinTwinsModel: 'gemini-2.5-flash-lite-preview-06-17',
    gremlinTwinsSource: '',
    gremlinMamaPreset: 'Default',
    gremlinMamaApi: 'claude',
    gremlinMamaModel: 'claude-3.7-sonnet',
    gremlinMamaSource: '',
    gremlinWriterPreset: 'Default',
    gremlinWriterApi: 'openrouter',
    gremlinWriterModel: 'nousresearch/hermes-3-llama-3.1-405b',
    gremlinWriterSource: '',
    gremlinAuditorPreset: 'Default',
    gremlinAuditorApi: 'openai',
    gremlinAuditorModel: 'gpt-4o',
    gremlinAuditorSource: '',
};

// 2. HELPER FUNCTIONS (Prose Polisher)
// -----------------------------------------------------------------------------
function generateNgrams(text, n) {
    const words = text.replace(/[.,!?]/g, '').toLowerCase().split(/\s+/).filter(w => w);
    const ngrams = [];
    for (let i = 0; i <= words.length - n; i++) {
        ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
}

function stripMarkup(text) {
    if (!text) return '';
    let cleanText = text.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    return cleanText;
}

function getActiveRules() {
    const settings = extension_settings[EXTENSION_NAME];
    const rules = [];
    if (settings.isStaticEnabled) {
        rules.push(...staticRules.filter(r => !r.disabled));
    }
    if (settings.isDynamicEnabled) {
        rules.push(...dynamicRules.filter(r => !r.disabled));
    }
    return rules;
}

function isPhraseHandledByRegex(phrase) {
    const activeRules = getActiveRules();
    for (const rule of activeRules) {
        try {
            if (new RegExp(rule.findRegex, 'i').test(phrase)) {
                return true;
            }
        } catch (e) { /* Ignore invalid regex during this check */ }
    }
    return false;
}

function isPhraseWhitelisted(phrase) {
    const whitelist = extension_settings[EXTENSION_NAME]?.whitelist || [];
    if (whitelist.length === 0) return false;
    const lowerCasePhrase = phrase.toLowerCase();
    const whitelistRegex = new RegExp(`\\b(${whitelist.join('|')})\\b`, 'i');
    return whitelistRegex.test(lowerCasePhrase);
}

function isPhraseBlacklisted(phrase) {
    const blacklist = extension_settings[EXTENSION_NAME]?.blacklist || [];
    if (blacklist.length === 0) return false;
    const lowerCasePhrase = phrase.toLowerCase();
    const blacklistRegex = new RegExp(`\\b(${blacklist.join('|')})\\b`, 'i');
    return blacklistRegex.test(lowerCasePhrase);
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


// 3. CORE LOGIC & PATTERN FINDING (Prose Polisher)
// -----------------------------------------------------------------------------
function findAndMergePatterns(frequencies) {
    const culledFrequencies = cullSubstrings(frequencies);
    const candidates = Object.entries(culledFrequencies).sort((a, b) => a[0].localeCompare(b[0]));
    const mergedPatterns = {};
    const consumedIndices = new Set();

    for (let i = 0; i < candidates.length; i++) {
        if (consumedIndices.has(i)) continue;

        const [phraseA, countA] = candidates[i];
        const wordsA = phraseA.split(' ');
        let currentGroup = [{ index: i, phrase: phraseA, count: countA }];

        for (let j = i + 1; j < candidates.length; j++) {
            const [phraseB] = candidates[j];
            const wordsB = phraseB.split(' ');
            let commonPrefix = [];
            for (let k = 0; k < Math.min(wordsA.length, wordsB.length); k++) {
                if (wordsA[k] === wordsB[k]) commonPrefix.push(wordsA[k]);
                else break;
            }
            if (commonPrefix.length >= PATTERN_MIN_COMMON_WORDS) {
                 if (!consumedIndices.has(j)) {
                    currentGroup.push({ index: j, phrase: phraseB, count: candidates[j][1] });
                 }
            } else {
                break;
            }
        }

        if (currentGroup.length > 1) {
            let totalCount = 0;
            const variations = new Set();
            let commonPrefixString = '';
            const firstWords = currentGroup[0].phrase.split(' ');

            currentGroup.forEach(item => {
                totalCount += item.count;
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
            if (variations.size > 0) {
                const pattern = `${commonPrefixString} ${Array.from(variations).join('/')}`;
                mergedPatterns[pattern] = totalCount;
            } else {
                 consumedIndices.add(currentGroup[0].index);
            }
        }
    }

    const remaining = {};
    for (let i = 0; i < candidates.length; i++) {
        if (!consumedIndices.has(i)) {
            const [phrase, count] = candidates[i];
            remaining[phrase] = count;
        }
    }
    return { merged: mergedPatterns, remaining: remaining };
}

function performIntermediateAnalysis() {
    const allCandidates = [];
    for (const [phrase, data] of ngramFrequencies.entries()) {
        if (data.count > 1) {
            allCandidates.push([phrase, data.count]);
        }
    }
    allCandidates.sort((a, b) => b[1] - a[1]);
    const limitedCandidates = allCandidates.slice(0, CANDIDATE_LIMIT_FOR_ANALYSIS);

    if (allCandidates.length > CANDIDATE_LIMIT_FOR_ANALYSIS) {
        console.log(`${LOG_PREFIX} [Perf] Limited candidates from ${allCandidates.length} to ${CANDIDATE_LIMIT_FOR_ANALYSIS} BEFORE heavy processing.`);
    }
    const { merged, remaining } = findAndMergePatterns(Object.fromEntries(limitedCandidates));
    const mergedEntries = Object.entries(merged);
    mergedEntries.sort((a, b) => b[1] - a[1]);
    const allRemainingEntries = Object.entries(remaining);
    allRemainingEntries.sort((a, b) => b[1] - a[1]);
    analyzedLeaderboardData = {
        merged: mergedEntries,
        remaining: allRemainingEntries,
    };
}

function applyReplacements(text) {
    if (!text) return text;
    let replacedText = text;
    const rulesToApply = getActiveRules();

    rulesToApply.forEach(rule => {
        try {
            const regex = new RegExp(rule.findRegex, 'gi');
            if (rule.replaceString.includes('{{random:')) {
                const optionsMatch = rule.replaceString.match(/\{\{random:([\s\S]+?)\}\}/);
                if (optionsMatch && optionsMatch[1]) {
                    const options = optionsMatch[1].split(',');
                    replacedText = replacedText.replace(regex, (match, ...args) => {
                        const chosenOption = options[Math.floor(Math.random() * options.length)].trim();
                        return chosenOption.replace(/\$(\d)/g, (_, index) => args[parseInt(index) - 1] || '');
                    });
                }
            } else {
                replacedText = replacedText.replace(regex, rule.replaceString);
            }
        } catch (e) {
            console.warn(`${LOG_PREFIX} Invalid regex in rule '${rule.scriptName}', skipping:`, e);
        }
    });
    return replacedText;
}

function processNewSlopCandidate(newPhrase) {
    let isSubstring = false;
    const phrasesToRemove = [];
    for (const existingPhrase of slopCandidates) {
        if (existingPhrase.includes(newPhrase)) { isSubstring = true; break; }
        if (newPhrase.includes(existingPhrase)) { phrasesToRemove.push(existingPhrase); }
    }
    if (!isSubstring) {
        phrasesToRemove.forEach(phrase => slopCandidates.delete(phrase));
        slopCandidates.add(newPhrase);
    }
}

function analyzeAndTrackFrequency(text) {
    const cleanText = stripMarkup(text);
    if (!cleanText.trim()) return;

    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    for (const sentence of sentences) {
        for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
            const ngrams = generateNgrams(sentence, n);
            for (const ngram of ngrams) {
                if (ngram.length < 12 || isPhraseHandledByRegex(ngram) || isPhraseWhitelisted(ngram)) continue;

                const currentData = ngramFrequencies.get(ngram) || { count: 0 };
                let newCount = currentData.count + 1;

                if (isPhraseBlacklisted(ngram)) {
                    console.log(`${LOG_PREFIX} Applying blacklist boost to phrase: "${ngram}"`);
                    newCount += SLOP_THRESHOLD;
                }

                ngramFrequencies.set(ngram, { count: newCount, lastSeenMessageIndex: totalAiMessagesProcessed });

                if (newCount >= SLOP_THRESHOLD && currentData.count < SLOP_THRESHOLD) {
                    processNewSlopCandidate(ngram);
                }
            }
        }
    }
}

async function generateAndSaveDynamicRules(candidates) {
    if (candidates.length === 0) return 0;
    isProcessingAiRules = true;
    let addedCount = 0;
    console.log(`${LOG_PREFIX} Sending ${candidates.length} candidates for dynamic rule generation...`);
    const exampleOutputStructure = { scriptName: "Slopfix - A slow smile", findRegex: "\\b[Aa]\\s+(slow|small)\\s+smile\\s+(spreads?|creeps?)\\s+([Hh]is|[Hh]er)\\s+face\\b", replaceString: "{{random:A $1 smile touched $3 face,The corners of $3 mouth turned up in a $1 smile,A faint $1 smile played on $3 lips,$3 features softened with a $1 smile,Warmth infused $3 expression as a $1 smile appeared}}" };
    const systemPrompt = `You are a regex generation expert for a writing assistance tool. Your goal is to help users eliminate repetitive or clichéd phrasing ("slop") from their writing by providing creative, contextually appropriate alternatives.

INSTRUCTIONS:
1.  Analyze the following list of potentially repetitive phrases detected in a chat.
2.  For EACH phrase that is genuinely repetitive, clichéd, or stylistically weak:
    a.  Attempt to create a corresponding JSON object to correct it, containing 'scriptName', 'findRegex', and 'replaceString'.
    b.  **CRUCIAL:** If a phrase is too basic, common conversational text (e.g., "he said", "what do you mean", "I don't know", "thank you so much"), or if you cannot generate high-quality alternatives as described below, **DO NOT create a rule for it.** Simply omit its corresponding object from your JSON output. Prioritize quality and utility over quantity.
3.  The 'findRegex' must be a valid JavaScript regex string. Use capture groups \`()\` for variable parts and word boundaries \`\\b\`. Consider case-insensitivity where appropriate (e.g., \`[Hh]is\`).
4.  The 'replaceString' is critical. It must contain **at least five (5)** distinct, creative alternatives, formatted using \`{{random:alternative one,alternative two,...}}\`.
    a.  Use \`$1\`, \`$2\`, etc., to refer to capture groups from your \`findRegex\`.
    b.  **Style & Quality of Alternatives:** Write in the style of a professional author. Each alternative must fit **seamlessly** into the original sentence's grammatical structure. Avoid overly simplistic rephrasing. **Crucially, avoid "purple prose"** – overly ornate or flowery language.
    c.  If you cannot generate at least five high-quality, seamless, and stylistically appropriate alternatives for a given phrase, **do not include a rule for that phrase.**
5.  Your entire output MUST be a single, valid JSON array containing ONLY the rule objects you successfully created. If no phrases meet the criteria, output an empty array \`[]\`.

EXAMPLE OF THE STRUCTURE FOR A SINGLE RULE OBJECT:
${JSON.stringify(exampleOutputStructure, null, 2)}
`;
    const userPrompt = `Detected repetitive phrases that might be "slop":\n- ${candidates.join('\n- ')}\n\nGenerate the JSON array of regex rules for these phrases, following all instructions carefully:`;

    try {
        const response = await fetch('https://text.pollinations.ai/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-reasoning', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const responseText = await response.text();
        const jsonMatch = responseText.match(/\[\s*(\{[\s\S]*?\})*\s*\]/s);
        if (!jsonMatch) throw new Error("LLM did not return a valid JSON array. Response: " + responseText.substring(0, 1000));
        const newRules = JSON.parse(jsonMatch[0]);
        for (const rule of newRules) {
            if (rule && rule.scriptName && rule.findRegex && rule.replaceString) {
                try { new RegExp(rule.findRegex); } catch (e) { console.warn(`${LOG_PREFIX} AI generated an invalid regex for rule '${rule.scriptName}', skipping: ${e.message}`); continue; }
                rule.id = `DYN_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                rule.disabled = rule.disabled ?? false;
                rule.isStatic = false;
                rule.isNew = true;
                dynamicRules.push(rule);
                addedCount++;
            }
        }
        if (addedCount > 0) {
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            window.saveSettingsDebounced();
        }
    } catch (error) {
        console.error(`${LOG_PREFIX} Error during dynamic rule generation:`, error);
        window.toastr.error("Prose Polisher: AI rule generation failed or returned invalid data. See console.");
    } finally {
        isProcessingAiRules = false;
        console.log(`${LOG_PREFIX} Dynamic rule generation finished. Added ${addedCount} rules.`);
        return addedCount;
    }
}

async function checkForSlopAndGenerateRulesController() {
    if (isProcessingAiRules || slopCandidates.size === 0) return 0;
    const candidatesToProcess = Array.from(slopCandidates).slice(0, BATCH_SIZE);
    candidatesToProcess.forEach(candidate => slopCandidates.delete(candidate));
    if (candidatesToProcess.length > 0) {
        window.toastr.info(`Prose Polisher: AI is generating rules for ${candidatesToProcess.length} slop phrases...`);
        return await generateAndSaveDynamicRules(candidatesToProcess);
    }
    return 0;
}

async function manualAnalyzeChatHistory() {
    if (isAnalyzingHistory) { window.toastr.warning("Prose Polisher: Chat history analysis is already in progress."); return; }
    isAnalyzingHistory = true;
    let messagesSinceLastHeavyAnalysis = 0;
    const toastrId = window.toastr.info(
        'Prose Polisher: Starting analysis...<br><button id="pp-cancel-analysis" class="menu_button is_dangerous" style="margin-top: 10px;">Cancel Analysis</button>',
        "Analysis in Progress",
        { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, preventDuplicates: true }
    );
    function cancelAnalysis() {
        if (!isAnalyzingHistory) return;
        isAnalyzingHistory = false;
        window.toastr.clear(toastrId);
        window.toastr.warning("Prose Polisher: Analysis cancelled by user.");
    }
    if (toastrId) toastrId.find('#pp-cancel-analysis').on('click', cancelAnalysis);

    ngramFrequencies.clear();
    slopCandidates.clear();
    analyzedLeaderboardData = { merged: [], remaining: [] };
    totalAiMessagesProcessed = 0;

    const context = window.getContext();
    const aiMessages = context?.chat?.filter(message => !message.is_user && message.mes) || [];
    if (aiMessages.length === 0) {
        isAnalyzingHistory = false;
        if (toastrId) window.toastr.clear(toastrId);
        window.toastr.info("Prose Polisher: No AI messages found in chat history to analyze.");
        return;
    }
    let currentIndex = 0;

    function processNextChunk() {
        if (!isAnalyzingHistory) return;
        const chunkEnd = Math.min(currentIndex + MANUAL_ANALYSIS_CHUNK_SIZE, aiMessages.length);
        const chunk = aiMessages.slice(currentIndex, chunkEnd);
        for (const message of chunk) {
            totalAiMessagesProcessed++;
            analyzeAndTrackFrequency(message.mes);
        }
        pruneDuringManualAnalysis();
        messagesSinceLastHeavyAnalysis += chunk.length;
        currentIndex = chunkEnd;
        let progressMessage = `Prose Polisher: Scanned ${currentIndex} / ${aiMessages.length} messages...`;
        if (messagesSinceLastHeavyAnalysis >= HEAVY_ANALYSIS_INTERVAL || currentIndex >= aiMessages.length) {
            progressMessage += `<br><i>(Analyzing patterns...)</i>`;
        }
        progressMessage += `<br><button id="pp-cancel-analysis" class="menu_button is_dangerous" style="margin-top: 10px;">Cancel Analysis</button>`;
        toastrId.find('.toast-message').html(progressMessage);
        toastrId.find('#pp-cancel-analysis').on('click', cancelAnalysis);

        if (messagesSinceLastHeavyAnalysis >= HEAVY_ANALYSIS_INTERVAL || currentIndex >= aiMessages.length) {
            messagesSinceLastHeavyAnalysis = 0;
            setTimeout(() => {
                if (!isAnalyzingHistory) return;
                console.log(`${LOG_PREFIX} Performing periodic heavy analysis at message ${currentIndex}.`);
                performIntermediateAnalysis();
                if (currentIndex >= aiMessages.length) completeAnalysis();
                else setTimeout(processNextChunk, 0);
            }, 50);
        } else {
            setTimeout(processNextChunk, 0);
        }
    }
    function completeAnalysis() {
        isAnalyzingHistory = false;
        window.toastr.clear(toastrId);
        if (slopCandidates.size > 0) window.toastr.success(`Prose Polisher: Analysis complete. ${slopCandidates.size} potential slop phrases identified.`);
        else window.toastr.info("Prose Polisher: Analysis complete. No new slop candidates found meeting the threshold.");
        showFrequencyLeaderboard();
    }
    processNextChunk();
}

async function handleGenerateRulesFromAnalysisClick() {
    if (isProcessingAiRules) { window.toastr.warning("Prose Polisher: AI rule generation is already in progress."); return; }
    if (slopCandidates.size === 0) { window.toastr.info("Prose Polisher: No slop candidates identified. Run analysis or wait for more messages."); return; }
    window.toastr.info(`Prose Polisher: Starting AI rule generation for ${slopCandidates.size} candidate(s)...`);
    let totalGeneratedThisRun = 0;
    const initialCandidateCount = slopCandidates.size;
    while (slopCandidates.size > 0) {
        const newRulesCount = await checkForSlopAndGenerateRulesController();
        totalGeneratedThisRun += newRulesCount;
        if (newRulesCount > 0 && regexNavigator) {
            regexNavigator.renderRuleList();
        }
    }
    if (totalGeneratedThisRun > 0) {
        window.toastr.success(`Prose Polisher: AI generated and saved ${totalGeneratedThisRun} new rule(s) from ${initialCandidateCount} candidates!`);
        if (regexNavigator) regexNavigator.open();
    } else if (initialCandidateCount > 0) {
        window.toastr.info("Prose Polisher: AI rule generation complete. No new rules were created (possibly AI filtered all candidates).");
    }
}

function pruneOldNgrams() {
    let prunedCount = 0;
    for (const [ngram, data] of ngramFrequencies.entries()) {
        if ((totalAiMessagesProcessed - data.lastSeenMessageIndex > PRUNE_AFTER_MESSAGES) && data.count < SLOP_THRESHOLD) {
            ngramFrequencies.delete(ngram);
            slopCandidates.delete(ngram);
            prunedCount++;
        }
    }
    if (prunedCount > 0) console.log(`${LOG_PREFIX} Pruned ${prunedCount} old/infrequent n-grams.`);
}

function pruneDuringManualAnalysis() {
    let prunedCount = 0;
    for (const [ngram, data] of ngramFrequencies.entries()) {
        if (data.count < 2) {
            ngramFrequencies.delete(ngram);
            slopCandidates.delete(ngram);
            prunedCount++;
        }
    }
    if (prunedCount > 0) {
        console.log(`${LOG_PREFIX} [Manual Analysis] Pruned ${prunedCount} low-frequency n-grams from chunk.`);
    }
}

function showFrequencyLeaderboard() {
    if (!isAnalyzingHistory) {
        performIntermediateAnalysis();
    }
    const { merged: mergedEntries, remaining: remainingEntries } = analyzedLeaderboardData;
    let contentHtml;
    if (mergedEntries.length === 0 && remainingEntries.length === 0) {
        contentHtml = '<p>No repetitive phrases have been detected that meet display criteria.</p>';
    } else {
        const mergedRows = mergedEntries.map(([phrase, count]) => `<tr class="is-pattern"><td>${phrase}</td><td>${count}</td></tr>`).join('');
        const remainingRows = remainingEntries.map(([phrase, count]) => `<tr><td>${phrase}</td><td>${count}</td></tr>`).join('');
        contentHtml = `<p>The following have been detected as repetitive. Phrases in <strong>bold orange</strong> are detected patterns where similar phrases have been grouped.</p>
                       <table class="prose-polisher-frequency-table">
                           <thead><tr><th>Repetitive Phrase or Pattern</th><th>Total Count</th></tr></thead>
                           <tbody>${mergedRows}${remainingRows}</tbody>
                       </table>`;
    }
    callGenericPopup(contentHtml, POPUP_TYPE.TEXT, "Live Frequency Data (with Pattern Analysis)", { wide: true, large: true });
}

function showWhitelistManager() {
    const settings = extension_settings[EXTENSION_NAME];
    const container = document.createElement('div');
    container.className = 'prose-polisher-whitelist-manager';
    container.innerHTML = `
        <h4>Whitelist Manager</h4>
        <p>Add approved words to this list. Any phrase containing these words will be <strong>ignored</strong> by the frequency analyzer. Good for common words or character names.</p>
        <div class="list-container">
            <ul id="pp-whitelist-list"></ul>
        </div>
        <div class="add-controls">
            <input type="text" id="pp-whitelist-input" class="text_pole" placeholder="Add a word to ignore...">
            <button id="pp-whitelist-add-btn" class="menu_button">Add</button>
        </div>
    `;
    const listElement = container.querySelector('#pp-whitelist-list');
    const inputElement = container.querySelector('#pp-whitelist-input');
    const addButton = container.querySelector('#pp-whitelist-add-btn');

    const renderWhitelist = () => {
        listElement.innerHTML = '';
        settings.whitelist.sort().forEach(word => {
            const item = document.createElement('li');
            item.className = 'list-item';
            item.innerHTML = `<span>${word}</span><i class="fa-solid fa-trash-can delete-btn" data-word="${word}"></i>`;
            item.querySelector('.delete-btn').addEventListener('click', () => {
                settings.whitelist = settings.whitelist.filter(w => w !== word);
                window.saveSettingsDebounced();
                renderWhitelist();
            });
            listElement.appendChild(item);
        });
    };

    const addWord = () => {
        const newWord = inputElement.value.trim().toLowerCase();
        if (newWord && !settings.whitelist.includes(newWord)) {
            settings.whitelist.push(newWord);
            window.saveSettingsDebounced();
            renderWhitelist();
            inputElement.value = '';
        }
        inputElement.focus();
    };

    addButton.addEventListener('click', addWord);
    inputElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });

    renderWhitelist();
    callGenericPopup(container, POPUP_TYPE.DISPLAY, "Whitelist Manager", { wide: false, large: false });
}

function showBlacklistManager() {
    const settings = extension_settings[EXTENSION_NAME];
    const container = document.createElement('div');
    container.className = 'prose-polisher-blacklist-manager';
    container.innerHTML = `
        <h4>Blacklist Manager</h4>
        <p>Add banned words to this list. Any phrase containing these words will be <strong>prioritized</strong> for slop analysis, making them much more likely to have rules generated.</p>
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
        settings.blacklist.sort().forEach(word => {
            const item = document.createElement('li');
            item.className = 'list-item';
            item.innerHTML = `<span>${word}</span><i class="fa-solid fa-trash-can delete-btn" data-word="${word}"></i>`;
            item.querySelector('.delete-btn').addEventListener('click', () => {
                settings.blacklist = settings.blacklist.filter(w => w !== word);
                window.saveSettingsDebounced();
                renderBlacklist();
            });
            listElement.appendChild(item);
        });
    };

    const addWord = () => {
        const newWord = inputElement.value.trim().toLowerCase();
        if (newWord && !settings.blacklist.includes(newWord)) {
            settings.blacklist.push(newWord);
            window.saveSettingsDebounced();
            renderBlacklist();
            inputElement.value = '';
        }
        inputElement.focus();
    };

    addButton.addEventListener('click', addWord);
    inputElement.addEventListener('keydown', (event) => { if (event.key === 'Enter') addWord(); });

    renderBlacklist();
    callGenericPopup(container, POPUP_TYPE.DISPLAY, "Blacklist Manager", { wide: false, large: false });
}


// 4. EVENT HANDLING & UI CLASSES
// -----------------------------------------------------------------------------
async function showApiEditorPopup(gremlinRole) {
    const settings = extension_settings[EXTENSION_NAME];
    const roleUpper = gremlinRole.charAt(0).toUpperCase() + gremlinRole.slice(1);
    const suggestions = SUGGESTED_MODELS[gremlinRole] || [];

    const currentApi = settings[`gremlin${roleUpper}Api`] || '';
    const currentModel = settings[`gremlin${roleUpper}Model`] || '';
    const currentSource = settings[`gremlin${roleUpper}Source`] || '';

    let suggestionsHtml = suggestions.length > 0 ? `<h4>Suggestions for ${roleUpper}</h4><ul class="pp-suggestion-list">${suggestions.map(s => `<li class="pp-suggestion-item" data-api="${s.api}" data-model="${s.model}" data-source="${s.source || ''}">${s.name}</li>`).join('')}</ul><hr>` : '';
    const popupContent = document.createElement('div');
    popupContent.innerHTML = `${suggestionsHtml}<h4>Custom API/Model</h4><div class="pp-custom-binding-inputs"><input type="text" id="pp_custom_api" class="text_pole" placeholder="API Name (e.g., openai, claude, google, openrouter)" value="${currentApi}"><input type="text" id="pp_custom_model" class="text_pole" placeholder="Exact Model Name (e.g., gpt-4o, claude-4.0-opus...)" value="${currentModel}"><input type="text" id="pp_custom_source" class="text_pole" placeholder="Source (for some OpenAI-compatibles, e.g. DeepSeek)" value="${currentSource}"></div><br><button id="pp-unbind-btn" class="menu_button is_dangerous">Clear All</button>`;

    popupContent.querySelectorAll('.pp-suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            popupContent.querySelector('#pp_custom_api').value = item.dataset.api;
            popupContent.querySelector('#pp_custom_model').value = item.dataset.model;
            popupContent.querySelector('#pp_custom_source').value = item.dataset.source || '';
            popupContent.querySelectorAll('.pp-suggestion-item').forEach(i => i.style.fontWeight = 'normal');
            item.style.fontWeight = 'bold';
        });
    });

    popupContent.querySelector('#pp-unbind-btn').addEventListener('click', () => {
         popupContent.querySelector('#pp_custom_api').value = '';
         popupContent.querySelector('#pp_custom_model').value = '';
         popupContent.querySelector('#pp_custom_source').value = '';
         window.toastr.info('Cleared inputs. Click "Save" to apply.');
    });

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, `Set API/Model for ${roleUpper}`)) {
        settings[`gremlin${roleUpper}Api`] = popupContent.querySelector('#pp_custom_api').value.trim();
        settings[`gremlin${roleUpper}Model`] = popupContent.querySelector('#pp_custom_model').value.trim();
        settings[`gremlin${roleUpper}Source`] = popupContent.querySelector('#pp_custom_source').value.trim();

        window.saveSettingsDebounced();
        updateGremlinApiDisplay(gremlinRole);
        window.toastr.info(`API/Model settings saved for ${roleUpper}.`);
    }
}

function updateGremlinApiDisplay(role) {
    const settings = extension_settings[EXTENSION_NAME];
    const roleUpper = role.charAt(0).toUpperCase() + role.slice(1);
    const displayElement = document.getElementById(`pp_gremlin${roleUpper}Display`);
    if (displayElement) {
        const api = settings[`gremlin${roleUpper}Api`] || 'None';
        const model = settings[`gremlin${roleUpper}Model`] || 'Not Set';
        displayElement.textContent = `${api} / ${model}`;
    }
}

function handleSentenceCapitalization(messageId) {
    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) return;

    const messageTextElement = messageElement.querySelector('.mes_text');
    if (!messageTextElement) return;

    let textContent = messageTextElement.innerHTML;
    const originalHTML = textContent;

    textContent = textContent.replace(/^(\s*<[^>]*>)*([a-z])/, (match, tags, letter) => `${tags || ''}${letter.toUpperCase()}`);
    textContent = textContent.replace(/([.!?])(\s*<[^>]*>)*\s+([a-z])/g, (match, punc, tags, letter) => `${punc}${tags || ''} ${letter.toUpperCase()}`);

    if (textContent !== originalHTML) {
        console.log(`${LOG_PREFIX} Applying enhanced auto-capitalization to a rendered message.`);
        messageTextElement.innerHTML = textContent;
    }
}

/**
 * This handler prevents the original generation if the pipeline is starting,
 * and allows internal pipeline /gen calls to proceed.
 */
async function onBeforeGeneration(type, generateArgsObject, dryRun) {
    // If the pipeline is currently running (triggered by onUserMessageRendered),
    // this check prevents the main generation process from starting immediately.
    // Instead, it returns undefined to allow the internal /gen call to proceed.
    if (isPipelineRunning) {
         console.log('[ProjectGremlin] Pipeline running, allowing internal /gen call.');
         // Return undefined to allow the internal /gen call to proceed.
         return;
    }

    // For all other cases (Gremlin disabled, dry run, non-standard type),
    // let SillyTavern handle them normally. Explicitly return undefined.
    // This includes the final generation triggered by our pipeline.
    return;
}


/**
 * This is the main entry point for the Project Gremlin pipeline.
 * It triggers *after* the user's message has been added to chat and rendered.
 */
async function onUserMessageRendered(messageId) {
    const settings = extension_settings[EXTENSION_NAME];
    const context = getContext();

    // Log details for debugging every time the event fires
    console.log(`[ProjectGremlin] USER_MESSAGE_RENDERED triggered for message ID ${messageId}`);
    console.log(`[ProjectGremlin] Current chat length: ${context.chat.length}`);
    console.log(`[ProjectGremlin] Project Gremlin Enabled: ${settings.projectGremlinEnabled}`);
    console.log(`[ProjectGremlin] isPipelineRunning flag: ${isPipelineRunning}`);


    // Simplified check: Ensure Gremlin is enabled and pipeline is not already running.
    // We trust the event itself indicates it's the relevant user message and is in context.
    if (!settings.projectGremlinEnabled || isPipelineRunning) {
        console.log(`[ProjectGremlin] USER_MESSAGE_RENDERED condition failed for message ID ${messageId}. Details:`);
        if (!settings.projectGremlinEnabled) console.log('[ProjectGremlin] - Reason: Project Gremlin is not enabled in settings.');
        else if (isPipelineRunning) console.log('[ProjectGremlin] - Reason: Pipeline is already running.');
        // Optional: log message details for info, but don't block on them
        const message = context.chat.find(msg => msg.id === messageId);
        console.log(`[ProjectGremlin] Message object found:`, message);
        if (message && message.is_user !== true) console.log(`[ProjectGremlin] - Info: message.is_user is ${message.is_user}. (Not blocking)`);
        if (message && message.id !== context.chat.length - 1) console.log(`[ProjectGremlin] - Info: Message ID (${messageId}) is not the latest chat message ID (${context.chat.length - 1}). (Not blocking)`);

        return;
    }

    // If we pass the checks, the pipeline should start
    console.log('[ProjectGremlin] User message rendered successfully. Starting pipeline...');

    // Set the flag to indicate the pipeline is running.
    isPipelineRunning = true;


    try {
        // Run the planning stages (Papa, Twins, Mama). They will see the user message in chat via /gen.
        const finalBlueprint = await runGremlinPlanningPipeline();

        if (!finalBlueprint) {
            throw new Error('Project Gremlin planning failed.'); // Propagate error to trigger catch block
        }

        // --- Prepare Final Generation Environment and Prompt ---
        let finalPromptInstruction;
        if (settings.gremlinAuditorEnabled) {
            // AUDITOR ENABLED: Run Writer internally, then prepare for Auditor.
            console.log('[ProjectGremlin] Auditor enabled. Running Writer step internally...');
            toastr.info("Gremlin Pipeline: Step 4 - Writer is crafting...", "Project Gremlin", { timeOut: 7000 });

            // Set the environment for the internal Writer step.
            await applyGremlinEnvironment('writer');
            // The Writer's prompt includes the blueprint and sees the user message in chat via /gen
            const writerInstruction = `[OOC: You are a master writer. Follow these instructions from your project lead precisely for your next response. Do not mention the blueprint or instructions in your reply. Your writing should be creative and engaging, bringing this plan to life. Do not write from the user's perspective. Write only the character's response.\n\n# INSTRUCTIONS\n${finalBlueprint}]`;
            const writerProse = await executeGen(writerInstruction); // Execute Writer's generation

            if (!writerProse.trim()) {
                throw new Error("Internal Writer Gremlin step failed to produce a response.");
            }
            console.log('[ProjectGremlin] Writer Gremlin\'s Prose (for Auditor):', writerProse);

            console.log('[ProjectGremlin] Preparing final injection for Auditor.');
            toastr.info("Gremlin Pipeline: Handing off to Auditor...", "Project Gremlin", { timeOut: 4000 });

            // Now, set the environment for the final Auditor step, which the main generation will use.
            // This sets the API/Model/Preset for SillyTavern's core generation.
            await applyGremlinEnvironment('auditor');

            // Construct the final prompt *instruction* for the Auditor.
             finalPromptInstruction = `[OOC: You are a master line editor. Your task is to revise and polish the following text.
            - Correct any grammatical errors, awkward phrasing, or typos.
            - Eliminate repetitive words and sentence structures.
            - Enhance the prose to be more evocative and impactful, while respecting the established character voice and tone.
            - If the text is fundamentally flawed or completely fails to follow the narrative, rewrite it from scratch to be high quality.
            - **CRUCIAL:** Your output must ONLY be the final, edited text. Do NOT include any commentary, explanations, or introductory phrases like "Here is the revised version:".

            # TEXT TO EDIT
            ${writerProse}]`;

        }
        else {
            // AUDITOR DISABLED: Writer is the final step. Prepare environment and construct prompt instruction for Writer.
            console.log('[ProjectGremlin] Auditor disabled. Preparing final instruction for Writer.');
            toastr.info("Gremlin Pipeline: Handing off to Writer...", "Project Gremlin", { timeOut: 4000 });

            // Set the API/Preset environment for the Writer.
            // This sets the API/Model/Preset for SillyTavern's core generation.
            await applyGremlinEnvironment('writer');

            // Construct the final prompt *instruction* for the Writer.
             finalPromptInstruction = `[OOC: You are a master writer. Follow these instructions from your project lead precisely for your next response. Do not mention the blueprint or instructions in your reply. Your writing should be creative and engaging, bringing this plan to life. Do not write from the user's perspective. Write only the character's response.\n\n# INSTRUCTIONS\n${finalBlueprint}]`;
        }

        toastr.success("Gremlin Pipeline: Blueprint complete! Prompt modified for generation.", "Project Gremlin");

        // Sanitize and inject the final instruction into the context for the upcoming generation.
        // SillyTavern's core will build the final prompt using this injected text + chat history.
        const sanitizedInstruction = finalPromptInstruction.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await context.executeSlashCommands(`/inject id=gremlin_final_plan position=chat depth=0 "${sanitizedInstruction}"`);

        // SillyTavern's core will automatically trigger the character generation now that
        // the USER_MESSAGE_RENDERED handler has finished and the prompt is ready.
        // We do NOT need to call Generate() here.

    } catch (error) {
        console.error('[ProjectGremlin] A critical error occurred during the pipeline execution:', error);
        toastr.error(`Project Gremlin pipeline failed: ${error.message}. Generation may proceed without blueprint.`, "Project Gremlin Error");
        // If the pipeline fails, SillyTavern's original generation might proceed without the injected prompt.
    } finally {
        // --- Cleanup ---
        isPipelineRunning = false; // Unlock the pipeline flag

        // Reload generation settings (API/Model/Preset) in case an intermediate step changed them
        // This ensures settings are correct for subsequent user messages.
        context.reloadGenerationSettings();
    }
}

// This function ONLY handles post-generation processing on the AI's message.
// This is still useful for regex replacements and frequency tracking.
function onAiMessageRendered(messageId) {
    const settings = extension_settings[EXTENSION_NAME];
    const context = getContext();
    const message = context.chat.find(msg => msg.id === messageId);

    if (!message || message.is_user) return;

    let processedMessage = message.mes;
    const originalMessage = processedMessage;

    processedMessage = applyReplacements(processedMessage);

    if (processedMessage !== originalMessage) {
        console.log(`${LOG_PREFIX} Applying regex replacements.`);
        message.mes = processedMessage;
        context.saveState();
        // Update the DOM element directly if it exists
        const messageTextElement = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
        if(messageTextElement) messageTextElement.innerHTML = processedMessage;
    }

    totalAiMessagesProcessed++;
    analyzeAndTrackFrequency(processedMessage);

    if (totalAiMessagesProcessed % PRUNE_CHECK_INTERVAL === 0) {
        pruneOldNgrams();
    }

    if (settings.isDynamicEnabled && slopCandidates.size > 0) {
        messageCounterForTrigger++;
        if (messageCounterForTrigger >= settings.dynamicTriggerCount) {
            messageCounterForTrigger = 0;
            checkForSlopAndGenerateRulesController();
        }
    } else {
        messageCounterForTrigger = 0;
    }

    handleSentenceCapitalization(messageId);
}


class RegexNavigator {
    constructor() {}
    async open() {
        dynamicRules.forEach(rule => delete rule.isNew);
        const container = document.createElement('div');
        container.className = 'prose-polisher-navigator-content';
        container.innerHTML = `
            <div class="modal-header"><h2>Regex Rule Navigator</h2></div>
            <div class="navigator-body"><div class="navigator-main-panel"><div id="regex-navigator-list-view"></div></div></div>
            <div class="modal-footer"><button id="prose-polisher-new-rule-btn" class="menu_button"><i class="fa-solid fa-plus"></i> New Dynamic Rule</button></div>`;
        this.renderRuleList(container);
        container.querySelector('#prose-polisher-new-rule-btn').addEventListener('pointerup', () => this.openRuleEditor(null));
        callGenericPopup(container, POPUP_TYPE.DISPLAY, 'Regex Rule Navigator', { wide: true, large: true, addCloseButton: true });
    }
    renderRuleList(container = null) {
        const modalContent = container || document.querySelector('.popup_content .prose-polisher-navigator-content');
        if (!modalContent) return;
        const listView = modalContent.querySelector('#regex-navigator-list-view');
        listView.innerHTML = '';
        const allRules = [...staticRules, ...dynamicRules.sort((a,b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || (a.scriptName.localeCompare(b.scriptName)))];
        if (allRules.length === 0) {
            listView.innerHTML = "<p style='text-align:center; padding:20px;'>No rules defined.</p>";
            return;
        }
        for (const rule of allRules) {
            const item = document.createElement('div');
            item.className = 'regex-navigator-item';
            item.classList.toggle('is-dynamic', !rule.isStatic);
            item.classList.toggle('is-disabled', rule.disabled);
            item.classList.toggle('is-newly-added', !!rule.isNew);
            item.dataset.id = rule.id;
            item.innerHTML = `<div class="item-icon"><i class="fa-solid ${rule.isStatic ? 'fa-database' : 'fa-wand-magic-sparkles'}"></i></div><div class="item-details"><div class="script-name">${rule.scriptName || '(No Name)'}</div><div class="find-regex">${rule.findRegex}</div></div><div class="item-status">${rule.isStatic ? '<span>Static</span>' : '<span>Dynamic</span>'}<i class="fa-solid ${rule.disabled ? 'fa-toggle-off' : 'fa-toggle-on'} status-toggle-icon" title="Toggle Enable/Disable"></i></div>`;
            item.addEventListener('pointerup', (e) => {
                if (e.target.closest('.status-toggle-icon')) { this.toggleRuleStatus(rule.id); }
                else { this.openRuleEditor(rule.id); }
            });
            listView.appendChild(item);
        }
    }
    async toggleRuleStatus(ruleId) {
        const rule = [...staticRules, ...dynamicRules].find(r => r.id === ruleId);
        if (rule) {
            rule.disabled = !rule.disabled;
            if (!rule.isStatic) {
                extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
                window.saveSettingsDebounced();
            }
            this.renderRuleList();
            window.toastr.success(`Rule "${rule.scriptName}" ${rule.disabled ? 'disabled' : 'enabled'}.`);
        }
    }
    async openRuleEditor(ruleId) {
        const isNew = ruleId === null;
        let rule;
        if (isNew) { rule = { id: `DYN_${Date.now()}`, scriptName: '', findRegex: '', replaceString: '', disabled: false, isStatic: false, isNew: true }; }
        else { rule = [...staticRules, ...dynamicRules].find(r => r.id === ruleId); }
        if (!rule) return;
        const editorContent = document.createElement('div');
        editorContent.className = 'prose-polisher-rule-editor-popup';
        editorContent.dataset.ruleId = rule.id;
        editorContent.innerHTML = `
            <label for="pp_editor_name">Rule Name</label>
            <input type="text" id="pp_editor_name" class="text_pole" value="${rule.scriptName?.replace(/"/g, '"') || ''}" ${rule.isStatic ? 'disabled' : ''}>
            <label for="pp_editor_find">Find Regex (JavaScript format)</label>
            <textarea id="pp_editor_find" class="text_pole" ${rule.isStatic ? 'disabled' : ''}>${rule.findRegex || ''}</textarea>
            <label for="pp_editor_replace">Replace String (use {{random:opt1,opt2}} for variants)</label>
            <textarea id="pp_editor_replace" class="text_pole" ${rule.isStatic ? 'disabled' : ''}>${rule.replaceString || ''}</textarea>
            <div class="editor-actions">
                <div class="actions-left"><label class="checkbox_label"><input type="checkbox" id="pp_editor_disabled" ${rule.disabled ? 'checked' : ''}><span>Disabled</span></label></div>
                ${!rule.isStatic ? '<button id="pp_editor_delete" class="menu_button is_dangerous">Delete Rule</button>' : ''}
            </div>`;
        const deleteBtn = editorContent.querySelector('#pp_editor_delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('pointerup', async (e) => {
                e.stopPropagation();
                const confirmed = await callGenericPopup('Are you sure you want to delete this rule?', POPUP_TYPE.CONFIRM);
                if (confirmed) {
                    await this.handleDelete(rule.id);
                    const popup = deleteBtn.closest('.popup_confirm');
                    if (popup) {
                        const closeButton = popup.querySelector('.popup-close') || popup.querySelector('.popup-button-cancel');
                        closeButton?.click();
                    }
                }
            });
        }
        const popupResult = await callGenericPopup(editorContent, POPUP_TYPE.CONFIRM, isNew ? 'Create New Rule' : 'Edit Rule', { wide: true, large: true });
        if (popupResult) {
            const nameInput = editorContent.querySelector('#pp_editor_name'), findInput = editorContent.querySelector('#pp_editor_find'), replaceInput = editorContent.querySelector('#pp_editor_replace'), disabledInput = editorContent.querySelector('#pp_editor_disabled');
            rule.disabled = disabledInput.checked;
            if (!rule.isStatic) {
                if (!nameInput.value.trim() || !findInput.value.trim()) { window.toastr.error("Rule Name and Find Regex cannot be empty."); this.openRuleEditor(ruleId); return; }
                try { new RegExp(findInput.value); } catch (e) { window.toastr.error(`Invalid Regex: ${e.message}`); this.openRuleEditor(ruleId); return; }
                rule.scriptName = nameInput.value; rule.findRegex = findInput.value; rule.replaceString = replaceInput.value;
            }
            if (isNew && !rule.isStatic) { dynamicRules.push(rule); }
            if (!rule.isStatic) {
                extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
                window.saveSettingsDebounced();
            }
            this.renderRuleList();
            window.toastr.success(isNew ? "New rule created." : "Rule updated.");
        }
    }
    async handleDelete(ruleId) {
        const index = dynamicRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            dynamicRules.splice(index, 1);
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            window.saveSettingsDebounced();
            this.renderRuleList();
            window.toastr.success("Dynamic rule deleted.");
        }
    }
}

// Function to execute tasks queued before APP_READY
async function runReadyQueue() {
    isAppReady = true;
    console.log(`${LOG_PREFIX} APP_READY event received. Running queued tasks (${readyQueue.length}).`);
    while (readyQueue.length > 0) {
        const task = readyQueue.shift();
        try {
            await task();
        } catch (error) {
            console.error(`${LOG_PREFIX} Error running queued task:`, error);
        }
    }
    console.log(`${LOG_PREFIX} Ready queue finished.`);
}

// Function to queue tasks that need APP_READY
function queueReadyTask(task) {
    if (isAppReady) {
        // If APP_READY has already fired, execute immediately
        task();
    } else {
        // Otherwise, add to the queue
        readyQueue.push(task);
    }
}


// 5. INITIALIZATION
// -----------------------------------------------------------------------------
async function initializeExtensionCore() {
    try {
        console.log(`${LOG_PREFIX} Initializing core components...`);
        extension_settings[EXTENSION_NAME] = { ...defaultSettings, ...extension_settings[EXTENSION_NAME] };
        const settings = extension_settings[EXTENSION_NAME];

        dynamicRules = settings.dynamicRules || [];
        const staticResponse = await fetch(`${EXTENSION_FOLDER_PATH}/regex_rules.json`);
        if (!staticResponse.ok) throw new Error("Failed to fetch regex_rules.json");
        staticRules = await staticResponse.json();

        const settingsHtml = await fetch(`${EXTENSION_FOLDER_PATH}/settings.html`).then(res => res.text());
        document.getElementById('extensions_settings').insertAdjacentHTML('beforeend', settingsHtml);

        // ---- PROSE POLISHER UI BINDING ----
        document.getElementById('prose_polisher_enable_static').checked = settings.isStaticEnabled;
        document.getElementById('prose_polisher_enable_dynamic').checked = settings.isDynamicEnabled;
        document.getElementById('prose_polisher_dynamic_trigger').value = settings.dynamicTriggerCount;

        document.getElementById('prose_polisher_enable_static').addEventListener('change', (e) => { settings.isStaticEnabled = e.target.checked; window.saveSettingsDebounced(); });
        document.getElementById('prose_polisher_enable_dynamic').addEventListener('change', (e) => { settings.isDynamicEnabled = e.target.checked; if(!e.target.checked) messageCounterForTrigger = 0; window.saveSettingsDebounced(); });
        document.getElementById('prose_polisher_dynamic_trigger').addEventListener('input', (e) => { const value = parseInt(e.target.value, 10); if (!isNaN(value) && value >= 1) { settings.dynamicTriggerCount = value; window.saveSettingsDebounced(); } });

        regexNavigator = new RegexNavigator();

        document.getElementById('prose_polisher_open_navigator_button').addEventListener('pointerup', () => regexNavigator.open());
        document.getElementById('prose_polisher_analyze_chat_button').addEventListener('pointerup', manualAnalyzeChatHistory);
        document.getElementById('prose_polisher_view_frequency_button').addEventListener('pointerup', showFrequencyLeaderboard);
        document.getElementById('prose_polisher_generate_rules_button').addEventListener('pointerup', handleGenerateRulesFromAnalysisClick);
        document.getElementById('prose_polisher_manage_whitelist_button').addEventListener('pointerup', showWhitelistManager);
        document.getElementById('prose_polisher_manage_blacklist_button').addEventListener('pointerup', showBlacklistManager);
        document.getElementById('prose_polisher_clear_frequency_button').addEventListener('pointerup', () => { ngramFrequencies.clear(); slopCandidates.clear(); messageCounterForTrigger = 0; totalAiMessagesProcessed = 0; analyzedLeaderboardData = { merged: [], remaining: [] }; window.toastr.success("Prose Polisher frequency data cleared!"); });

        // ---- PROJECT GREMLIN UI BINDING ----
        let buttonContainer = document.getElementById('pp-chat-buttons-container');
        if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.id = 'pp-chat-buttons-container';
            const sendButtonHolder = document.getElementById('send_but_holder');
            sendButtonHolder?.parentElement?.insertBefore(buttonContainer, sendButtonHolder.nextSibling);
        }

        buttonContainer.insertAdjacentHTML('beforeend', `<button id="pp_gremlin_toggle" class="fa-solid fa-hat-wizard" title="Toggle Project Gremlin Pipeline"></button>`);

        const gremlinToggle = document.getElementById('pp_gremlin_toggle');
        const gremlinEnableCheckbox = document.getElementById('pp_projectGremlinEnabled');

        const updateGremlinToggleState = () => {
            const enabled = settings.projectGremlinEnabled;
            gremlinToggle?.classList.toggle('active', enabled);
            if (gremlinEnableCheckbox) gremlinEnableCheckbox.checked = enabled;
        };

        const toggleGremlin = () => {
            settings.projectGremlinEnabled = !settings.projectGremlinEnabled;
            window.saveSettingsDebounced();
            updateGremlinToggleState();
            window.toastr.info(`Project Gremlin ${settings.projectGremlinEnabled ? 'enabled' : 'disabled'} for next message.`);
        };

        gremlinToggle?.addEventListener('click', toggleGremlin);
        gremlinEnableCheckbox?.addEventListener('change', (e) => {
            if (settings.projectGremlinEnabled !== e.target.checked) {
                 settings.projectGremlinEnabled = e.target.checked;
                 window.saveSettingsDebounced();
                 updateGremlinToggleState();
            }
        });

        document.getElementById('pp_gremlinPapaEnabled').checked = settings.gremlinPapaEnabled;
        document.getElementById('pp_gremlinTwinsEnabled').checked = settings.gremlinTwinsEnabled;
        document.getElementById('pp_gremlinMamaEnabled').checked = settings.gremlinMamaEnabled;
        document.getElementById('pp_gremlinAuditorEnabled').checked = settings.gremlinAuditorEnabled;

        document.getElementById('pp_gremlinPapaEnabled').addEventListener('change', (e) => { settings.gremlinPapaEnabled = e.target.checked; window.saveSettingsDebounced(); });
        document.getElementById('pp_gremlinTwinsEnabled').addEventListener('change', (e) => { settings.gremlinTwinsEnabled = e.target.checked; window.saveSettingsDebounced(); });
        document.getElementById('pp_gremlinMamaEnabled').addEventListener('change', (e) => { settings.gremlinMamaEnabled = e.target.checked; window.saveSettingsDebounced(); });
        document.getElementById('pp_gremlinAuditorEnabled').addEventListener('change', (e) => { settings.gremlinAuditorEnabled = e.target.checked; window.saveSettingsDebounced(); });

        injectNavigatorModal();
        const presetNavigator = new PresetNavigator();
        presetNavigator.init();

        // Wait for openai_setting_names to be populated before populating preset dropdowns
        queueReadyTask(async () => {
            await new Promise(resolve => {
                // Poll for openai_setting_names to be available
                const checkInterval = setInterval(() => {
                    if (typeof openai_setting_names !== 'undefined' && Object.keys(openai_setting_names).length > 0) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100); // Check every 100ms
            });

            const presetOptions = Object.keys(openai_setting_names).map(name => `<option value="${name}">${name}</option>`).join('');

            ['papa', 'twins', 'mama', 'writer', 'auditor'].forEach(role => {
                const roleUpper = role.charAt(0).toUpperCase() + role.slice(1);
                const presetSelectId = `pp_gremlin${roleUpper}Preset`;
                const presetSelect = document.getElementById(presetSelectId);
                const browseBtn = document.querySelector(`.pp-browse-gremlin-preset-btn[data-target-select="${presetSelectId}"]`);
                const apiBtn = document.querySelector(`.pp-select-api-btn[data-gremlin-role="${role}"]`);

                if (presetSelect) {
                    presetSelect.innerHTML = presetOptions;
                    presetSelect.value = settings[`gremlin${roleUpper}Preset`] || 'Default';
                    presetSelect.addEventListener('change', () => {
                        settings[`gremlin${roleUpper}Preset`] = presetSelect.value;
                        window.saveSettingsDebounced();
                    });
                }
                if (browseBtn) browseBtn.addEventListener('click', () => presetNavigator.open(presetSelectId));
                if (apiBtn) apiBtn.addEventListener('click', () => showApiEditorPopup(role));

                updateGremlinApiDisplay(role);
            });
             updateGremlinToggleState(); // Update toggle state after UI is ready
             console.log(`${LOG_PREFIX} Preset dropdowns populated.`);
        });


        // ---- INITIALIZE CORE LOGIC ----
        // These event listeners should be bound relatively early, but after core ST events are set up.
        // Binding them inside the APP_READY listener ensures this.
        queueReadyTask(() => {
             // This handler prevents the original generation if the pipeline is starting,
            // and allows internal pipeline /gen calls to proceed.
            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
            // This is the primary trigger for the Gremlin pipeline, happening after user message is rendered.
            // Using makeLast to ensure it runs after other core rendering logic.
            eventSource.makeLast(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
            // This handler is for post-processing the AI's response after it's rendered.
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onAiMessageRendered);
            console.log(`${LOG_PREFIX} Core event listeners bound.`);
        });


        console.log(`${LOG_PREFIX} Core components initialized.`);
    } catch (error) {
        console.error(`${LOG_PREFIX} Critical failure during core initialization:`, error);
        window.toastr.error("Prose Polisher failed to initialize core components. See console.");
    }
}

// Wait for the document to be ready, then start core initialization.
// The APP_READY event listener will handle subsequent setup steps.
$(document).ready(() => {
    console.log(`${LOG_PREFIX} Document ready.`);
    // Listen for the APP_READY event
    eventSource.on(event_types.APP_READY, runReadyQueue);
    // Start core initialization. Some parts will be queued until APP_READY.
    initializeExtensionCore();
});
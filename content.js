// Import necessary SillyTavern objects/functions
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    reloadCurrentChat,
} from '../../../../script.js';
import {
    extension_settings,
    getContext,
} from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
const LOG_PREFIX = `[ProsePolisher]`;
const EXTENSION_NAME = "ProsePolisher";
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROSE_POLISHER_ID_PREFIX = '_prosePolisherRule_';
const SLOP_THRESHOLD = 3;
const BATCH_SIZE = 5;
const MANUAL_ANALYSIS_CHUNK_SIZE = 20;
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
let compiledActiveRules = [];
let analyzedLeaderboardData = { merged: [], remaining: [] };

const defaultSettings = {
    isStaticEnabled: true,
    isDynamicEnabled: false,
    dynamicTriggerCount: 30,
    dynamicRules: [],
    blacklist: ["the", "and", "is", "a", "it", "in", "of", "to", "was", "for", "on", "with"], // Added blacklist with common defaults
};

// 2. HELPER FUNCTIONS
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
    let cleanText = text.replace(/<(info_panel|memo|code|pre|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    cleanText = cleanText.replace(/<[^>]*>/g, ' ');
    return cleanText;
}

function isPhraseHandledByRegex(phrase) {
    for (const compiledRule of compiledActiveRules) {
        if (compiledRule.test(phrase)) {
            return true;
        }
    }
    return false;
}

/**
 * NEW: Checks if a given phrase contains any of the blacklisted words.
 * This is case-insensitive.
 * @param {string} phrase The phrase to check.
 * @returns {boolean} True if the phrase contains a blacklisted word, false otherwise.
 */
function isPhraseBlacklisted(phrase) {
    const blacklist = extension_settings[EXTENSION_NAME]?.blacklist || [];
    if (blacklist.length === 0) return false;

    const lowerCasePhrase = phrase.toLowerCase();
    // Use a regex for faster checking of whole words. \b ensures we match 'he' but not 'the'.
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

// 3. CORE LOGIC & PATTERN FINDING
// -----------------------------------------------------------------------------
function findAndMergePatterns(frequencies) {
    let candidates = Object.entries(frequencies).filter(([, count]) => count > 1);
    candidates.sort(([, countA], [, countB]) => countB - countA);

    const mergedPatterns = {};
    const consumedPhrases = new Set();

    for (let i = 0; i < candidates.length; i++) {
        const [phraseA] = candidates[i];
        if (consumedPhrases.has(phraseA)) continue;

        let bestPattern = null;
        let bestPatternMatches = [];
        let bestPatternCount = 0;

        for (let j = i + 1; j < candidates.length; j++) {
            const [phraseB] = candidates[j];
            if (consumedPhrases.has(phraseB)) continue;

            const wordsA = phraseA.split(' ');
            const wordsB = phraseB.split(' ');
            if (Math.abs(wordsA.length - wordsB.length) > 3) continue;

            let commonPrefix = [];
            for (let k = 0; k < Math.min(wordsA.length, wordsB.length); k++) {
                if (wordsA[k] === wordsB[k]) {
                    commonPrefix.push(wordsA[k]);
                } else {
                    break;
                }
            }

            if (commonPrefix.length >= PATTERN_MIN_COMMON_WORDS) {
                const patternRegex = new RegExp('^' + commonPrefix.join('\\s+') + '(\\s+.*)?$');
                
                let currentMatches = [];
                let currentVariations = new Set();
                let currentCount = 0;

                // Iterate over the whole frequency list to find all phrases matching the prefix
                for (const [p, c] of Object.entries(frequencies)) {
                    if (patternRegex.test(p)) {
                        currentMatches.push(p);
                        currentCount += c;
                        const wordsInP = p.split(' ');
                        const variationPart = wordsInP.slice(commonPrefix.length).join(' ').trim();
                        if (variationPart) {
                            currentVariations.add(variationPart);
                        }
                    }
                }
                
                // A valid pattern must merge at least two different phrases and be better than the last one
                if (currentMatches.length > 1 && currentMatches.length > bestPatternMatches.length) {
                    const variationString = Array.from(currentVariations).join('/');
                    
                    // Only create a pattern if there are actual variations to show
                    if (variationString) {
                        bestPattern = commonPrefix.join(' ') + ' ' + variationString;
                        bestPatternMatches = currentMatches;
                        bestPatternCount = currentCount;
                    }
                }
            }
        }
        
        if (bestPattern) {
            mergedPatterns[bestPattern] = bestPatternCount;
            bestPatternMatches.forEach(p => consumedPhrases.add(p));
        }
    }

    const remaining = {};
    for (const [phrase, count] of Object.entries(frequencies)) {
        if (!consumedPhrases.has(phrase)) {
            remaining[phrase] = count;
        }
    }

    return { merged: mergedPatterns, remaining: remaining };
}


function performIntermediateAnalysis() {
    const frequenciesForCulling = {};
    for (const [phrase, data] of ngramFrequencies.entries()) {
        frequenciesForCulling[phrase] = data.count;
    }
    const culledFrequencies = cullSubstrings(frequenciesForCulling);
    const { merged, remaining } = findAndMergePatterns(culledFrequencies);
    
    const mergedEntries = Object.entries(merged);
    const remainingEntries = Object.entries(remaining);

    mergedEntries.sort((a, b) => b[1] - a[1]);
    remainingEntries.sort((a, b) => b[1] - a[1]);

    analyzedLeaderboardData = {
        merged: mergedEntries,
        remaining: remainingEntries,
    };
}

async function updateGlobalRegexArray() {
    if (!extension_settings.regex) extension_settings.regex = [];
    // Remove old ProsePolisher rules before adding the updated set
    extension_settings.regex = extension_settings.regex.filter(rule => !rule.id?.startsWith(PROSE_POLISHER_ID_PREFIX));

    const rulesToAdd = [];
    const settings = extension_settings[EXTENSION_NAME];
    if (settings.isStaticEnabled) rulesToAdd.push(...staticRules);
    if (settings.isDynamicEnabled) rulesToAdd.push(...dynamicRules);

    const activeRules = rulesToAdd.filter(rule => !rule.disabled);

    for (const rule of activeRules) {
        // Define the rule object with the correct properties for seamless, always-on application.
        const globalRule = {
            id: `${PROSE_POLISHER_ID_PREFIX}${rule.id}`,
            scriptName: `(PP) ${rule.scriptName}`,
            findRegex: rule.findRegex,
            replaceString: rule.replaceString,
            // Standard options
            disabled: rule.disabled,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
            trimStrings: [],
            // 'Affects' setting: AI Output
            placement: [2],
            // 'Other Options'
            runOnEdit: false, // Set to false to run on every generation, not just edits.
            // 'Ephemerality' settings
            is_always_applied_to_display: true, // Alter Chat Display
            is_always_applied_to_prompt: true,  // Alter Outgoing Prompt
        };
        extension_settings.regex.push(globalRule);
    }

    compiledActiveRules = activeRules.map(rule => {
        try { return new RegExp(rule.findRegex, 'i'); }
        catch (error) { console.warn(`${LOG_PREFIX} Invalid regex in rule '${rule.scriptName}':`, error); return null; }
    }).filter(Boolean);

    console.log(`${LOG_PREFIX} Updated global regex array. ProsePolisher rules active: ${activeRules.length}.`);
    saveSettingsDebounced();
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
                // MODIFIED: Added blacklist check
                if (ngram.length < 12 || isPhraseHandledByRegex(ngram) || isPhraseBlacklisted(ngram)) continue;
                
                const currentData = ngramFrequencies.get(ngram) || { count: 0 };
                const newCount = currentData.count + 1;
                ngramFrequencies.set(ngram, { count: newCount, lastSeenMessageIndex: totalAiMessagesProcessed });
                if (newCount === SLOP_THRESHOLD) {
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
            await updateGlobalRegexArray();
        }
    } catch (error) {
        console.error(`${LOG_PREFIX} Error during dynamic rule generation:`, error);
        toastr.error("Prose Polisher: AI rule generation failed or returned invalid data. See console.");
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
        toastr.info(`Prose Polisher: AI is generating rules for ${candidatesToProcess.length} slop phrases...`);
        return await generateAndSaveDynamicRules(candidatesToProcess);
    }
    return 0;
}

async function manualAnalyzeChatHistory() {
    if (isAnalyzingHistory) { toastr.warning("Prose Polisher: Chat history analysis is already in progress."); return; }
    isAnalyzingHistory = true;
    toastr.info("Prose Polisher: Starting analysis of entire chat history...");

    ngramFrequencies.clear();
    slopCandidates.clear();
    analyzedLeaderboardData = { merged: [], remaining: [] };
    totalAiMessagesProcessed = 0;

    const context = getContext();
    const aiMessages = context?.chat?.filter(message => !message.is_user && message.mes) || [];

    if (aiMessages.length === 0) {
        toastr.info("Prose Polisher: No AI messages found in chat history to analyze.");
        isAnalyzingHistory = false;
        return;
    }

    let analyzedMessageCount = 0;
    for (let i = 0; i < aiMessages.length; i += MANUAL_ANALYSIS_CHUNK_SIZE) {
        const chunk = aiMessages.slice(i, i + MANUAL_ANALYSIS_CHUNK_SIZE);

        for (const message of chunk) {
            totalAiMessagesProcessed++;
            analyzeAndTrackFrequency(message.mes);
            analyzedMessageCount++;
        }

        pruneDuringManualAnalysis();
        performIntermediateAnalysis();

        toastr.info(`Prose Polisher: Analyzed ${analyzedMessageCount} / ${aiMessages.length} messages... (Analyzing patterns)`);

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    isAnalyzingHistory = false;

    if (slopCandidates.size > 0) {
        toastr.success(`Prose Polisher: Analysis complete. ${slopCandidates.size} potential slop phrases identified.`);
    } else {
        toastr.info("Prose Polisher: Analysis complete. No new slop candidates found meeting the threshold.");
    }
    showFrequencyLeaderboard();
}

async function handleGenerateRulesFromAnalysisClick() {
    if (isProcessingAiRules) { toastr.warning("Prose Polisher: AI rule generation is already in progress."); return; }
    if (slopCandidates.size === 0) { toastr.info("Prose Polisher: No slop candidates identified. Run analysis or wait for more messages."); return; }
    toastr.info(`Prose Polisher: Starting AI rule generation for ${slopCandidates.size} candidate(s)...`);
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
        toastr.success(`Prose Polisher: AI generated and saved ${totalGeneratedThisRun} new rule(s) from ${initialCandidateCount} candidates!`);
        if (regexNavigator) regexNavigator.open();
    } else if (initialCandidateCount > 0) {
        toastr.info("Prose Polisher: AI rule generation complete. No new rules were created (possibly AI filtered all candidates).");
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
        const mergedRows = mergedEntries
            .map(([phrase, count]) => `<tr class="is-pattern"><td>${phrase}</td><td>${count}</td></tr>`)
            .join('');

        const remainingRows = remainingEntries
            .map(([phrase, count]) => `<tr><td>${phrase}</td><td>${count}</td></tr>`)
            .join('');

        contentHtml = `<p>The following have been detected as repetitive. Phrases in <strong>bold orange</strong> are detected patterns where similar phrases have been grouped.</p>
                       <table class="prose-polisher-frequency-table">
                           <thead><tr><th>Repetitive Phrase or Pattern</th><th>Total Count</th></tr></thead>
                           <tbody>${mergedRows}${remainingRows}</tbody>
                       </table>`;
    }
    callGenericPopup(contentHtml, POPUP_TYPE.TEXT, "Live Frequency Data (with Pattern Analysis)", { wide: true, large: true });
}

/**
 * NEW: Displays a popup for managing the blacklist.
 */
function showBlacklistManager() {
    const settings = extension_settings[EXTENSION_NAME];

    const container = document.createElement('div');
    container.className = 'prose-polisher-blacklist-manager';
    container.innerHTML = `
        <h4>Blacklist Manager</h4>
        <p>Add words to this list to prevent any phrase containing them from being analyzed for repetition. The check is case-insensitive. Whole words only.</p>
        <ul id="pp-blacklist-list"></ul>
        <div class="blacklist-add-controls">
            <input type="text" id="pp-blacklist-input" class="text_pole" placeholder="Add a word...">
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
            item.className = 'blacklist-item';
            item.innerHTML = `
                <span>${word}</span>
                <i class="fa-solid fa-trash-can blacklist-delete-btn" data-word="${word}"></i>
            `;
            item.querySelector('.blacklist-delete-btn').addEventListener('click', () => {
                settings.blacklist = settings.blacklist.filter(w => w !== word);
                saveSettingsDebounced();
                renderBlacklist();
            });
            listElement.appendChild(item);
        });
    };

    const addWord = () => {
        const newWord = inputElement.value.trim().toLowerCase();
        if (newWord && !settings.blacklist.includes(newWord)) {
            settings.blacklist.push(newWord);
            saveSettingsDebounced();
            renderBlacklist();
            inputElement.value = '';
        }
        inputElement.focus();
    };

    addButton.addEventListener('click', addWord);
    inputElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            addWord();
        }
    });

    renderBlacklist();
    callGenericPopup(container, POPUP_TYPE.DISPLAY, "Blacklist Manager", { wide: false, large: false });
}


// 4. EVENT HANDLING & INITIALIZATION
// -----------------------------------------------------------------------------

function hideRulesInStandardUI() {
    const regexListItems = document.querySelectorAll('#saved_regex_scripts .regex-script-label');
    regexListItems.forEach(item => {
        const scriptNameEl = item.querySelector('.regex_script_name');
        if (scriptNameEl && scriptNameEl.textContent.startsWith('(PP)')) {
            item.style.display = 'none';
        }
    });
}

function handleSentenceCapitalization(messageElement) {
    if (!messageElement) return;
    const messageTextElement = messageElement.querySelector('.mes_text');
    if (!messageTextElement) return;

    let textContent = messageTextElement.innerHTML;
    const originalHTML = textContent;

    // 1. Capitalize the very first letter of the entire message, if it's lowercase.
    // This regex skips over any initial HTML tags to find the first actual letter.
    textContent = textContent.replace(/^(\s*<[^>]*>)*([a-z])/, (match, tags, letter) => {
        return `${tags || ''}${letter.toUpperCase()}`;
    });

    // 2. Capitalize letters following sentence-ending punctuation (. ? !) ONLY.
    // This regex correctly ignores commas and skips over any HTML tags.
    textContent = textContent.replace(/([.!?])(\s*<[^>]*>)*\s+([a-z])/g, (match, punc, tags, letter) => {
        return `${punc}${tags || ''} ${letter.toUpperCase()}`;
    });

    if (textContent !== originalHTML) {
        console.log(`${LOG_PREFIX} Applying enhanced auto-capitalization to a rendered message.`);
        messageTextElement.innerHTML = textContent;
    }
}


function handleMessageSent(data) {
    if (data.is_user || !data.message) return;
    totalAiMessagesProcessed++;
    analyzeAndTrackFrequency(data.message);
    if (totalAiMessagesProcessed % PRUNE_CHECK_INTERVAL === 0) {
        pruneOldNgrams();
    }
    const settings = extension_settings[EXTENSION_NAME];
    if (settings.isDynamicEnabled && slopCandidates.size > 0) {
        messageCounterForTrigger++;
        if (messageCounterForTrigger >= settings.dynamicTriggerCount) {
            messageCounterForTrigger = 0;
            checkForSlopAndGenerateRulesController();
        }
    } else {
        messageCounterForTrigger = 0;
    }
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
            if (!rule.isStatic) { extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules; }
            this.renderRuleList();
            await updateGlobalRegexArray();
            toastr.success(`Rule "${rule.scriptName}" ${rule.disabled ? 'disabled' : 'enabled'}.`);
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
            <label for="pp_editor_replace">Replace String</label>
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
                    deleteBtn.closest('.popup_confirm')?.querySelector('.popup-button-cancel')?.click();
                }
            });
        }
        const popupResult = await callGenericPopup(editorContent, POPUP_TYPE.CONFIRM, isNew ? 'Create New Rule' : 'Edit Rule', { wide: true, large: true });
        if (popupResult) {
            const nameInput = editorContent.querySelector('#pp_editor_name'), findInput = editorContent.querySelector('#pp_editor_find'), replaceInput = editorContent.querySelector('#pp_editor_replace'), disabledInput = editorContent.querySelector('#pp_editor_disabled');
            rule.disabled = disabledInput.checked;
            if (!rule.isStatic) {
                if (!nameInput.value.trim() || !findInput.value.trim()) { toastr.error("Rule Name and Find Regex cannot be empty."); this.openRuleEditor(ruleId); return; }
                try { new RegExp(findInput.value); } catch (e) { toastr.error(`Invalid Regex: ${e.message}`); this.openRuleEditor(ruleId); return; }
                rule.scriptName = nameInput.value; rule.findRegex = findInput.value; rule.replaceString = replaceInput.value;
            }
            if (isNew && !rule.isStatic) { dynamicRules.push(rule); }
            if (!rule.isStatic) { extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules; }
            this.renderRuleList();
            await updateGlobalRegexArray();
            toastr.success(isNew ? "New rule created." : "Rule updated.");
        }
    }

    async handleDelete(ruleId) {
        const index = dynamicRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            dynamicRules.splice(index, 1);
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            this.renderRuleList();
            await updateGlobalRegexArray();
            toastr.success("Dynamic rule deleted.");
        }
    }
}

async function initializeProsePolisher() {
    try {
        console.log(`${LOG_PREFIX} Initializing...`);
        extension_settings[EXTENSION_NAME] = { ...defaultSettings, ...extension_settings[EXTENSION_NAME] };
        dynamicRules = extension_settings[EXTENSION_NAME].dynamicRules || [];
        const staticResponse = await fetch(`${EXTENSION_FOLDER_PATH}/regex_rules.json`);
        if (!staticResponse.ok) throw new Error("Failed to fetch regex_rules.json");
        staticRules = await staticResponse.json();
        const settingsHtml = await fetch(`${EXTENSION_FOLDER_PATH}/settings.html`).then(res => res.text());
        document.getElementById('extensions_settings').insertAdjacentHTML('beforeend', settingsHtml);
        const staticToggle = document.getElementById('prose_polisher_enable_static'), dynamicToggle = document.getElementById('prose_polisher_enable_dynamic'), triggerInput = document.getElementById('prose_polisher_dynamic_trigger'), navigatorBtn = document.getElementById('prose_polisher_open_navigator_button'), clearFreqBtn = document.getElementById('prose_polisher_clear_frequency_button'), analyzeChatBtn = document.getElementById('prose_polisher_analyze_chat_button'), viewFreqBtn = document.getElementById('prose_polisher_view_frequency_button'), generateRulesBtn = document.getElementById('prose_polisher_generate_rules_button'), manageBlacklistBtn = document.getElementById('prose_polisher_manage_blacklist_button'); // NEW: Get blacklist button
        staticToggle.checked = extension_settings[EXTENSION_NAME].isStaticEnabled;
        dynamicToggle.checked = extension_settings[EXTENSION_NAME].isDynamicEnabled;
        triggerInput.value = extension_settings[EXTENSION_NAME].dynamicTriggerCount;
        staticToggle.addEventListener('change', async () => { extension_settings[EXTENSION_NAME].isStaticEnabled = staticToggle.checked; await updateGlobalRegexArray(); });
        dynamicToggle.addEventListener('change', async () => { extension_settings[EXTENSION_NAME].isDynamicEnabled = dynamicToggle.checked; if(!dynamicToggle.checked) messageCounterForTrigger = 0; await updateGlobalRegexArray(); });
        triggerInput.addEventListener('input', () => { const value = parseInt(triggerInput.value, 10); if (!isNaN(value) && value >= 1) { extension_settings[EXTENSION_NAME].dynamicTriggerCount = value; saveSettingsDebounced(); } });
        
        regexNavigator = new RegexNavigator();
        
        navigatorBtn.addEventListener('pointerup', () => regexNavigator.open());
        analyzeChatBtn.addEventListener('pointerup', manualAnalyzeChatHistory);
        viewFreqBtn.addEventListener('pointerup', showFrequencyLeaderboard);
        generateRulesBtn.addEventListener('pointerup', handleGenerateRulesFromAnalysisClick);
        manageBlacklistBtn.addEventListener('pointerup', showBlacklistManager); // NEW: Add event listener
        clearFreqBtn.addEventListener('pointerup', () => { ngramFrequencies.clear(); slopCandidates.clear(); messageCounterForTrigger = 0; totalAiMessagesProcessed = 0; analyzedLeaderboardData = { merged: [], remaining: [] }; toastr.success("Prose Polisher frequency data cleared!"); });

        eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleSentenceCapitalization);

        const regexListContainer = document.getElementById('saved_regex_scripts');
        if (regexListContainer) {
            const observer = new MutationObserver(hideRulesInStandardUI);
            observer.observe(regexListContainer, { childList: true });
            hideRulesInStandardUI();
        } else {
            console.warn(`${LOG_PREFIX} Could not find regex list container #saved_regex_scripts to attach UI hider.`);
        }

        await updateGlobalRegexArray();
        console.log(`${LOG_PREFIX} Initialized successfully.`);
    } catch (error) {
        console.error(`${LOG_PREFIX} Critical failure during initialization:`, error);
        toastr.error("Prose Polisher failed to initialize. See console.");
    }
}
$(document).ready(() => { setTimeout(initializeProsePolisher, 1500); });
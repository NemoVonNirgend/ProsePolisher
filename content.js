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

// --- State Variables ---
let staticRules = [];
let dynamicRules = [];
let ngramFrequencies = {};
let messageCounter = 0;
let isProcessing = false;
let regexNavigator;
// NEW: A set to hold phrases that have met the threshold for being slop.
let slopCandidates = new Set();


const defaultSettings = {
    isStaticEnabled: true,
    isDynamicEnabled: false,
    dynamicTriggerCount: 30,
    dynamicRules: [],
};

// 2. HELPER FUNCTIONS
// -----------------------------------------------------------------------------
function generateNgrams(text, n) {
    const words = text.replace(/[.,!?]/g, '').split(/\s+/).filter(w => w);
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
    const allRules = [...staticRules, ...dynamicRules];
    for (const rule of allRules) {
        if (rule.disabled) continue;
        try {
            const regex = new RegExp(rule.findRegex, 'i');
            if (regex.test(phrase)) {
                return true;
            }
        } catch (error) {
            // console.warn(`${LOG_PREFIX} Invalid regex in rule '${rule.scriptName}':`, error);
        }
    }
    return false;
}

function cullSubstrings(frequencies) {
    const culledFrequencies = { ...frequencies };
    const sortedPhrases = Object.keys(culledFrequencies).sort((a, b) => b.length - a.length);
    const phrasesToRemove = new Set();
    for (let i = 0; i < sortedPhrases.length; i++) {
        const longerPhrase = sortedPhrases[i];
        for (let j = i + 1; j < sortedPhrases.length; j++) {
            const shorterPhrase = sortedPhrases[j];
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


// 3. CORE LOGIC
// -----------------------------------------------------------------------------
async function updateGlobalRegexArray() {
    if (!extension_settings.regex) {
        extension_settings.regex = [];
    }
    extension_settings.regex = extension_settings.regex.filter(rule => !rule.id?.startsWith(PROSE_POLISHER_ID_PREFIX));
    const rulesToAdd = [];
    const settings = extension_settings[EXTENSION_NAME];
    if (settings.isStaticEnabled) rulesToAdd.push(...staticRules);
    if (settings.isDynamicEnabled) rulesToAdd.push(...dynamicRules);
    for (const rule of rulesToAdd) {
        const globalRule = { id: `${PROSE_POLISHER_ID_PREFIX}${rule.id}`, scriptName: `(PP) ${rule.scriptName}`, findRegex: rule.findRegex, replaceString: rule.replaceString, disabled: rule.disabled, placement: [2], markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, trimStrings: [] };
        extension_settings.regex.push(globalRule);
    }
    console.log(`${LOG_PREFIX} Updated global regex array. ProsePolisher rules: ${rulesToAdd.length}.`);
    await reloadCurrentChat();
    saveSettingsDebounced();
}

// NEW: Processes a new potential slop phrase in real-time.
function processNewSlopCandidate(newPhrase) {
    let isSubstring = false;
    const phrasesToRemove = [];

    // Check against existing candidates to avoid redundancy
    for (const existingPhrase of slopCandidates) {
        if (existingPhrase.includes(newPhrase)) {
            // The new phrase is a substring of an already-existing, longer candidate. Ignore it.
            isSubstring = true;
            break;
        }
        if (newPhrase.includes(existingPhrase)) {
            // The new phrase is longer and contains an existing candidate. Mark the old one for removal.
            phrasesToRemove.push(existingPhrase);
        }
    }

    if (!isSubstring) {
        phrasesToRemove.forEach(phrase => slopCandidates.delete(phrase));
        slopCandidates.add(newPhrase);
        // console.log(`${LOG_PREFIX} Promoted new slop candidate: "${newPhrase}"`);
    }
}

// MODIFIED: Now processes n-grams incrementally.
function analyzeAndTrackFrequency(text) {
    if (!extension_settings[EXTENSION_NAME]?.isDynamicEnabled) return;
    const cleanText = stripMarkup(text);
    if (!cleanText.trim()) return;
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    const NGRAM_MIN = 4;
    const NGRAM_MAX = 10;
    for (const sentence of sentences) {
        for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
            const ngrams = generateNgrams(sentence, n);
            for (const ngram of ngrams) {
                const normalizedNgram = ngram.toLowerCase().trim();
                if (normalizedNgram.length < 15 || isPhraseHandledByRegex(normalizedNgram)) {
                    continue;
                }
                const newCount = (ngramFrequencies[normalizedNgram] || 0) + 1;
                ngramFrequencies[normalizedNgram] = newCount;
                // If a phrase hits the threshold, process it immediately.
                if (newCount === SLOP_THRESHOLD) {
                    processNewSlopCandidate(normalizedNgram);
                }
            }
        }
    }
}

// MODIFIED: Simplified to only handle the API call with pre-selected candidates.
async function generateAndSaveDynamicRules(candidates) {
    if (candidates.length === 0) return 0;
    isProcessing = true;
    let addedCount = 0;
    console.log(`${LOG_PREFIX} Sending ${candidates.length} candidates for dynamic rule generation...`);

    const exampleFormat = { id: "DYN_1716942000000", scriptName: "Slopfix - A slow smile", findRegex: "\\b[Aa]\\s+(slow|small)\\s+smile\\s+(spreads?|creeps?)\\s+([Hh]is|[Hh]er)\\s+face\\b", replaceString: "{{random:A $1 smile touched $3 face,The corners of $3 mouth turned up in a $1 smile}}", disabled: false };
    const systemPrompt = `You are a regex generation expert for a writing assistance tool.\nINSTRUCTIONS:\n1.  Analyze the following list of potentially repetitive phrases ("slop") detected in a chat.\n2.  For EACH phrase that is genuinely repetitive or clichéd, create a corresponding JSON object to correct it.\n3.  Phrases that are common conversational text (e.g., "he said", "what do you mean") should be IGNORED.\n4.  The 'findRegex' must be a valid JavaScript regex string. Use capture groups '()' for variable parts. Use word boundaries (\\b).\n5.  The 'replaceString' should use '{{random:alternative one,alternative two}}' syntax. Use '$1', '$2' to refer to capture groups.\n6.  Your entire output MUST be a single, valid JSON array containing ALL the rule objects you created. Do not include any other text, explanations, or markdown.\n\nEXAMPLE OUTPUT FORMAT (for multiple inputs):\n[\n  { ... rule for first phrase ... },\n  { ... rule for second phrase ... },\n  ${JSON.stringify(exampleFormat, null, 2)}\n]`;
    const userPrompt = `Top ${candidates.length} detected repetitive phrases:\n- ${candidates.join('\n- ')}\n\nGenerate the JSON array of regex rules for these phrases:`;

    try {
        const response = await fetch('https://text.pollinations.ai/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-reasoning', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const responseText = await response.text();
        const jsonMatch = responseText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        if (!jsonMatch) throw new Error("LLM did not return a valid JSON array.");

        const newRules = JSON.parse(jsonMatch[0]);
        for (const rule of newRules) {
            if (rule && rule.scriptName && rule.findRegex && rule.replaceString) {
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
        toastr.error("Prose Polisher: AI rule generation failed. See console.");
    } finally {
        isProcessing = false;
        console.log(`${LOG_PREFIX} Dynamic rule generation finished.`);
        return addedCount;
    }
}

// NEW: Controller function to check for candidates and trigger generation.
async function checkForSlopAndGenerateRules() {
    if (isProcessing || slopCandidates.size === 0) {
        return 0;
    }

    // Take a batch of candidates to process
    const candidatesToProcess = Array.from(slopCandidates).slice(0, BATCH_SIZE);

    // Remove the processed candidates from the main set
    candidatesToProcess.forEach(candidate => slopCandidates.delete(candidate));

    return await generateAndSaveDynamicRules(candidatesToProcess);
}


// MODIFIED: Uses the new real-time candidate processing.
async function manualAnalyzeChatHistory() {
    toastr.info("Prose Polisher: Analyzing entire chat history for repetitive phrases...");
    // Reset state for a clean manual run
    ngramFrequencies = {};
    slopCandidates.clear();
    
    const context = getContext();

    if (!context || !context.chat || context.chat.length === 0) {
        toastr.warning("Prose Polisher: No chat history found to analyze.");
        return;
    }

    for (const message of context.chat) {
        if (message.is_user || !message.mes) continue;
        analyzeAndTrackFrequency(message.mes);
    }
    
    // Now that candidates are populated, trigger the generation
    const newRulesCount = await checkForSlopAndGenerateRules();

    if (newRulesCount > 0) {
        toastr.success(`Prose Polisher: Analysis complete. AI generated and saved ${newRulesCount} new correction rules!`);
    } else {
        toastr.info("Prose Polisher: Analysis complete. No new rules were needed or found.");
    }

    if (newRulesCount > 0 && regexNavigator) {
        regexNavigator.open();
    }
}

function showFrequencyLeaderboard() {
    const culledFrequencies = cullSubstrings(ngramFrequencies);
    const frequencyEntries = Object.entries(culledFrequencies);
    let contentHtml;
    if (frequencyEntries.length === 0) {
        contentHtml = '<p>No repetitive phrases have been detected in this session yet. Send more messages or use "Analyze Chat History".</p>';
    } else {
        frequencyEntries.sort((a, b) => b[1] - a[1]);
        const tableRows = frequencyEntries.map(([phrase, count]) => `<tr><td>${phrase}</td><td>${count}</td></tr>`).join('');
        contentHtml = `<p>The following phrases have been detected as repetitive in the current session. Phrases with a count of ${SLOP_THRESHOLD} or more will be used to generate new rules. (This view is cleaned to remove substrings and already-handled phrases).</p><table class="prose-polisher-frequency-table"><thead><tr><th>Repetitive Phrase (n-gram)</th><th>Count</th></tr></thead><tbody>${tableRows}</tbody></table>`;
    }
    callGenericPopup(contentHtml, POPUP_TYPE.TEXT, "Live Frequency Data", { wide: true, large: true });
}

// 4. EVENT HANDLING
// -----------------------------------------------------------------------------
// MODIFIED: Event handler is now much lighter.
function handleMessageSent(data) {
    if (data.is_user || !data.message) return;
    analyzeAndTrackFrequency(data.message);
    messageCounter++;
    const settings = extension_settings[EXTENSION_NAME];
    if (settings.isDynamicEnabled && messageCounter >= settings.dynamicTriggerCount) {
        messageCounter = 0;
        checkForSlopAndGenerateRules(); // Call the lightweight controller
    }
}

// 5. UI & INITIALIZATION
// -----------------------------------------------------------------------------
class RegexNavigator {
    constructor() { this.modalId = 'prose-polisher-regex-navigator-modal'; this.modal = null; }
    open() {
        if (document.getElementById(this.modalId)) this.close();
        dynamicRules.forEach(rule => delete rule.isNew);
        const modalHtml = `<div id="${this.modalId}" class="prose-polisher-regex-navigator-modal"><div class="modal-content"><div class="modal-header"><h2>Regex Rule Navigator</h2><span class="close-button">×</span></div><div class="navigator-body"><div class="navigator-main-panel"><div id="regex-navigator-list-view"></div></div></div><div class="modal-footer"><button id="prose-polisher-new-rule-btn" class="menu_button"><i class="fa-solid fa-plus"></i> New Dynamic Rule</button></div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modal = document.getElementById(this.modalId);
        this.modal.querySelector('.close-button').addEventListener('click', () => this.close());
        this.modal.querySelector('#prose-polisher-new-rule-btn').addEventListener('click', () => this.openRuleEditor(null));
        this.renderRuleList();
        this.modal.style.display = 'block';
    }
    close() { this.modal?.remove(); this.modal = null; }
    renderRuleList() {
        const listView = this.modal.querySelector('#regex-navigator-list-view');
        listView.innerHTML = '';
        const allRules = [...staticRules, ...dynamicRules];
        for (const rule of allRules) {
            const item = document.createElement('div');
            item.className = 'regex-navigator-item';
            item.classList.toggle('is-dynamic', !rule.isStatic);
            item.classList.toggle('is-disabled', rule.disabled);
            item.classList.toggle('is-newly-added', !!rule.isNew);
            item.dataset.id = rule.id;
            item.innerHTML = `<div class="item-icon"><i class="fa-solid ${rule.isStatic ? 'fa-database' : 'fa-wand-magic-sparkles'}"></i></div><div class="item-details"><div class="script-name">${rule.scriptName}</div><div class="find-regex">${rule.findRegex}</div></div><div class="item-status">${rule.isStatic ? '<span>Static</span>' : '<span>Dynamic</span>'}<i class="fa-solid ${rule.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i></div>`;
            item.addEventListener('click', () => this.openRuleEditor(rule.id));
            listView.appendChild(item);
        }
    }
    async openRuleEditor(ruleId) {
        const isNew = ruleId === null;
        let rule;
        if (isNew) { rule = { id: `DYN_${Date.now()}`, scriptName: '', findRegex: '', replaceString: '', disabled: false, isStatic: false }; }
        else { rule = [...staticRules, ...dynamicRules].find(r => r.id === ruleId); }
        if (!rule) return;
        const editorHtml = `<div class="prose-polisher-rule-editor-popup" data-rule-id="${rule.id}"><label for="pp_editor_name">Rule Name</label><input type="text" id="pp_editor_name" class="text_pole" value="${rule.scriptName}" ${rule.isStatic ? 'disabled' : ''}><label for="pp_editor_find">Find Regex</label><textarea id="pp_editor_find" class="text_pole" ${rule.isStatic ? 'disabled' : ''}>${rule.findRegex}</textarea><label for="pp_editor_replace">Replace String (use {{random:...}} and $1, $2, etc.)</label><textarea id="pp_editor_replace" class="text_pole" ${rule.isStatic ? 'disabled' : ''}>${rule.replaceString}</textarea><div class="editor-actions"><div class="actions-left"><label class="checkbox_label"><input type="checkbox" id="pp_editor_disabled" ${rule.disabled ? 'checked' : ''}><span>Disabled</span></label></div>${!rule.isStatic ? '<button id="pp_editor_delete" class="menu_button is_dangerous">Delete</button>' : ''}</div></div>`;
        const popupResult = await callGenericPopup(editorHtml, POPUP_TYPE.CONFIRM, isNew ? 'Create New Rule' : 'Edit Rule', { wide: true, large: true });
        if (popupResult) {
            const nameInput = document.getElementById('pp_editor_name');
            const findInput = document.getElementById('pp_editor_find');
            const replaceInput = document.getElementById('pp_editor_replace');
            const disabledInput = document.getElementById('pp_editor_disabled');
            rule.disabled = disabledInput.checked;
            if (!rule.isStatic) { rule.scriptName = nameInput.value; rule.findRegex = findInput.value; rule.replaceString = replaceInput.value; }
            if (isNew) { dynamicRules.push(rule); }
            else { const targetArray = rule.isStatic ? staticRules : dynamicRules; const index = targetArray.findIndex(r => r.id === ruleId); if (index !== -1) targetArray[index] = rule; }
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            this.renderRuleList();
            await updateGlobalRegexArray();
        }
    }
    async handleDelete(ruleId) {
        const index = dynamicRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            dynamicRules.splice(index, 1);
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            const editorPopup = document.querySelector('.prose-polisher-rule-editor-popup');
            const confirmPopup = editorPopup?.closest('.popup_confirm');
            if (confirmPopup) confirmPopup.querySelector('.popup-button-cancel').click();
            this.renderRuleList();
            await updateGlobalRegexArray();
            toastr.success("Rule deleted.");
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

        const staticToggle = document.getElementById('prose_polisher_enable_static');
        const dynamicToggle = document.getElementById('prose_polisher_enable_dynamic');
        const triggerInput = document.getElementById('prose_polisher_dynamic_trigger');
        const navigatorBtn = document.getElementById('prose_polisher_open_navigator_button');
        const clearFreqBtn = document.getElementById('prose_polisher_clear_frequency_button');
        const analyzeChatBtn = document.getElementById('prose_polisher_analyze_chat_button');
        const viewFreqBtn = document.getElementById('prose_polisher_view_frequency_button');

        staticToggle.checked = extension_settings[EXTENSION_NAME].isStaticEnabled;
        dynamicToggle.checked = extension_settings[EXTENSION_NAME].isDynamicEnabled;
        triggerInput.value = extension_settings[EXTENSION_NAME].dynamicTriggerCount;

        staticToggle.addEventListener('change', async () => { extension_settings[EXTENSION_NAME].isStaticEnabled = staticToggle.checked; await updateGlobalRegexArray(); });
        dynamicToggle.addEventListener('change', async () => { extension_settings[EXTENSION_NAME].isDynamicEnabled = dynamicToggle.checked; await updateGlobalRegexArray(); });
        triggerInput.addEventListener('input', () => { const value = parseInt(triggerInput.value, 10); if (!isNaN(value) && value >= 5) { extension_settings[EXTENSION_NAME].dynamicTriggerCount = value; saveSettingsDebounced(); } });

        regexNavigator = new RegexNavigator();
        navigatorBtn.addEventListener('click', () => regexNavigator.open());
        analyzeChatBtn.addEventListener('click', manualAnalyzeChatHistory);
        viewFreqBtn.addEventListener('click', showFrequencyLeaderboard);

        document.body.addEventListener('click', async (event) => {
            if (event.target && event.target.id === 'pp_editor_delete') {
                const ruleId = event.target.closest('.prose-polisher-rule-editor-popup')?.dataset.ruleId;
                if (ruleId) {
                    const confirm = await callGenericPopup('Are you sure you want to permanently delete this rule?', POPUP_TYPE.CONFIRM);
                    if (confirm) regexNavigator.handleDelete(ruleId);
                }
            }
        });
        
        // MODIFIED: Clear frequency data now also clears the new candidates set.
        clearFreqBtn.addEventListener('click', () => { 
            ngramFrequencies = {}; 
            slopCandidates.clear();
            messageCounter = 0; 
            toastr.success("Prose Polisher: In-memory frequency data has been cleared!"); 
        });

        eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
        console.log(`${LOG_PREFIX} Hooked into MESSAGE_SENT event for frequency analysis.`);
        await updateGlobalRegexArray();
        console.log(`${LOG_PREFIX} Initialized successfully.`);
    } catch (error) {
        console.error(`${LOG_PREFIX} Critical failure during initialization:`, error);
        toastr.error("Prose Polisher failed to initialize. See console for details.");
    }
}

$(document).ready(() => {
    setTimeout(initializeProsePolisher, 1500);
});

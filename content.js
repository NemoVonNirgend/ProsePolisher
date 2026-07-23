import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

// Local module imports
import { Analyzer } from './analyzer.js';
import { normalizeRule, parseAlternatives, previewRule, validateRule } from './rule-utils.js';
import {
    PROSE_POLISHER_RULE_PREFIX,
    syncGlobalRegexRules,
} from './global-regex.js';

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
export const EXTENSION_NAME = "ProsePolisher";
const LOG_PREFIX = `[${EXTENSION_NAME}]`;
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROSE_POLISHER_ID_PREFIX = PROSE_POLISHER_RULE_PREFIX;

// --- State Variables ---
let staticRules = [];
let dynamicRules = [];
let regexNavigator;
let prosePolisherAnalyzer = null;
let processedMessageIds = new Set();

let isAppReady = false;
let readyQueue = [];

// --- CONSTANTS ---

// Using a template literal (backticks) to prevent macro processing.
const DEFAULT_REGEX_GENERATION_INSTRUCTIONS = `You are an expert in natural language processing and JavaScript regular expressions. Your task is to analyze the provided text and identify repetitive phrases or "slop" that can be replaced with more concise, varied, or evocative language.

For each identified phrase, create a JavaScript regular expression (regex) that can accurately find it, and a replacement string. The replacement string MUST use the \`{{random:option1,option2,option3,...}}\` syntax to provide at least 15 wildly different, contextually appropriate, and grammatically correct alternative phrases. These alternatives should offer significant stylistic variation while maintaining the original meaning. They should not be variations of the same phrase, saying, or other wise, but be truely transformative.

**Crucial Considerations:**
1.  **Pronoun Handling:** Your regex MUST account for different pronouns (e.g., "his", "her", "their", "my", "your", "he", "she", "they", "I", "you"). Use capture groups (e.g., \`([Hh]is|[Hh]er|[Tt]heir)\`) and backreferences (e.g., \`$1\`) in the replacement string to ensure the correct pronoun is used.
2.  **Combined Phrases:** If a single regex cannot account for all variations of a combined phrase (e.g., "his face paled" and "his knuckles whitened" are often related to fear but are distinct actions), split them into two separate regex rules, each with its own set of 15+ variations.
3.  **Output Format:** Provide your output STRICTLY as a JSON array of objects. Each object MUST have the following properties:
    *   \`scriptName\`: A descriptive name for the rule (e.g., "Slopfix - Repetitive Blushing").
    *   \`findRegex\`: The JavaScript regular expression string.
    *   \`replaceString\`: The replacement string using the \`{{random:...}}\` syntax. **IMPORTANT**: To prevent the system from misinterpreting the examples, they are shown with a space, like \`{ {random:...} }\`. Your output **MUST** be compact, without any spaces, like \`{{random:...}}\`.

**Examples of Desired Output (Truncated for brevity, but your output should have 15+ options):**

\`\`\`json
[
    {
        "scriptName": "Slopfix - Repetitive Blushing",
        "findRegex": "\\\\b([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)\\\\s+(cheeks?|face)\\\\s+(?:flushed|bloomed|burned|turned|grew|went)(?:\\\\s+(?:a\\\\s+)?(vibrant|deep|intense|bright|fiery|dark|faint|pale|rosy))?\\\\s*(rose|pink|crimson|scarlet|red)\\\\b",
        "replaceString": "{ {random:a telltale heat bloomed high on $1 $2,color flooded $1 cheeks like spilled wine,a sudden warmth crept up $1 neck,$1's $2 grew hot beneath the gaze,heat pricked across $1 $2,a rush of betraying color rose on $1 face} }"
    },
    {
        "scriptName": "Slopfix - Breath Hitching/Gasping",
        "findRegex": "\\\\b([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)\\\\s+(?:own\\\\s+)?breath\\\\s+(hitched|caught|stuttered)(?:\\\\s+in\\\\s+\\\\1\\\\s+throat)?\\\\b",
        "replaceString": "{ {random:$1 drew a sharp, audible breath,a small involuntary sound escaped $1 throat,$1's breathing momentarily faltered,$1 inhaled sharply as if stung,air caught in $1 chest like a snag} }"
    }
]
\`\`\`
Do NOT include any other text or commentary in your response, only the JSON array.`;

const defaultSettings = {
    // Prose Polisher - Regex & Learning
    isStaticEnabled: true,
    isDynamicEnabled: true,
    integrateWithGlobalRegex: true,
    dynamicTriggerCount: 30,
    regexGenerationInstructions: '',
    skipTriageCheck: false,
    autoActivateGeneratedRules: false,

    // Prose Polisher - Analysis Engine
    slopThreshold: 5.0,
    leaderboardUpdateCycle: 10,
    pruningCycle: 20,
    ngramMax: 7,
    patternMinCommon: 2,

    blacklist: {
        'ozone': 3,
        'whisper': 3,
        'shivers': 3,
        'obsidian': 3,
        'white knuckles': 3,
        'head ducked': 3,
    },
};

// 2. HELPER FUNCTIONS (Prose Polisher - UI & Rule Management)
// -----------------------------------------------------------------------------

function getCompiledRegexes() {
    const settings = extension_settings[EXTENSION_NAME];
    const rulesToCompile = [];
    if (settings.isStaticEnabled) rulesToCompile.push(...staticRules.filter(r => !r.disabled));
    if (settings.isDynamicEnabled) rulesToCompile.push(...dynamicRules.filter(r => !r.disabled));
    return rulesToCompile.map(rule => {
        try { return new RegExp(rule.findRegex, 'i'); } catch (e) { return null; }
    }).filter(Boolean);
};

function compileInternalActiveRules() {
    const settings = extension_settings[EXTENSION_NAME];
    const rules = [];
    if (settings.isStaticEnabled) {
        rules.push(...staticRules.filter(r => !r.disabled));
    }
    if (settings.isDynamicEnabled) {
        rules.push(...dynamicRules.filter(r => !r.disabled));
    }
    console.log(`${LOG_PREFIX} Request to compile internal active rules. Active: ${rules.length}. Global integration: ${settings.integrateWithGlobalRegex}`);
}

async function updateGlobalRegexArray() {
    const settings = extension_settings[EXTENSION_NAME];
    if (!isAppReady) {
        console.warn(`${LOG_PREFIX} updateGlobalRegexArray called before app ready. Skipping.`);
        return;
    }

    const rulesToSync = [
        ...(settings.isStaticEnabled ? staticRules : []),
        ...(settings.isDynamicEnabled ? dynamicRules : []),
    ];
    extension_settings.regex = syncGlobalRegexRules(
        extension_settings.regex,
        rulesToSync,
        settings.integrateWithGlobalRegex,
    );
    console.log(`${LOG_PREFIX} Synchronized ${rulesToSync.filter(rule => !rule.disabled).length} active rules with the global regex list.`);

    saveSettingsDebounced();

    // Update the analyzer's internal regex list
    if (prosePolisherAnalyzer) {
        prosePolisherAnalyzer.compiledRegexes = getCompiledRegexes();
    }
}

function hideRulesInStandardUI() {
    if (!isAppReady) return;
    const regexListItems = document.querySelectorAll('#saved_regex_scripts .regex-script-item');
    regexListItems.forEach(item => {
        const scriptNameEl = item.querySelector('.regex_script_name');
        if (scriptNameEl && scriptNameEl.textContent.startsWith('(PP)')) {
            item.style.display = 'none';
        } else {
            item.style.display = '';
        }
    });
}

let reloadPromptTimeout;
function showReloadPrompt() {
    clearTimeout(reloadPromptTimeout);
    const existingPrompt = document.getElementById('prose-polisher-reload-prompt');
    if (existingPrompt) { existingPrompt.remove(); }

    const promptDiv = document.createElement('div');
    promptDiv.id = 'prose-polisher-reload-prompt';
    promptDiv.style.cssText = `
        position: absolute;
        top: 10px; /* Adjust this value as needed for visual placement */
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.7); /* Semi-transparent dark background */
        color: var(--pp-text-color);
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: sans-serif;
        border: 1px solid var(--pp-border-color);
        width: fit-content; /* Ensure it doesn't stretch too wide */
        white-space: nowrap; /* Prevent text wrapping */
    `;
    promptDiv.innerHTML = `
        <span>Settings changed. Reload to apply?</span>
        <button id="prose-polisher-reload-button" style="
            background-color: var(--pp-accent-color);
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            transition: background-color 0.2s;
        ">Reload Now</button>
    `;

    // Add hover effect for the button
    const reloadButton = promptDiv.querySelector('#prose-polisher-reload-button');
    if (reloadButton) {
        reloadButton.addEventListener('mouseenter', () => {
            reloadButton.style.backgroundColor = 'var(--pp-accent-hover)';
        });
        reloadButton.addEventListener('mouseleave', () => {
            reloadButton.style.backgroundColor = 'var(--pp-accent-color)';
        });
    }

    // Find the insertion point within the extension's settings HTML
    const globalRegexToggle = document.getElementById('prose_polisher_enable_global_regex');
    let insertionPoint = null;
    if (globalRegexToggle) {
        let currentElement = globalRegexToggle.closest('.form-group');
        if (currentElement) {
            currentElement = currentElement.nextElementSibling; // This should be the <hr>
            if (currentElement && currentElement.tagName === 'HR') {
                insertionPoint = currentElement;
            }
        }
    }

    const drawerContent = document.querySelector('.prose-polisher-settings .inline-drawer-content');

    if (drawerContent) {
        drawerContent.style.position = 'relative'; // Ensure parent is relative for absolute positioning
        if (insertionPoint && insertionPoint.parentElement === drawerContent) {
            drawerContent.insertBefore(promptDiv, insertionPoint);
        } else {
            // Fallback if specific HR not found, prepend to top of drawer content
            drawerContent.prepend(promptDiv);
        }
    } else {
        document.body.appendChild(promptDiv); // Ultimate fallback if extension container not found
    }

    document.getElementById('prose-polisher-reload-button').addEventListener('click', () => {
        window.location.reload();
    });

    reloadPromptTimeout = setTimeout(() => {
        promptDiv.remove();
    }, 15000); // Disappear after 15 seconds
}


// 3. EVENT HANDLING & UI
// -----------------------------------------------------------------------------

async function showRegexGenerationPromptEditor() {
    if (!isAppReady) {
        window.toastr.info('SillyTavern is still loading, please wait.');
        return;
    }

    const settings = extension_settings[EXTENSION_NAME];
    const popupContent = document.createElement('div');
    const instructions = settings.regexGenerationInstructions || DEFAULT_REGEX_GENERATION_INSTRUCTIONS;
    popupContent.innerHTML = `
        <small style="display:block; margin-bottom:5px;">
            This prompt generates replacement rules. Keep the JSON contract and semantic-safety requirements intact.
            Use <code>{{CANDIDATES}}</code> to choose where candidate phrases are inserted; otherwise they are appended.
        </small>
        <textarea id="pp_regex_instructions_editor" class="text_pole" rows="20" style="width:100%; resize:vertical;"></textarea>
        <br>
        <button id="pp_reset_regex_instructions_btn" class="menu_button is_dangerous">Reset to Default</button>
    `;

    const textarea = popupContent.querySelector('#pp_regex_instructions_editor');
    textarea.value = instructions;
    popupContent.querySelector('#pp_reset_regex_instructions_btn').addEventListener('pointerup', () => {
        textarea.value = DEFAULT_REGEX_GENERATION_INSTRUCTIONS;
        window.toastr.info('Instructions reset to default. Click "Save" to apply.');
    });

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, 'Edit Regex Generation Instructions', { wide: true, large: true })) {
        const newInstructions = textarea.value;
        settings.regexGenerationInstructions = newInstructions.trim() === DEFAULT_REGEX_GENERATION_INSTRUCTIONS.trim()
            ? ''
            : newInstructions;
        saveSettingsDebounced();
        window.toastr.success('Regex generation instructions saved.');
    }
}

function analyzeLatestAiMessage() {
    if (!prosePolisherAnalyzer) {
        return;
    }

    // 1. Get all rendered message elements from the DOM.
    const allMessageElements = document.querySelectorAll('#chat .mes');
    if (allMessageElements.length < 2) {
        // Not enough messages to have an AI response to a user message.
        return;
    }

    // 2. The second-to-last element is the most recent AI response.
    const lastAiMessageElement = allMessageElements[allMessageElements.length - 2];

    // 3. Perform robust checks on the DOM element itself.
    if (!lastAiMessageElement || lastAiMessageElement.getAttribute('is_user') === 'true') {
        // This isn't an AI message, so we stop.
        return;
    }

    // 4. Get the ID from the `mesid` attribute, which is reliable.
    const messageId = lastAiMessageElement.getAttribute('mesid');
    if (!messageId) {
        // This is the true "lacks an ID" case.
        console.warn(`${LOG_PREFIX} Last AI message element found, but it lacks a 'mesid' attribute. Skipping analysis.`);
        return;
    }

    // 5. Check if we've already processed this ID.
    if (processedMessageIds.has(messageId)) {
        return;
    }

    // 6. Get the text to analyze.
    const messageTextElement = lastAiMessageElement.querySelector('.mes_text');
    if (!messageTextElement || !messageTextElement.textContent.trim()) {
        // No text content to analyze.
        return;
    }
    const messageText = messageTextElement.textContent;

    // --- All checks passed, proceed with analysis ---
    console.log(`${LOG_PREFIX} Analyzing previous AI message (ID: ${messageId}).`);
    processedMessageIds.add(messageId);

    prosePolisherAnalyzer.incrementProcessedMessages();
    prosePolisherAnalyzer.analyzeAndTrackFrequency(messageText);

    if (extension_settings[EXTENSION_NAME].isDynamicEnabled) {
        prosePolisherAnalyzer.messageCounterForTrigger++;
        console.log(`${LOG_PREFIX} Dynamic trigger counter incremented to: ${prosePolisherAnalyzer.messageCounterForTrigger}`);
    }

    if (prosePolisherAnalyzer.totalAiMessagesProcessed % (extension_settings[EXTENSION_NAME].leaderboardUpdateCycle || 10) === 0) {
        prosePolisherAnalyzer.pruneOldNgrams();
        prosePolisherAnalyzer.performIntermediateAnalysis();
        console.log(`${LOG_PREFIX} Performed periodic data processing and leaderboard update.`);
    }
}

// This new function encapsulates the logic for triggering and running the AI rule generation.
async function triggerDynamicRuleGenerationIfNeeded() {
    if (!prosePolisherAnalyzer || prosePolisherAnalyzer.isProcessingAiRules || !extension_settings[EXTENSION_NAME].isDynamicEnabled) {
        return;
    }

    const triggerCount = extension_settings[EXTENSION_NAME].dynamicTriggerCount;
    const settings = extension_settings[EXTENSION_NAME];

    if (prosePolisherAnalyzer.slopCandidates.size > 0 && prosePolisherAnalyzer.messageCounterForTrigger >= triggerCount) {
        console.log(`${LOG_PREFIX} Dynamic rule generation triggered.`);
        prosePolisherAnalyzer.messageCounterForTrigger = 0;

        const getCandidateData = (lemmatizedKey) => {
            if (!lemmatizedKey) return null;
            const data = prosePolisherAnalyzer.ngramFrequencies.get(lemmatizedKey);
            return data ? { candidate: data.original, enhanced_context: data.contextSentence } : null;
        };

        const slopCandidateData = Array.from(prosePolisherAnalyzer.slopCandidates)
            .map(getCandidateData)
            .filter(Boolean);

        const candidatesForAutoTrigger = slopCandidateData.slice(0, 50); // Candidate review limit

        if (candidatesForAutoTrigger.length === 0) {
            return;
        }

        let validCandidatesForGeneration = [];
        try {
            if (settings.skipTriageCheck) {
                console.log(`${LOG_PREFIX} [Auto Gen] Skip Triage is enabled. Using raw context.`);
                validCandidatesForGeneration = candidatesForAutoTrigger;
            } else {
                window.toastr.info(`Prose Polisher: Reviewing ${candidatesForAutoTrigger.length} candidates...`, 'Prose Polisher');
                validCandidatesForGeneration = await prosePolisherAnalyzer.reviewSlopCandidates(candidatesForAutoTrigger);
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Error in auto-trigger pre-screening chain:`, error);
            window.toastr.error("Error during auto-trigger pre-screening. See console.");
            return; 
        }

        if (validCandidatesForGeneration.length === 0) {
            window.toastr.info('Prose Polisher: Candidate review found no safe rules to generate.', 'Prose Polisher');
            return;
        }

        const BATCH_SIZE = 15;
        const batchToProcess = validCandidatesForGeneration.slice(0, BATCH_SIZE);
        prosePolisherAnalyzer.isProcessingAiRules = true;
        let newRulesCount = 0;

        try {
            window.toastr.info(
                `Prose Polisher: Generating rules for ${batchToProcess.length} ${settings.skipTriageCheck ? 'candidates' : 'reviewed candidates'} using the current connection...`,
                'Prose Polisher',
            );
            newRulesCount = await prosePolisherAnalyzer.generateAndSaveDynamicRules(
                batchToProcess,
                dynamicRules,
            );
        } catch (error) {
            console.error(`${LOG_PREFIX} Error during auto-triggered rule generation:`, error);
            window.toastr.error("An error occurred during auto rule generation. See console.");
        } finally {
            prosePolisherAnalyzer.isProcessingAiRules = false;
        }

        if (newRulesCount > 0) {
            batchToProcess.forEach(processedCandidate => {
                let keyToDelete = null;
                for (const [lemmatizedKey, data] of prosePolisherAnalyzer.ngramFrequencies.entries()) {
                    if (data.original === processedCandidate.candidate) {
                        keyToDelete = lemmatizedKey;
                        break;
                    }
                }
                if (keyToDelete) {
                    prosePolisherAnalyzer.slopCandidates.delete(keyToDelete);
                    if (prosePolisherAnalyzer.ngramFrequencies.has(keyToDelete)) {
                        prosePolisherAnalyzer.ngramFrequencies.get(keyToDelete).score = 0;
                    }
                }
            });
            if (regexNavigator) regexNavigator.renderRuleList();
        }
    }
}

// RegexNavigator class
class RegexNavigator {
    constructor() {}
    async open() {
        if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
        dynamicRules.forEach(rule => delete rule.isNew);
        const container = document.createElement('div');
        container.className = 'prose-polisher-navigator-content';
        container.id = 'prose-polisher-navigator-content-id';
        container.innerHTML = `
            <div class="modal-header"><h2>Regex Rule Navigator</h2></div>
            <div class="navigator-body"><div class="navigator-main-panel"><div id="regex-navigator-list-view"></div></div></div>
            <div class="modal-footer"><button id="prose-polisher-new-rule-btn" class="menu_button"><i class="fa-solid fa-plus"></i> New Dynamic Rule</button></div>`;
        this.renderRuleList(container);
        container.querySelector('#prose-polisher-new-rule-btn').addEventListener('pointerup', () => this.openRuleEditor(null));
        callGenericPopup(container, POPUP_TYPE.DISPLAY, 'Regex Rule Navigator', { wide: true, large: true, addCloseButton: true });
    }
    renderRuleList(container = null) {
        if (!isAppReady) return;
        const modalContent = container || document.getElementById('prose-polisher-navigator-content-id');
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
            const ruleId = rule.id || (rule.scriptName ? PROSE_POLISHER_ID_PREFIX + rule.scriptName.replace(/\s+/g, '_') : PROSE_POLISHER_ID_PREFIX + `rule_${Date.now()}`);
            item.dataset.id = ruleId;
            if (!rule.id) rule.id = ruleId; 
            const iconWrap = document.createElement('div');
            iconWrap.className = 'item-icon';
            const icon = document.createElement('i');
            icon.className = `fa-solid ${rule.isStatic ? 'fa-database' : 'fa-wand-magic-sparkles'}`;
            iconWrap.appendChild(icon);

            const details = document.createElement('div');
            details.className = 'item-details';
            const name = document.createElement('div');
            name.className = 'script-name';
            name.textContent = rule.scriptName || '(No Name)';
            const regex = document.createElement('div');
            regex.className = 'find-regex';
            regex.textContent = rule.findRegex || '';
            details.append(name, regex);

            if (rule.semanticInvariant) {
                const invariant = document.createElement('div');
                invariant.className = 'pp-rule-invariant';
                invariant.textContent = rule.semanticInvariant;
                details.appendChild(invariant);
            }

            const status = document.createElement('div');
            status.className = 'item-status';
            const type = document.createElement('span');
            type.textContent = rule.isStatic ? 'Static' : 'Dynamic';
            status.appendChild(type);
            if (rule.risk) {
                const risk = document.createElement('span');
                risk.className = `pp-rule-risk risk-${rule.risk}`;
                risk.textContent = `${rule.risk} risk`;
                status.appendChild(risk);
            }
            const toggle = document.createElement('i');
            toggle.className = `fa-solid ${rule.disabled ? 'fa-toggle-off' : 'fa-toggle-on'} status-toggle-icon`;
            toggle.title = 'Toggle Enable/Disable';
            status.appendChild(toggle);
            item.append(iconWrap, details, status);
            item.addEventListener('pointerup', (e) => {
                const currentRuleId = item.dataset.id;
                if (e.target.closest('.status-toggle-icon')) { this.toggleRuleStatus(currentRuleId); }
                else { this.openRuleEditor(currentRuleId); }
            });
            listView.appendChild(item);
        }
    }
    async toggleRuleStatus(ruleId) {
        if (!isAppReady) { console.warn(`${LOG_PREFIX} toggleRuleStatus called before app ready.`); return; }
        let rule = dynamicRules.find(r => r.id === ruleId);
        if (!rule) rule = staticRules.find(r => r.id === ruleId);
        if (rule) {
            rule.disabled = !rule.disabled;
            if (!rule.isStatic) {
                extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules; 
                saveSettingsDebounced(); 
            }
            this.renderRuleList(); 
            await updateGlobalRegexArray();
            window.toastr.success(`Rule "${rule.scriptName}" ${rule.disabled ? 'disabled' : 'enabled'}.`);
        } else {
            console.warn(`${LOG_PREFIX} Rule with ID ${ruleId} not found for toggling.`);
        }
    }
    async openRuleEditor(ruleId) {
        if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
        const isNew = ruleId === null;
        let rule;
        if (isNew) {
            rule = { id: `DYN_${Date.now()}_${Math.random().toString(36).substr(2,5)}`, scriptName: '', findRegex: '', alternatives: [], replaceString: '', disabled: true, isStatic: false, isNew: true };
        } else {
            rule = dynamicRules.find(r => r.id === ruleId) || staticRules.find(r => r.id === ruleId);
        }
        if (!rule) { console.error(`${LOG_PREFIX} Rule not found for editing: ${ruleId}`); return; }
        const editorContent = document.createElement('div');
        editorContent.className = 'prose-polisher-rule-editor-popup';
        editorContent.dataset.ruleId = rule.id;
        editorContent.innerHTML = `
            <label for="pp_editor_name">Rule Name</label>
            <input type="text" id="pp_editor_name" class="text_pole" ${rule.isStatic ? 'disabled' : ''}>
            <label for="pp_editor_find">Find Regex (JavaScript format)</label>
            <textarea id="pp_editor_find" class="text_pole" ${rule.isStatic ? 'disabled' : ''}></textarea>
            <label for="pp_editor_alternatives">Replacement alternatives (one per line)</label>
            <textarea id="pp_editor_alternatives" class="text_pole" ${rule.isStatic ? 'disabled' : ''}></textarea>
            <button id="pp_editor_preview" class="menu_button" type="button">Preview Against Current Chat</button>
            <div id="pp_editor_validation" class="pp-rule-validation" aria-live="polite"></div>
            <div id="pp_editor_preview_results" class="pp-rule-preview-results"></div>
            <div class="editor-actions">
                <div class="actions-left"><label class="checkbox_label"><input type="checkbox" id="pp_editor_disabled" ${rule.disabled ? 'checked' : ''}><span>Disabled</span></label></div>
                ${!rule.isStatic ? '<button id="pp_editor_delete" class="menu_button is_dangerous">Delete Rule</button>' : ''}
            </div>`;
        const nameInput = editorContent.querySelector('#pp_editor_name');
        const findInput = editorContent.querySelector('#pp_editor_find');
        const alternativesInput = editorContent.querySelector('#pp_editor_alternatives');
        nameInput.value = rule.scriptName || '';
        findInput.value = rule.findRegex || '';
        alternativesInput.value = parseAlternatives(rule).join('\n');

        editorContent.querySelector('#pp_editor_preview').addEventListener('pointerup', () => {
            const candidate = normalizeRule({
                scriptName: nameInput.value,
                findRegex: findInput.value,
                alternatives: alternativesInput.value.split('\n').map(value => value.trim()).filter(Boolean),
            });
            const chatText = (getContext().chat || [])
                .filter(message => !message.is_user)
                .map(message => message.mes || '')
                .join('\n\n');
            const preview = previewRule(chatText, candidate);
            const validationElement = editorContent.querySelector('#pp_editor_validation');
            const resultsElement = editorContent.querySelector('#pp_editor_preview_results');
            validationElement.textContent = preview.valid
                ? `${preview.examples.length} example match${preview.examples.length === 1 ? '' : 'es'} found.`
                : preview.errors.join(' ');
            validationElement.classList.toggle('is-valid', preview.valid);
            validationElement.classList.toggle('is-invalid', !preview.valid);
            resultsElement.replaceChildren();
            for (const example of preview.examples) {
                const card = document.createElement('div');
                card.className = 'pp-rule-preview-card';
                const before = document.createElement('div');
                const after = document.createElement('div');
                before.textContent = `Before: ${example.before}`;
                after.textContent = `After: ${example.after}`;
                card.append(before, after);
                resultsElement.appendChild(card);
            }
        });
        const deleteBtn = editorContent.querySelector('#pp_editor_delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('pointerup', async (e) => {
                e.stopPropagation();
                const editorPopup = deleteBtn.closest('.popup_confirm');
                if (await callGenericPopup('Are you sure you want to to delete this rule?', POPUP_TYPE.CONFIRM)) {
                    await this.handleDelete(rule.id);
                    editorPopup?.querySelector('.popup-button-cancel')?.click();
                }
            });
        }
        if (await callGenericPopup(editorContent, POPUP_TYPE.CONFIRM, isNew ? 'Create New Rule' : 'Edit Rule', { wide: true, large: true })) {
            const disabledInput = editorContent.querySelector('#pp_editor_disabled');
            rule.disabled = disabledInput.checked;
            if (!rule.isStatic) {
                if (!nameInput.value.trim() || !findInput.value.trim()) { window.toastr.error("Rule Name and Find Regex cannot be empty."); this.openRuleEditor(rule.id); return; }
                const normalized = normalizeRule({
                    ...rule,
                    scriptName: nameInput.value.trim(),
                    findRegex: findInput.value.trim(),
                    alternatives: alternativesInput.value.split('\n').map(value => value.trim()).filter(Boolean),
                });
                const validation = validateRule(normalized);
                if (!validation.valid) {
                    window.toastr.error(validation.errors.join(' '));
                    this.openRuleEditor(rule.id);
                    return;
                }
                Object.assign(rule, normalized);
            }
            if (isNew && !rule.isStatic) dynamicRules.push(rule);
            
            if (!rule.isStatic) {
                 extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
                 saveSettingsDebounced();
            }
            this.renderRuleList();
            await updateGlobalRegexArray();
            window.toastr.success(isNew ? "New rule created." : "Rule updated.");
            showReloadPrompt();
        }
    }
    async handleDelete(ruleId) {
        if (!isAppReady) { console.warn(`${LOG_PREFIX} handleDelete called before app ready.`); return; }
        const index = dynamicRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            dynamicRules.splice(index, 1);
            extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
            saveSettingsDebounced();
            this.renderRuleList();
            await updateGlobalRegexArray();
            window.toastr.success("Dynamic rule deleted.");
            showReloadPrompt();
        } else {
            console.warn(`${LOG_PREFIX} Dynamic rule with ID ${ruleId} not found for deletion.`);
        }
    }
}

// APP_READY Management
async function runReadyQueue() {
    isAppReady = true;
    window.isAppReady = true; 
    console.log(`${LOG_PREFIX} APP_READY event received. Running queued tasks (${readyQueue.length}).`);
    while (readyQueue.length > 0) {
        const task = readyQueue.shift();
        try { await task(); } catch (error) { console.error(`${LOG_PREFIX} Error running queued task:`, error); }
    }
    console.log(`${LOG_PREFIX} Ready queue finished.`);
}

function queueReadyTask(task) {
    if (isAppReady) {
        task();
    } else {
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
        dynamicRules.forEach(rule => { if (!rule.id) rule.id = `DYN_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`; });
        const staticResponse = await fetch(`${EXTENSION_FOLDER_PATH}/regex_rules.json`);
        if (!staticResponse.ok) throw new Error("Failed to fetch regex_rules.json");
        staticRules = await staticResponse.json();
        staticRules.forEach(rule => { if (!rule.id) rule.id = (rule.scriptName ? PROSE_POLISHER_ID_PREFIX + rule.scriptName.replace(/\s+/g, '_') : PROSE_POLISHER_ID_PREFIX + `staticrule_${Math.random().toString(36).substr(2,5)}`) + '_static'; });

        const settingsHtml = await fetch(`${EXTENSION_FOLDER_PATH}/settings.html`).then(res => res.text());
        document.getElementById('extensions_settings').insertAdjacentHTML('beforeend', settingsHtml);

        prosePolisherAnalyzer = new Analyzer(
            settings, callGenericPopup, POPUP_TYPE, window.toastr, saveSettingsDebounced,
            compileInternalActiveRules, updateGlobalRegexArray, getCompiledRegexes() 
        );
        
        const staticToggle = document.getElementById('prose_polisher_enable_static');
        const dynamicToggle = document.getElementById('prose_polisher_enable_dynamic');
        const triggerInput = document.getElementById('prose_polisher_dynamic_trigger');
        const globalRegexToggle = document.getElementById('prose_polisher_enable_global_regex');
        staticToggle.checked = settings.isStaticEnabled;
        dynamicToggle.checked = settings.isDynamicEnabled;
        triggerInput.value = settings.dynamicTriggerCount;
        if (globalRegexToggle) { 
            globalRegexToggle.checked = settings.integrateWithGlobalRegex;
            globalRegexToggle.addEventListener('change', async () => { 
                settings.integrateWithGlobalRegex = globalRegexToggle.checked; 
                saveSettingsDebounced(); 
                await updateGlobalRegexArray(); 
                const regexListContainer = document.getElementById('saved_regex_scripts');
                if (regexListContainer) {
                    hideRulesInStandardUI();
                }
                showReloadPrompt();
            });
        }
        staticToggle.addEventListener('change', async () => { 
            settings.isStaticEnabled = staticToggle.checked; 
            saveSettingsDebounced(); 
            await updateGlobalRegexArray(); 
            showReloadPrompt();
        });
        dynamicToggle.addEventListener('change', async () => {
            settings.isDynamicEnabled = dynamicToggle.checked;
            if(!dynamicToggle.checked && prosePolisherAnalyzer) prosePolisherAnalyzer.messageCounterForTrigger = 0; 
            saveSettingsDebounced();
            await updateGlobalRegexArray();
            showReloadPrompt();
        });
        triggerInput.addEventListener('input', () => {
            const value = parseInt(triggerInput.value, 10);
            if (!isNaN(value) && value >= 1) { settings.dynamicTriggerCount = value; saveSettingsDebounced(); }
        });

        // Bind new analysis settings
        const slopThresholdInput = document.getElementById('prose_polisher_slop_threshold');
        const leaderboardUpdateCycleInput = document.getElementById('prose_polisher_leaderboard_update_cycle');
        const pruningCycleInput = document.getElementById('prose_polisher_pruning_cycle');
        const ngramMaxInput = document.getElementById('prose_polisher_ngram_max');
        const patternMinCommonInput = document.getElementById('prose_polisher_pattern_min_common');

        slopThresholdInput.value = settings.slopThreshold;
        leaderboardUpdateCycleInput.value = settings.leaderboardUpdateCycle;
        pruningCycleInput.value = settings.pruningCycle;
        ngramMaxInput.value = settings.ngramMax;
        patternMinCommonInput.value = settings.patternMinCommon;

        slopThresholdInput.addEventListener('input', () => {
            const value = parseFloat(slopThresholdInput.value);
            if (!isNaN(value) && value >= 1) { settings.slopThreshold = value; saveSettingsDebounced(); }
        });
        leaderboardUpdateCycleInput.addEventListener('input', () => {
            const value = parseInt(leaderboardUpdateCycleInput.value, 10);
            if (!isNaN(value) && value >= 1) { settings.leaderboardUpdateCycle = value; saveSettingsDebounced(); }
        });
        pruningCycleInput.addEventListener('input', () => {
            const value = parseInt(pruningCycleInput.value, 10);
            if (!isNaN(value) && value >= 5) { settings.pruningCycle = value; saveSettingsDebounced(); }
        });
        ngramMaxInput.addEventListener('input', () => {
            const value = parseInt(ngramMaxInput.value, 10);
            if (!isNaN(value) && value >= 3 && value <= 20) { settings.ngramMax = value; saveSettingsDebounced(); }
        });
        patternMinCommonInput.addEventListener('input', () => {
            const value = parseInt(patternMinCommonInput.value, 10);
            if (!isNaN(value) && value >= 2 && value <= 10) { settings.patternMinCommon = value; saveSettingsDebounced(); }
        });

        regexNavigator = new RegexNavigator();
        document.getElementById('prose_polisher_open_navigator_button').addEventListener('pointerup', () => regexNavigator.open());
        document.getElementById('prose_polisher_analyze_chat_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.manualAnalyzeChatHistory());
        document.getElementById('prose_polisher_view_frequency_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showFrequencyLeaderboard());
        document.getElementById('prose_polisher_generate_rules_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.handleGenerateRulesFromAnalysisClick(dynamicRules, regexNavigator));
        document.getElementById('prose_polisher_manage_whitelist_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showWhitelistManager());
        document.getElementById('prose_polisher_manage_blacklist_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showBlacklistManager());
        document.getElementById('prose_polisher_clear_frequency_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.clearFrequencyData());
        document.getElementById('prose_polisher_edit_regex_gen_prompt_button').addEventListener('pointerup', showRegexGenerationPromptEditor);

        const skipTriageCheck = document.getElementById('pp_skip_triage_check');
        if (skipTriageCheck) {
            skipTriageCheck.checked = settings.skipTriageCheck;
            skipTriageCheck.addEventListener('change', () => {
                settings.skipTriageCheck = skipTriageCheck.checked;
                saveSettingsDebounced();
            });
        }

        const autoActivateGeneratedRules = document.getElementById('pp_auto_activate_generated_rules');
        if (autoActivateGeneratedRules) {
            autoActivateGeneratedRules.checked = settings.autoActivateGeneratedRules;
            autoActivateGeneratedRules.addEventListener('change', () => {
                settings.autoActivateGeneratedRules = autoActivateGeneratedRules.checked;
                saveSettingsDebounced();
            });
        }


        queueReadyTask(async () => {
            // Legacy Gremlin settings remain untouched in extension_settings so
            // Nemo Orchestrator can perform its one-time migration.
            eventSource.makeLast(event_types.USER_MESSAGE_RENDERED, async () => {
                analyzeLatestAiMessage();
                await triggerDynamicRuleGenerationIfNeeded();
            });
            eventSource.on(event_types.CHAT_CHANGED, () => {
                processedMessageIds.clear();
                console.log(`${LOG_PREFIX} Chat changed, cleared processed message ID cache.`);
            });

            await updateGlobalRegexArray();
            compileInternalActiveRules(); 

            // More robustly find and hide the ProsePolisher rules from the main regex UI.
            // This observes the body for when the regex list is added to the DOM,
            // then attaches a more specific observer to the list itself.
            const bodyObserver = new MutationObserver((mutationsList, observer) => {
                const regexListContainer = document.getElementById('saved_regex_scripts');
                if (regexListContainer) {
                    const listObserver = new MutationObserver(hideRulesInStandardUI);
                    listObserver.observe(regexListContainer, { childList: true, subtree: true });
                    hideRulesInStandardUI(); // Run once immediately
                    observer.disconnect(); // Stop observing the body
                }
            });
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        });
    } catch (error) {
        console.error(`${LOG_PREFIX} Critical failure during core initialization:`, error);
        window.toastr.error("Prose Polisher failed to initialize core components. See console.");
    }
}

$(document).ready(() => {
    console.log(`${LOG_PREFIX} Document ready. Starting initialization...`);
    eventSource.on(event_types.APP_READY, runReadyQueue); 
    setTimeout(initializeExtensionCore, 100); 
});

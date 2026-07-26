import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

// Local module imports
import { Analyzer } from './analyzer.js';
import { RuleNavigator } from './rule-navigator.js';
import { bindSettingsUi, normalizeSettings } from './settings.js';
import { DEFAULT_RULE_GENERATION_PROMPT } from './prompts.js';
import {
    PROSE_POLISHER_RULE_PREFIX,
    syncGlobalRegexRules,
} from './global-regex.js';

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
export const EXTENSION_NAME = 'ProsePolisher';
const LOG_PREFIX = `[${EXTENSION_NAME}]`;
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROSE_POLISHER_ID_PREFIX = PROSE_POLISHER_RULE_PREFIX;
const NON_PROSE_MESSAGE_TYPES = new Set([
    'command',
    'extension',
    'function',
    'image',
    'image_generation',
    'quiet',
    'system',
    'tool',
]);

// --- State Variables ---
let staticRules = [];
let dynamicRules = [];
let regexNavigator;
let prosePolisherAnalyzer = null;
let processedMessageIds = new Set();

let isAppReady = false;
let readyQueue = [];

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
}

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
    const instructions = settings.regexGenerationInstructions || DEFAULT_RULE_GENERATION_PROMPT;
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
        textarea.value = DEFAULT_RULE_GENERATION_PROMPT;
        window.toastr.info('Instructions reset to default. Click "Save" to apply.');
    });

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, 'Edit Regex Generation Instructions', { wide: true, large: true })) {
        const newInstructions = textarea.value;
        settings.regexGenerationInstructions = newInstructions.trim() === DEFAULT_RULE_GENERATION_PROMPT.trim()
            ? ''
            : newInstructions;
        saveSettingsDebounced();
        window.toastr.success('Regex generation instructions saved.');
    }
}

function normalizeMessageType(message) {
    const candidates = [
        message?.extra?.generationType,
        message?.extra?.generation_type,
        message?.extra?.type,
        message?.generationType,
        message?.type,
    ];
    const type = candidates.find(value => typeof value === 'string' && value.trim());
    return type?.trim().toLowerCase() ?? '';
}

function isNonProseAssistantMessage(message) {
    if (!message || message.is_user || message.is_system) return true;

    const messageType = normalizeMessageType(message);
    if (NON_PROSE_MESSAGE_TYPES.has(messageType)) return true;
    if (messageType.includes('image') || messageType.includes('tool') || messageType.includes('function')) return true;

    const extra = message.extra ?? {};
    if (extra.is_image || extra.image || extra.image_url || extra.tool_call || extra.tool_calls || extra.function_call) return true;

    return false;
}

function prepareTextForAnalysis(rawText) {
    if (typeof rawText !== 'string') return '';

    return rawText
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/!\[[^\]]*]\((?:[^)(]+|\([^)]*\))*\)/g, ' ')
        .replace(/\[[^\]]*]\(data:image\/[^)]+\)/gi, ' ')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function analyzeLatestAiMessage() {
    if (!prosePolisherAnalyzer) return;

    const context = getContext();
    const chat = context?.chat ?? [];
    if (chat.length < 2) return;

    // USER_MESSAGE_RENDERED fires after the new user message is appended, so the
    // immediately preceding chat entry is the assistant reply we want to inspect.
    const assistantIndex = chat.length - 2;
    const assistantMessage = chat[assistantIndex];
    if (isNonProseAssistantMessage(assistantMessage)) return;

    const messageId = String(
        assistantMessage.send_date
        ?? assistantMessage.extra?.id
        ?? assistantMessage.extra?.messageId
        ?? assistantIndex,
    );
    if (processedMessageIds.has(messageId)) return;

    const messageText = prepareTextForAnalysis(assistantMessage.mes ?? '');
    if (!messageText) return;

    console.log(`${LOG_PREFIX} Analyzing raw assistant prose (ID: ${messageId}).`);
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
            return data
                ? {
                    candidate: data.original,
                    enhanced_context: (data.contexts || [data.contextSentence]).filter(Boolean),
                }
                : null;
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
            window.toastr.error('Error during auto-trigger pre-screening. See console.');
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
            window.toastr.error('An error occurred during auto rule generation. See console.');
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
        extension_settings[EXTENSION_NAME] = normalizeSettings(extension_settings[EXTENSION_NAME]);
        const settings = extension_settings[EXTENSION_NAME];
        dynamicRules = settings.dynamicRules || [];
        settings.dynamicRules = dynamicRules;
        dynamicRules.forEach(rule => { if (!rule.id) rule.id = `DYN_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`; });
        const staticResponse = await fetch(`${EXTENSION_FOLDER_PATH}/regex_rules.json`);
        if (!staticResponse.ok) throw new Error('Failed to fetch regex_rules.json');
        staticRules = await staticResponse.json();
        staticRules.forEach(rule => { if (!rule.id) rule.id = (rule.scriptName ? PROSE_POLISHER_ID_PREFIX + rule.scriptName.replace(/\s+/g, '_') : PROSE_POLISHER_ID_PREFIX + `staticrule_${Math.random().toString(36).substr(2, 5)}`) + '_static'; });

        const settingsHtml = await fetch(`${EXTENSION_FOLDER_PATH}/settings.html`).then(res => res.text());
        document.getElementById('extensions_settings').insertAdjacentHTML('beforeend', settingsHtml);

        prosePolisherAnalyzer = new Analyzer(
            settings, callGenericPopup, POPUP_TYPE, window.toastr, saveSettingsDebounced,
            compileInternalActiveRules, updateGlobalRegexArray, getCompiledRegexes(),
        );

        regexNavigator = new RuleNavigator({
            callPopup: callGenericPopup,
            popupType: POPUP_TYPE,
            toastr: window.toastr,
            isReady: () => isAppReady,
            getChat: () => getContext().chat,
            getStaticRules: () => staticRules,
            getDynamicRules: () => dynamicRules,
            persistDynamicRules: () => {
                settings.dynamicRules = dynamicRules;
                saveSettingsDebounced();
            },
            updateGlobalRegex: updateGlobalRegexArray,
            showReloadPrompt,
            ruleIdPrefix: PROSE_POLISHER_ID_PREFIX,
        });
        bindSettingsUi({
            settings,
            analyzer: prosePolisherAnalyzer,
            navigator: regexNavigator,
            saveSettings: saveSettingsDebounced,
            updateGlobalRegex: updateGlobalRegexArray,
            hideGlobalRules: hideRulesInStandardUI,
            showReloadPrompt,
            showPromptEditor: showRegexGenerationPromptEditor,
        });

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
        window.toastr.error('Prose Polisher failed to initialize core components. See console.');
    }
}

$(document).ready(() => {
    console.log(`${LOG_PREFIX} Document ready. Starting initialization...`);
    eventSource.on(event_types.APP_READY, runReadyQueue);
    setTimeout(initializeExtensionCore, 100);
});
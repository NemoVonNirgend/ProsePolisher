// C:\SillyTavern\public\scripts\extensions\third-party\ProsePolisher\content.js
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { openai_setting_names } from '../../../../scripts/openai.js';

// Local module imports
import { PresetNavigator, injectNavigatorModal } from './navigator.js';
import { runGremlinPlanningPipeline, applyGremlinEnvironment, executeGen } from './projectgremlin.js';
import { Analyzer } from './analyzer.js';
// commonWords and defaultNames are imported by analyzer.js, no need here directly

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
export const EXTENSION_NAME = "ProsePolisher";
const LOG_PREFIX = `[${EXTENSION_NAME}]`;
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROSE_POLISHER_ID_PREFIX = '_prosePolisherRule_';
const PRUNE_CHECK_INTERVAL = 10; // For Analyzer, used in onAiCharacterMessageRendered

// --- State Variables ---
let staticRules = [];
let dynamicRules = []; // For Prose Polisher Regex
let regexNavigator; // For Prose Polisher Regex Navigator
let prosePolisherAnalyzer = null; // Instance of the Analyzer class

// Gremlin-specific state variables
let isPipelineRunning = false;
let isAppReady = false;
let readyQueue = [];


// SUGGESTED_MODELS
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
    whitelist: [],
    blacklist: [],
    integrateWithGlobalRegex: true,

    projectGremlinEnabled: false,
    gremlinPapaEnabled: true,
    gremlinTwinsEnabled: true,
    gremlinMamaEnabled: true,
    gremlinTwinsIterations: 3, // Default to 3 iterations (6 total calls for Vex/Vax)
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

// 2. HELPER FUNCTIONS (Prose Polisher - UI & Rule Management)
// -----------------------------------------------------------------------------

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


function isPhraseHandledByAnyActiveRule(phrase) {
    const settings = extension_settings[EXTENSION_NAME];
    const rulesToCheck = [];
    if (settings.isStaticEnabled) rulesToCheck.push(...staticRules.filter(r => !r.disabled));
    if (settings.isDynamicEnabled) rulesToCheck.push(...dynamicRules.filter(r => !r.disabled));

    for (const rule of rulesToCheck) {
        try {
            const regex = new RegExp(rule.findRegex, 'i');
            if (regex.test(phrase)) return true;
        } catch (e) { /* ignore invalid regex */ }
    }
    return false;
}

function applyProsePolisherReplacements(text) {
    if (!text) return text;
    let replacedText = text;
    const rulesToApply = [];
    const settings = extension_settings[EXTENSION_NAME];

    if (settings.isStaticEnabled) {
        rulesToApply.push(...staticRules.filter(r => !r.disabled));
    }
    if (settings.isDynamicEnabled) {
        rulesToApply.push(...dynamicRules.filter(r => !r.disabled));
    }

    rulesToApply.forEach(rule => {
        try {
            const regex = new RegExp(rule.findRegex, 'gi');
            if (rule.replaceString.includes('{{random:')) {
                const optionsMatch = rule.replaceString.match(/\{\{random:([\s\S]+?)\}\}/);
                if (optionsMatch && optionsMatch[1]) {
                    const options = optionsMatch[1].split(',');
                    replacedText = replacedText.replace(regex, (match, ...args) => {
                        const chosenOption = options[Math.floor(Math.random() * options.length)].trim();
                        return chosenOption.replace(/\$(\d)/g, (_, groupIndex) => args[parseInt(groupIndex) - 1] || '');
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


async function updateGlobalRegexArray() {
    const settings = extension_settings[EXTENSION_NAME];
    if (!isAppReady) {
        console.warn(`${LOG_PREFIX} updateGlobalRegexArray called before app ready. Skipping.`);
        return;
    }

    if (!extension_settings.regex) extension_settings.regex = [];
    extension_settings.regex = extension_settings.regex.filter(rule => !rule.id?.startsWith(PROSE_POLISHER_ID_PREFIX));

    if (!settings.integrateWithGlobalRegex) {
        console.log(`${LOG_PREFIX} Global regex integration is OFF. ProsePolisher rules removed from global list.`);
        saveSettingsDebounced();
        return;
    }

    const rulesToAdd = [];
    if (settings.isStaticEnabled) rulesToAdd.push(...staticRules);
    if (settings.isDynamicEnabled) rulesToAdd.push(...dynamicRules);
    const activeRulesForGlobal = rulesToAdd.filter(rule => !rule.disabled);

    for (const rule of activeRulesForGlobal) {
        const globalRule = {
            id: `${PROSE_POLISHER_ID_PREFIX}${rule.id || rule.scriptName.replace(/\s+/g, '_')}`,
            scriptName: `(PP) ${rule.scriptName}`,
            findRegex: rule.findRegex,
            replaceString: rule.replaceString,
            disabled: rule.disabled,
            substituteRegex: 0, minDepth: null, maxDepth: null, trimStrings: [],
            placement: [2], runOnEdit: false, is_always_applied_to_display: true, is_always_applied_to_prompt: true,
        };
        extension_settings.regex.push(globalRule);
    }
    console.log(`${LOG_PREFIX} Updated global regex array. ProsePolisher rules active in global list: ${activeRulesForGlobal.length}.`);
    saveSettingsDebounced();
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


// 3. EVENT HANDLING & UI (Project Gremlin part)
// -----------------------------------------------------------------------------
async function showApiEditorPopup(gremlinRole) {
    if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
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
        item.addEventListener('pointerup', () => {
            popupContent.querySelector('#pp_custom_api').value = item.dataset.api;
            popupContent.querySelector('#pp_custom_model').value = item.dataset.model;
            popupContent.querySelector('#pp_custom_source').value = item.dataset.source || '';
            popupContent.querySelectorAll('.pp-suggestion-item').forEach(i => i.style.fontWeight = 'normal');
            item.style.fontWeight = 'bold';
        });
    });
    popupContent.querySelector('#pp-unbind-btn').addEventListener('pointerup', () => {
         popupContent.querySelector('#pp_custom_api').value = '';
         popupContent.querySelector('#pp_custom_model').value = '';
         popupContent.querySelector('#pp_custom_source').value = '';
         window.toastr.info('Cleared inputs. Click "Save" to apply.');
    });

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, `Set API/Model for ${roleUpper}`)) {
        settings[`gremlin${roleUpper}Api`] = popupContent.querySelector('#pp_custom_api').value.trim();
        settings[`gremlin${roleUpper}Model`] = popupContent.querySelector('#pp_custom_model').value.trim();
        settings[`gremlin${roleUpper}Source`] = popupContent.querySelector('#pp_custom_source').value.trim();
        saveSettingsDebounced();
        updateGremlinApiDisplay(gremlinRole);
        window.toastr.info(`API/Model settings saved for ${roleUpper}.`);
    }
}

function updateGremlinApiDisplay(role) {
    if (!isAppReady) return;
    const settings = extension_settings[EXTENSION_NAME];
    const roleUpper = role.charAt(0).toUpperCase() + role.slice(1);
    const displayElement = document.getElementById(`pp_gremlin${roleUpper}Display`);
    if (displayElement) {
        const api = settings[`gremlin${roleUpper}Api`] || 'None';
        const model = settings[`gremlin${roleUpper}Model`] || 'Not Set';
        displayElement.textContent = `${api} / ${model}`;
    }
}

function handleSentenceCapitalization(messageIdOrElement) {
    if (!isAppReady) { console.warn(`${LOG_PREFIX} handleSentenceCapitalization called before app ready.`); return; }
    let messageElement;
    if (typeof messageIdOrElement === 'string') {
        messageElement = document.querySelector(`#chat .mes[mesid="${messageIdOrElement}"]`);
    } else {
        messageElement = messageIdOrElement;
    }
    if (!messageElement) return;
    const messageTextElement = messageElement.querySelector('.mes_text');
    if (!messageTextElement) return;
    let textContent = messageTextElement.innerHTML;
    const originalHTML = textContent;
    textContent = textContent.replace(/^(\s*<[^>]*>)*([a-z])/s, (match, tags, letter) => `${tags || ''}${letter.toUpperCase()}`);
    textContent = textContent.replace(/([.!?])(\s*<[^>]*>)*\s+([a-z])/gs, (match, punc, tags, letter) => `${punc}${tags || ''} ${letter.toUpperCase()}`);
    if (textContent !== originalHTML) {
        console.log(`${LOG_PREFIX} Applying enhanced auto-capitalization to a rendered message.`);
        messageTextElement.innerHTML = textContent;
    }
}

// START OF PROJECT GREMLIN TRIGGER LOGIC (REVERTED AND UPDATED)
/**
 * Gatekeeper function for Gremlin pipeline.
 * Prevents main generation if pipeline is running its own /gen calls.
 */
async function onBeforeGremlinGeneration(type, generateArgsObject, dryRun) {
    if (!isAppReady) {
        // console.warn(`[ProjectGremlin] onBeforeGremlinGeneration called before app ready.`); // Can be noisy
        return;
    }
    if (isPipelineRunning) {
         console.log('[ProjectGremlin] Pipeline running, allowing internal /gen call by returning undefined from onBeforeGremlinGeneration.');
         return; // Return undefined (or nothing) to allow the internal /gen call to proceed.
    }
    // For all other cases, let SillyTavern handle them normally.
    return;
}

/**
 * Main entry point for the Gremlin pipeline.
 * Fires after the user's message has been added to context.chat and rendered.
 * @param {string} messageId - The ID of the rendered user message.
 */
async function onUserMessageRenderedForGremlin(messageId) { // messageId from the event
    if (!isAppReady) {
        console.warn(`[ProjectGremlin] onUserMessageRenderedForGremlin called before app ready for message ID ${messageId}.`);
        return;
    }

    const settings = extension_settings[EXTENSION_NAME];
    const context = getContext();

    console.log(`[ProjectGremlin] USER_MESSAGE_RENDERED_FOR_GREMLIN triggered for message ID: ${messageId} (type: ${typeof messageId})`);
    console.log(`[ProjectGremlin] Current chat length: ${context.chat?.length}`);
    console.log(`[ProjectGremlin] Project Gremlin Enabled: ${settings.projectGremlinEnabled}`);
    console.log(`[ProjectGremlin] isPipelineRunning flag: ${isPipelineRunning}`);

    // --- SIMPLIFIED CONDITIONS ---
    if (!settings.projectGremlinEnabled || isPipelineRunning) {
        console.log(`[ProjectGremlin] Pipeline start conditions FAILED for message ID ${messageId}. Aborting.`);
        if (!settings.projectGremlinEnabled) console.log(`  - Reason: Gremlin not enabled.`);
        if (isPipelineRunning) console.log(`  - Reason: Pipeline already running (internal call likely).`);
        return;
    }
    
    // Optional: You can still try to get the message for logging, but don't gate on it.
    const messageObject = context.chat?.find(msg => String(msg.id) === String(messageId));
    if (messageObject) {
        console.log(`[ProjectGremlin] Found message object in context: ID=${messageObject.id}, is_user=${messageObject.is_user}, name=${messageObject.name}`);
        if (!messageObject.is_user) {
            console.warn(`[ProjectGremlin] Warning: Message ${messageId} associated with USER_MESSAGE_RENDERED is not marked as user. Proceeding with pipeline anyway based on event timing.`);
        }
    } else {
        console.warn(`[ProjectGremlin] Warning: Message object with ID ${messageId} not found in context.chat when USER_MESSAGE_RENDERED fired. Proceeding with pipeline if other conditions met.`);
    }
    // --- END OF SIMPLIFIED CONDITIONS ---
    
    console.log(`[ProjectGremlin] All primary conditions PASSED for message ID ${messageId}. Starting pipeline...`);
    isPipelineRunning = true;

    try {
        const finalBlueprint = await runGremlinPlanningPipeline(); // Assumes user message is in chat for /gen
        if (!finalBlueprint) {
            throw new Error('Project Gremlin planning failed to produce a blueprint.');
        }

        let finalInjectedInstruction;
        if (settings.gremlinAuditorEnabled) {
            console.log('[ProjectGremlin] Auditor enabled. Running Writer step internally...');
            window.toastr.info("Gremlin Pipeline: Step 4 - Writer is crafting...", "Project Gremlin", { timeOut: 7000 });
            if (!await applyGremlinEnvironment('writer')) throw new Error("Failed to configure Writer environment for Auditor path.");
            const writerSystemInstruction = `[OOC: You are a master writer. Follow these instructions from your project lead precisely for your next response. Do not mention the blueprint or instructions in your reply. Your writing should be creative and engaging, bringing this plan to life. Do not write from the user's perspective. Write only the character's response.\n\n# INSTRUCTIONS\n${finalBlueprint}]`;
            const writerProse = await executeGen(writerSystemInstruction); 
            if (!writerProse.trim()) throw new Error("Internal Writer Gremlin step failed to produce a response.");
            console.log('[ProjectGremlin] Writer Gremlin\'s Prose (for Auditor):', writerProse.substring(0,100) + "...");

            console.log('[ProjectGremlin] Preparing final injection for Auditor.');
            window.toastr.info("Gremlin Pipeline: Handing off to Auditor...", "Project Gremlin", { timeOut: 4000 });
            if (!await applyGremlinEnvironment('auditor')) throw new Error("Failed to configure Auditor environment.");
            finalInjectedInstruction = `[OOC: You are a master line editor. Your task is to revise and polish the following text. Correct any grammatical errors, awkward phrasing, or typos. Eliminate repetitive words and sentence structures. Enhance the prose to be more evocative and impactful, while respecting the established character voice and tone. If the text is fundamentally flawed or completely fails to follow the narrative, rewrite it from scratch to be high quality. **CRUCIAL:** Your output must ONLY be the final, edited text. Do NOT include any commentary, explanations, or introductory phrases like "Here is the revised version:".\n\n# TEXT TO EDIT\n${writerProse}]`;
        } else {
            console.log('[ProjectGremlin] Auditor disabled. Preparing final instruction for Writer.');
            window.toastr.info("Gremlin Pipeline: Handing off to Writer...", "Project Gremlin", { timeOut: 4000 });
            if (!await applyGremlinEnvironment('writer')) throw new Error("Failed to configure Writer environment.");
            finalInjectedInstruction = `[OOC: You are a master writer. Follow these instructions from your project lead precisely for your next response. Do not mention the blueprint or instructions in your reply. Your writing should be creative and engaging, bringing this plan to life. Do not write from the user's perspective. Write only the character's response.\n\n# INSTRUCTIONS\n${finalBlueprint}]`;
        }

        window.toastr.success("Gremlin Pipeline: Blueprint complete! Prompt instruction prepared.", "Project Gremlin");
        const sanitizedInstruction = finalInjectedInstruction.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await context.executeSlashCommands(`/inject id=gremlin_final_plan position=chat depth=0 "${sanitizedInstruction}"`);
        console.log("[ProjectGremlin] Final instruction injected using 'position=chat'.");

    } catch (error) {
        console.error('[ProjectGremlin] A critical error occurred during the pipeline execution:', error);
        window.toastr.error(`Project Gremlin pipeline failed: ${error.message}. Generation may proceed without blueprint.`, "Project Gremlin Error");
    } finally {
        isPipelineRunning = false;
        if (context.reloadGenerationSettings) {
            context.reloadGenerationSettings();
            console.log("[ProjectGremlin] Main generation settings reloaded.");
        }
        console.log(`[ProjectGremlin] ---- USER_MESSAGE_RENDERED_FOR_GREMLIN END (Message ID: ${messageId}) ----`);
    }
}
// END OF PROJECT GREMLIN TRIGGER LOGIC


// Combined AI Message Handler (Prose Polisher regex/analyzer + Gremlin cleanup if needed)
function onAiCharacterMessageRendered(messageElement) {
    if (!isAppReady) {
        console.warn(`${LOG_PREFIX} onAiCharacterMessageRendered called too early. isAppReady: ${isAppReady}`);
        return;
    }
    const messageId = messageElement.getAttribute('mesid');
    const context = getContext();
    const message = context.chat.find(msg => msg.id === messageId);
    if (!message || message.is_user) return;

    let messageToAnalyze = message.mes;
    const originalMessageForRegex = messageToAnalyze;
    if (!extension_settings[EXTENSION_NAME].integrateWithGlobalRegex) {
        const replacedMessage = applyProsePolisherReplacements(originalMessageForRegex);
        if (replacedMessage !== originalMessageForRegex) {
            console.log(`${LOG_PREFIX} Applying internal Prose Polisher regex replacements.`);
            message.mes = replacedMessage;
            messageElement.querySelector('.mes_text').innerHTML = replacedMessage; 
            messageToAnalyze = replacedMessage;
        }
    }

    if (prosePolisherAnalyzer) {
        prosePolisherAnalyzer.incrementProcessedMessages();
        prosePolisherAnalyzer.analyzeAndTrackFrequency(messageToAnalyze);
        if (prosePolisherAnalyzer.totalAiMessagesProcessed % PRUNE_CHECK_INTERVAL === 0) {
            prosePolisherAnalyzer.pruneOldNgrams();
        }
        prosePolisherAnalyzer.checkDynamicRuleTrigger(dynamicRules, regexNavigator);
    }
    handleSentenceCapitalization(messageElement); 
}


// RegexNavigator class
class RegexNavigator {
    constructor() {}
    async open() {
        if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
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
        if (!isAppReady) return;
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
            const ruleId = rule.id || (rule.scriptName ? PROSE_POLISHER_ID_PREFIX + rule.scriptName.replace(/\s+/g, '_') : PROSE_POLISHER_ID_PREFIX + `rule_${Date.now()}`);
            item.dataset.id = ruleId;
            if (!rule.id) rule.id = ruleId; 
            item.innerHTML = `<div class="item-icon"><i class="fa-solid ${rule.isStatic ? 'fa-database' : 'fa-wand-magic-sparkles'}"></i></div><div class="item-details"><div class="script-name">${rule.scriptName || '(No Name)'}</div><div class="find-regex">${rule.findRegex}</div></div><div class="item-status">${rule.isStatic ? '<span>Static</span>' : '<span>Dynamic</span>'}<i class="fa-solid ${rule.disabled ? 'fa-toggle-off' : 'fa-toggle-on'} status-toggle-icon" title="Toggle Enable/Disable"></i></div>`;
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
            rule = { id: `DYN_${Date.now()}_${Math.random().toString(36).substr(2,5)}`, scriptName: '', findRegex: '', replaceString: '', disabled: false, isStatic: false, isNew: true };
        } else {
            rule = dynamicRules.find(r => r.id === ruleId) || staticRules.find(r => r.id === ruleId);
        }
        if (!rule) { console.error(`${LOG_PREFIX} Rule not found for editing: ${ruleId}`); return; }
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
                if (await callGenericPopup('Are you sure you want to delete this rule?', POPUP_TYPE.CONFIRM)) {
                    await this.handleDelete(rule.id);
                    const confirmPopup = deleteBtn.closest('.popup_confirm');
                    const editorPopup = confirmPopup?.previousElementSibling?.closest('.popup_confirm'); 
                    editorPopup?.querySelector('.popup-button-cancel')?.click(); 
                    confirmPopup?.querySelector('.popup-button-cancel')?.click(); 
                }
            });
        }
        if (await callGenericPopup(editorContent, POPUP_TYPE.CONFIRM, isNew ? 'Create New Rule' : 'Edit Rule', { wide: true, large: true })) {
            const nameInput = editorContent.querySelector('#pp_editor_name');
            const findInput = editorContent.querySelector('#pp_editor_find');
            const replaceInput = editorContent.querySelector('#pp_editor_replace');
            const disabledInput = editorContent.querySelector('#pp_editor_disabled');
            rule.disabled = disabledInput.checked;
            if (!rule.isStatic) {
                if (!nameInput.value.trim() || !findInput.value.trim()) { window.toastr.error("Rule Name and Find Regex cannot be empty."); this.openRuleEditor(rule.id); return; }
                try { new RegExp(findInput.value); } catch (e) { window.toastr.error(`Invalid Regex: ${e.message}`); this.openRuleEditor(rule.id); return; }
                rule.scriptName = nameInput.value;
                rule.findRegex = findInput.value;
                rule.replaceString = replaceInput.value;
            }
            if (isNew && !rule.isStatic) dynamicRules.push(rule);
            
            if (!rule.isStatic) {
                 extension_settings[EXTENSION_NAME].dynamicRules = dynamicRules;
                 saveSettingsDebounced();
            }
            this.renderRuleList();
            await updateGlobalRegexArray();
            window.toastr.success(isNew ? "New rule created." : "Rule updated.");
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
            compileInternalActiveRules, isPhraseHandledByAnyActiveRule, updateGlobalRegexArray 
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
            globalRegexToggle.addEventListener('change', async () => { settings.integrateWithGlobalRegex = globalRegexToggle.checked; saveSettingsDebounced(); await updateGlobalRegexArray(); });
        }
        staticToggle.addEventListener('change', async () => { settings.isStaticEnabled = staticToggle.checked; saveSettingsDebounced(); await updateGlobalRegexArray(); });
        dynamicToggle.addEventListener('change', async () => {
            settings.isDynamicEnabled = dynamicToggle.checked;
            if(!dynamicToggle.checked && prosePolisherAnalyzer) prosePolisherAnalyzer.messageCounterForTrigger = 0; 
            saveSettingsDebounced();
            await updateGlobalRegexArray();
        });
        triggerInput.addEventListener('input', () => {
            const value = parseInt(triggerInput.value, 10);
            if (!isNaN(value) && value >= 1) { settings.dynamicTriggerCount = value; saveSettingsDebounced(); }
        });

        regexNavigator = new RegexNavigator();
        document.getElementById('prose_polisher_open_navigator_button').addEventListener('pointerup', () => regexNavigator.open());
        document.getElementById('prose_polisher_analyze_chat_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.manualAnalyzeChatHistory());
        document.getElementById('prose_polisher_view_frequency_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showFrequencyLeaderboard());
        document.getElementById('prose_polisher_generate_rules_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.handleGenerateRulesFromAnalysisClick(dynamicRules, regexNavigator));
        document.getElementById('prose_polisher_manage_whitelist_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showWhitelistManager());
        document.getElementById('prose_polisher_manage_blacklist_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.showBlacklistManager());
        document.getElementById('prose_polisher_clear_frequency_button').addEventListener('pointerup', () => prosePolisherAnalyzer?.clearFrequencyData());

        let buttonContainer = document.getElementById('pp-chat-buttons-container');
        if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.id = 'pp-chat-buttons-container';
            const sendButtonHolder = document.getElementById('send_but_holder');
            const chatBar = document.getElementById('chat_bar');
            if (sendButtonHolder) sendButtonHolder.parentElement?.insertBefore(buttonContainer, sendButtonHolder.nextSibling);
            else if (chatBar) chatBar.appendChild(buttonContainer); 
            else document.querySelector('.mes_controls')?.appendChild(buttonContainer);
        }
        buttonContainer.insertAdjacentHTML('beforeend', `<button id="pp_gremlin_toggle" class="fa-solid fa-hat-wizard" title="Toggle Project Gremlin Pipeline"></button>`);
        const gremlinToggle = document.getElementById('pp_gremlin_toggle');
        const gremlinEnableCheckbox = document.getElementById('pp_projectGremlinEnabled');
        const updateGremlinToggleState = () => {
            if (!isAppReady) return;
            const enabled = settings.projectGremlinEnabled;
            gremlinToggle?.classList.toggle('active', enabled);
            if (gremlinEnableCheckbox) gremlinEnableCheckbox.checked = enabled;
        };
        const toggleGremlin = () => {
            if (!isAppReady) { window.toastr.warning("SillyTavern is not fully ready yet."); return; }
            settings.projectGremlinEnabled = !settings.projectGremlinEnabled;
            saveSettingsDebounced();
            updateGremlinToggleState();
            window.toastr.info(`Project Gremlin ${settings.projectGremlinEnabled ? 'enabled' : 'disabled'} for next message.`);
        };
        gremlinToggle?.addEventListener('pointerup', toggleGremlin);
        gremlinEnableCheckbox?.addEventListener('change', (e) => {
            if (settings.projectGremlinEnabled !== e.target.checked) {
                 settings.projectGremlinEnabled = e.target.checked;
                 saveSettingsDebounced();
                 updateGremlinToggleState();
            }
        });
        document.getElementById('pp_gremlinPapaEnabled').checked = settings.gremlinPapaEnabled;
        document.getElementById('pp_gremlinTwinsEnabled').checked = settings.gremlinTwinsEnabled;
        const twinsIterationsSelect = document.getElementById('pp_gremlinTwinsIterations');
        if (twinsIterationsSelect) {
            twinsIterationsSelect.value = settings.gremlinTwinsIterations || 3;
            twinsIterationsSelect.addEventListener('change', (e) => {
                settings.gremlinTwinsIterations = parseInt(e.target.value, 10);
                saveSettingsDebounced();
            });
        }
        document.getElementById('pp_gremlinMamaEnabled').checked = settings.gremlinMamaEnabled;
        document.getElementById('pp_gremlinAuditorEnabled').checked = settings.gremlinAuditorEnabled;

        document.getElementById('pp_gremlinPapaEnabled').addEventListener('change', (e) => { settings.gremlinPapaEnabled = e.target.checked; saveSettingsDebounced(); });
        document.getElementById('pp_gremlinTwinsEnabled').addEventListener('change', (e) => { settings.gremlinTwinsEnabled = e.target.checked; saveSettingsDebounced(); });
        document.getElementById('pp_gremlinMamaEnabled').addEventListener('change', (e) => { settings.gremlinMamaEnabled = e.target.checked; saveSettingsDebounced(); });
        document.getElementById('pp_gremlinAuditorEnabled').addEventListener('change', (e) => { settings.gremlinAuditorEnabled = e.target.checked; saveSettingsDebounced(); });

        injectNavigatorModal(); 
        const gremlinPresetNavigator = new PresetNavigator();
        gremlinPresetNavigator.init();

        queueReadyTask(async () => {
            try {
                await new Promise(resolve => {
                    const checkOpenAISettings = () => {
                        if (typeof openai_setting_names !== 'undefined' && Object.keys(openai_setting_names).length > 0) {
                            resolve();
                        } else {
                            setTimeout(checkOpenAISettings, 100);
                        }
                    };
                    checkOpenAISettings();
                });

                const presetOptions = ['<option value="Default">Default</option>', ...Object.keys(openai_setting_names).map(name => `<option value="${name}">${name}</option>`)].join('');
                ['papa', 'twins', 'mama', 'writer', 'auditor'].forEach(role => {
                    const roleUpper = role.charAt(0).toUpperCase() + role.slice(1);
                    const presetSelectId = `pp_gremlin${roleUpper}Preset`;
                    const presetSelect = document.getElementById(presetSelectId);
                    const browseBtn = document.querySelector(`.pp-browse-gremlin-preset-btn[data-target-select="${presetSelectId}"]`);
                    const apiBtn = document.querySelector(`.pp-select-api-btn[data-gremlin-role="${role}"]`);
                    if (presetSelect) {
                        presetSelect.innerHTML = presetOptions;
                        presetSelect.value = settings[`gremlin${roleUpper}Preset`] || 'Default';
                        presetSelect.addEventListener('change', () => { settings[`gremlin${roleUpper}Preset`] = presetSelect.value; saveSettingsDebounced(); });
                    }
                    if (browseBtn) browseBtn.addEventListener('pointerup', () => gremlinPresetNavigator.open(presetSelectId));
                    if (apiBtn) apiBtn.addEventListener('pointerup', () => showApiEditorPopup(role));
                    updateGremlinApiDisplay(role);
                });
                updateGremlinToggleState();
                console.log(`${LOG_PREFIX} Gremlin preset dropdowns populated.`);
            } catch (err) { console.error(`${LOG_PREFIX} Error populating Gremlin preset dropdowns:`, err); }

            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGremlinGeneration);
            eventSource.makeLast(event_types.USER_MESSAGE_RENDERED, (messageId) => onUserMessageRenderedForGremlin(messageId)); 
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, messageElement) => onAiCharacterMessageRendered(messageElement)); 

            await updateGlobalRegexArray();
            compileInternalActiveRules(); 
            const regexListContainer = document.getElementById('saved_regex_scripts');
            if (regexListContainer) {
                const observer = new MutationObserver(() => hideRulesInStandardUI());
                observer.observe(regexListContainer, { childList: true, subtree: true });
                hideRulesInStandardUI();
            }
            console.log(`${LOG_PREFIX} Core event listeners bound and initial updates done.`);
        });
        console.log(`${LOG_PREFIX} Core components initialized.`);
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
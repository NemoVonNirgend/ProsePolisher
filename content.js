import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
// Import the chat_completion_sources object and setting names from openai.js
import { openai_setting_names, chat_completion_sources } from '../../../../scripts/openai.js';

// Local module imports
import { PresetNavigator, injectNavigatorModal, generateUUID } from './navigator.js';
import {
    runGremlinPlanningPipeline, applyGremlinEnvironment, executeGen, applyGremlinWriterChaosOption,
    DEFAULT_PAPA_INSTRUCTIONS as PG_DEFAULT_PAPA_INSTRUCTIONS,
    DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE as PG_DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE,
    DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE as PG_DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE,
    DEFAULT_MAMA_INSTRUCTIONS as PG_DEFAULT_MAMA_INSTRUCTIONS
} from './projectgremlin.js';
import { Analyzer } from './analyzer.js';

// 1. CONFIGURATION AND STATE
// -----------------------------------------------------------------------------
export const EXTENSION_NAME = "ProsePolisher";
const LOG_PREFIX = `[${EXTENSION_NAME}]`;
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROSE_POLISHER_ID_PREFIX = '_prosePolisherRule_';
const GREMLIN_ROLES = ['papa', 'twins', 'mama', 'writer', 'auditor'];

// --- State Variables ---
let staticRules = [];
let dynamicRules = [];
let regexNavigator;
let prosePolisherAnalyzer = null;
let processedMessageIds = new Set();

// Gremlin-specific state variables
let isPipelineRunning = false;
let isAppReady = false;
let readyQueue = [];

// --- CONSTANTS ---

// This map connects the API key to the DOM ID of the corresponding model dropdown in the main UI.
const API_TO_SELECTOR_MAP = {
    [chat_completion_sources.OPENAI]: '#model_openai_select',
    [chat_completion_sources.CLAUDE]: '#model_claude_select',
    [chat_completion_sources.MAKERSUITE]: '#model_google_select',
    [chat_completion_sources.VERTEXAI]: '#model_vertexai_select',
    [chat_completion_sources.OPENROUTER]: '#model_openrouter_select', // This is the primary (Chat Completion) selector
    [chat_completion_sources.MISTRALAI]: '#model_mistralai_select',
    [chat_completion_sources.GROQ]: '#model_groq_select',
    [chat_completion_sources.COHERE]: '#model_cohere_select',
    [chat_completion_sources.AI21]: '#model_ai21_select',
    [chat_completion_sources.PERPLEXITY]: '#model_perplexity_select',
    [chat_completion_sources.DEEPSEEK]: '#model_deepseek_select',
    [chat_completion_sources.AIMLAPI]: '#model_aimlapi_select',
    [chat_completion_sources.XAI]: '#model_xai_select',
    [chat_completion_sources.ZEROONEAI]: '#model_01ai_select',
    [chat_completion_sources.POLLINATIONS]: '#model_pollinations_select',
    [chat_completion_sources.NANOGPT]: '#model_nanogpt_select',
};


const DEFAULT_WRITER_INSTRUCTIONS_TEMPLATE = `[OOC: You are a master writer. Follow these instructions from your project lead precisely for your next response. Do not mention the blueprint or instructions in your reply. Your writing should be creative and engaging, bringing this plan to life. Do not write from the user's perspective. Write only the character's response.\n\n# INSTRUCTIONS\n{{BLUEPRINT}}]`;
const DEFAULT_AUDITOR_INSTRUCTIONS_TEMPLATE = `[OOC: You are a master line editor. Your task is to revise and polish the following text. Correct any grammatical errors, awkward phrasing, or typos. Eliminate repetitive words and sentence structures. Enhance the prose to be more evocative and impactful, while respecting the established character voice and tone. If the text is fundamentally flawed or completely fails to follow the narrative, rewrite it from scratch to be high quality. **CRUCIAL:** Your output must ONLY be the final, edited text. Do NOT include any commentary, explanations, or introductory phrases like "Here is the revised version:".

# TEXT TO EDIT
{{WRITER_PROSE}}]`;

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
    regexGenerationMethod: 'current',
    regexGeneratorRole: 'writer',
    regexTwinsCycles: 2,
    skipTriageCheck: false,

    // Prose Polisher - Analysis Engine
    slopThreshold: 5.0,
    leaderboardUpdateCycle: 10,
    pruningCycle: 20,
    ngramMax: 7,
    patternMinCommon: 2,

    // Project Gremlin - Pipeline
    projectGremlinEnabled: false,
    gremlinPapaEnabled: true,
    gremlinTwinsEnabled: true,
    gremlinMamaEnabled: true,
    gremlinTwinsIterations: 3,
    gremlinAuditorEnabled: false,

    gremlinPapaPreset: 'Default',
    gremlinPapaApi: 'google',
    gremlinPapaModel: 'gemini-2.5-flash',
    gremlinPapaSource: '',
    gremlinPapaCustomUrl: '',
    gremlinPapaInstructions: '',

    gremlinTwinsPreset: 'Default',
    gremlinTwinsApi: 'google',
    gremlinTwinsModel: 'gemini-2.5-flash-lite-preview-06-17',
    gremlinTwinsSource: '',
    gremlinTwinsCustomUrl: '',
    gremlinTwinsVexInstructionsBase: '',
    gremlinTwinsVaxInstructionsBase: '',

    gremlinMamaPreset: 'Default',
    gremlinMamaApi: 'google',
    gremlinMamaModel: 'gemini-2.5-flash',
    gremlinMamaSource: '',
    gremlinMamaCustomUrl: '',
    gremlinMamaInstructions: '',

    gremlinWriterPreset: 'Default',
    gremlinWriterApi: '',
    gremlinWriterModel: '',
    gremlinWriterSource: '',
    gremlinWriterCustomUrl: '',
    gremlinWriterInstructionsTemplate: '',
    gremlinWriterChaosModeEnabled: false,
    gremlinWriterChaosOptions: [],

    gremlinAuditorPreset: 'Default',
    gremlinAuditorApi: '',
    gremlinAuditorModel: '',
    gremlinAuditorSource: '',
    gremlinAuditorCustomUrl: '',
    gremlinAuditorInstructionsTemplate: '',
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

    // Always filter first to ensure a clean slate
    if (!extension_settings.regex) extension_settings.regex = [];
    extension_settings.regex = extension_settings.regex.filter(rule => !rule.id?.startsWith(PROSE_POLISHER_ID_PREFIX));

    // Add rules back only if integration is enabled
    if (settings.integrateWithGlobalRegex) {
        const rulesToAdd = [];
        if (settings.isStaticEnabled) {
            rulesToAdd.push(...staticRules);
        }
        if (settings.isDynamicEnabled) {
            rulesToAdd.push(...dynamicRules);
        }
        
        const activeRulesForGlobal = rulesToAdd.filter(rule => !rule.disabled);

        for (const rule of activeRulesForGlobal) {
            // *** FIX: Updated the global rule object format ***
            const globalRule = {
                id: `${PROSE_POLISHER_ID_PREFIX}${rule.id || rule.scriptName.replace(/\s+/g, '_')}`,
                scriptName: `(PP) ${rule.scriptName}`,
                findRegex: rule.findRegex,
                replaceString: rule.replaceString,
                disabled: rule.disabled,
                substituteRegex: 0, 
                minDepth: null, 
                maxDepth: null, 
                trimStrings: [],
                placement: [0, 2, 3, 5, 6], 
                runOnEdit: false, 
                markdownOnly: true,
                promptOnly: true,
            };
            extension_settings.regex.push(globalRule);
        }
        console.log(`${LOG_PREFIX} Updated global regex array. ProsePolisher rules active in global list: ${activeRulesForGlobal.length}.`);
    } else {
        console.log(`${LOG_PREFIX} Global regex integration is OFF. ProsePolisher rules removed from global list.`);
    }

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


// 3. EVENT HANDLING & UI (Project Gremlin part)
// -----------------------------------------------------------------------------

async function showApiEditorPopup(gremlinRole) {
    if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
    const settings = extension_settings[EXTENSION_NAME];
    const roleUpper = gremlinRole.charAt(0).toUpperCase() + gremlinRole.slice(1);

    // Current settings for this role
    const currentApi = settings[`gremlin${roleUpper}Api`] || 'openai';
    const currentModel = settings[`gremlin${roleUpper}Model`] || '';
    const currentSource = settings[`gremlin${roleUpper}Source`] || '';
    const currentCustomUrl = settings[`gremlin${roleUpper}CustomUrl`] || '';

    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
        <div class="pp-custom-binding-inputs" style="display: flex; flex-direction: column; gap: 10px;">
            <div>
                <label for="pp_popup_api_selector">API Provider:</label>
                <select id="pp_popup_api_selector" class="text_pole"></select>
            </div>
            <div id="pp_popup_model_group">
                <label for="pp_popup_model_selector">Model:</label>
                <select id="pp_popup_model_selector" class="text_pole"></select>
            </div>
            <div id="pp_popup_custom_model_group" style="display: none;">
                <label for="pp_popup_custom_model_input">Custom Model Name:</label>
                <input type="text" id="pp_popup_custom_model_input" class="text_pole" placeholder="e.g., My-Fine-Tune-v1">
            </div>
            <div id="pp_popup_custom_url_group" style="display: none;">
                <label for="pp_popup_custom_url_input">Custom API URL:</label>
                <input type="text" id="pp_popup_custom_url_input" class="text_pole" placeholder="Enter your custom API URL">
            </div>
            <div id="pp_popup_source_group" style="display: none;">
                <label for="pp_popup_source_input">Source (for some OpenAI-compatibles):</label>
                <input type="text" id="pp_popup_source_input" class="text_pole" placeholder="e.g., DeepSeek">
            </div>
        </div>
        <br>
        <button id="pp-unbind-btn" class="menu_button is_dangerous">Clear All</button>
    `;

    const apiSelect = popupContent.querySelector('#pp_popup_api_selector');
    const modelSelect = popupContent.querySelector('#pp_popup_model_selector');
    const modelGroup = popupContent.querySelector('#pp_popup_model_group');
    const customModelGroup = popupContent.querySelector('#pp_popup_custom_model_group');
    const customModelInput = popupContent.querySelector('#pp_popup_custom_model_input');
    const customUrlGroup = popupContent.querySelector('#pp_popup_custom_url_group');
    const customUrlInput = popupContent.querySelector('#pp_popup_custom_url_input');
    const sourceGroup = popupContent.querySelector('#pp_popup_source_group');
    const sourceInput = popupContent.querySelector('#pp_popup_source_input');

    // Populate API Provider dropdown
    for (const name of Object.values(chat_completion_sources)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name.charAt(0).toUpperCase() + name.slice(1).replace(/([A-Z])/g, ' $1').trim();
        apiSelect.appendChild(option);
    }
    apiSelect.value = currentApi;

    const populateModels = (api) => {
        modelSelect.innerHTML = '';
        let sourceSelect = null;

        // CORRECTED: Smartly find the OpenRouter model list, wherever it may be.
        if (api === chat_completion_sources.OPENROUTER) {
            // The Chat Completion UI is primary.
            sourceSelect = document.querySelector('#model_openrouter_select');
            // If it's empty or missing, check the Text Completion UI as a fallback.
            if (!sourceSelect || sourceSelect.options.length <= 1) {
                console.log(`${LOG_PREFIX} OpenRouter chat completion list not found or empty, checking text completion list...`);
                sourceSelect = document.querySelector('#openrouter_model');
            }
        } else {
            // Standard logic for all other APIs.
            const sourceSelectorId = API_TO_SELECTOR_MAP[api];
            if (sourceSelectorId) {
                sourceSelect = document.querySelector(sourceSelectorId);
            }
        }

        // Toggle UI elements based on API
        const isCustom = api === chat_completion_sources.CUSTOM;
        modelGroup.style.display = !isCustom ? 'block' : 'none';
        customModelGroup.style.display = isCustom ? 'block' : 'none';
        customUrlGroup.style.display = isCustom ? 'block' : 'none';
        sourceGroup.style.display = ['openai', 'openrouter', 'custom'].includes(api) ? 'block' : 'none';

        if (sourceSelect) {
            // Clone all options (including those in optgroups)
            Array.from(sourceSelect.childNodes).forEach(node => {
                modelSelect.appendChild(node.cloneNode(true));
            });
            if (modelSelect.options.length <= 1) {
                console.warn(`${LOG_PREFIX} Source selector for ${api} was found, but it's empty.`);
                modelSelect.innerHTML = '<option value="">-- No models loaded in main UI --</option>';
            }
        } else {
            console.warn(`${LOG_PREFIX} Could not find any source model selector for API: ${api}`);
            modelSelect.innerHTML = '<option value="">-- No models found in main UI --</option>';
        }
    };

    populateModels(currentApi);
    apiSelect.addEventListener('change', () => populateModels(apiSelect.value));

    modelSelect.value = currentModel;
    customModelInput.value = currentModel;
    customUrlInput.value = currentCustomUrl;
    sourceInput.value = currentSource;

    popupContent.querySelector('#pp-unbind-btn').addEventListener('pointerup', () => {
        apiSelect.value = 'openai';
        populateModels('openai');
        modelSelect.value = '';
        customModelInput.value = '';
        customUrlInput.value = '';
        sourceInput.value = '';
        window.toastr.info('Cleared inputs. Click "Save" to apply.');
    });

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, `Set API/Model for ${roleUpper}`)) {
        const selectedApi = apiSelect.value;
        settings[`gremlin${roleUpper}Api`] = selectedApi;

        if (selectedApi === chat_completion_sources.CUSTOM) {
            settings[`gremlin${roleUpper}Model`] = customModelInput.value.trim();
            settings[`gremlin${roleUpper}CustomUrl`] = customUrlInput.value.trim();
        } else {
            settings[`gremlin${roleUpper}Model`] = modelSelect.value;
            settings[`gremlin${roleUpper}CustomUrl`] = '';
        }
        settings[`gremlin${roleUpper}Source`] = sourceInput.value.trim();

        saveSettingsDebounced();
        updateGremlinApiDisplay(gremlinRole);
        window.toastr.success(`API/Model settings saved for ${roleUpper}.`);
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

async function showInstructionsEditorPopup(gremlinRole) {
    if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }
    const settings = extension_settings[EXTENSION_NAME];
    const roleUpper = gremlinRole.charAt(0).toUpperCase() + gremlinRole.slice(1);

    let currentInstructions = '';
    let defaultInstructions = ''; // For single textarea roles
    let instructionSettingKey = `gremlin${roleUpper}Instructions`; // Default key
    let title = `Edit Instructions for ${roleUpper} Gremlin`;
    let placeholdersInfo = '';
    const popupContent = document.createElement('div');
    let textareasHtml = '';

    switch (gremlinRole) {
        case 'papa':
            currentInstructions = settings.gremlinPapaInstructions || PG_DEFAULT_PAPA_INSTRUCTIONS;
            defaultInstructions = PG_DEFAULT_PAPA_INSTRUCTIONS;
            instructionSettingKey = 'gremlinPapaInstructions';
            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">This prompt is given to Papa Gremlin to generate the initial blueprint. No dynamic pipeline placeholders are used within this prompt itself.</small>`;
            textareasHtml = `<textarea id="pp_instructions_editor" class="text_pole" style="min-height: 300px; width: 100%; resize: vertical; box-sizing: border-box;">${currentInstructions}</textarea>`;
            break;
        case 'twins':
            title = `Edit Base Instructions for Twin Gremlins (Vex & Vax)`;
            const currentVexBase = settings.gremlinTwinsVexInstructionsBase || PG_DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE;
            const defaultVexBase = PG_DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE;
            const currentVaxBase = settings.gremlinTwinsVaxInstructionsBase || PG_DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE;
            const defaultVaxBase = PG_DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE;

            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">These are the core persona instructions for Vex and Vax. They are dynamically inserted into a larger prompt structure that also includes Papa's blueprint and any previous twin ideas. The surrounding structure provides context like "Get inspired! Provide a concise note..."</small>`;
            textareasHtml = `
                <h4>Vex (Character Depth, Emotion)</h4>
                <textarea id="pp_instructions_vex_editor" class="text_pole" style="min-height: 150px; width: 100%; resize: vertical; box-sizing: border-box;">${currentVexBase}</textarea>
                <hr style="margin: 10px 0;">
                <h4>Vax (Plot, Action, World)</h4>
                <textarea id="pp_instructions_vax_editor" class="text_pole" style="min-height: 150px; width: 100%; resize: vertical; box-sizing: border-box;">${currentVaxBase}</textarea>
            `;
            break;
        case 'mama':
            currentInstructions = settings.gremlinMamaInstructions || PG_DEFAULT_MAMA_INSTRUCTIONS;
            defaultInstructions = PG_DEFAULT_MAMA_INSTRUCTIONS;
            instructionSettingKey = 'gremlinMamaInstructions';
            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">This prompt is given to Mama Gremlin. Ensure your custom prompt includes these placeholders if needed: <code>{{BLUEPRINT}}</code> (Papa's or initial blueprint), <code>{{TWIN_DELIBERATIONS}}</code> (collected ideas from Vex/Vax), <code>{{BLUEPRINT_SOURCE}}</code> (description of the blueprint's origin, e.g., "Papa's Blueprint").</small>`;
            textareasHtml = `<textarea id="pp_instructions_editor" class="text_pole" style="min-height: 300px; width: 100%; resize: vertical; box-sizing: border-box;">${currentInstructions}</textarea>`;
            break;
        case 'writer':
            currentInstructions = settings.gremlinWriterInstructionsTemplate || DEFAULT_WRITER_INSTRUCTIONS_TEMPLATE;
            defaultInstructions = DEFAULT_WRITER_INSTRUCTIONS_TEMPLATE;
            instructionSettingKey = 'gremlinWriterInstructionsTemplate';
            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">This is a template for the Writer Gremlin. Ensure your custom prompt includes the placeholder: <code>{{BLUEPRINT}}</code> (which will be Mama's final blueprint or the combined plan if Mama is disabled).</small>`;
            textareasHtml = `<textarea id="pp_instructions_editor" class="text_pole" style="min-height: 300px; width: 100%; resize: vertical; box-sizing: border-box;">${currentInstructions}</textarea>`;
            break;
        case 'auditor':
            currentInstructions = settings.gremlinAuditorInstructionsTemplate || DEFAULT_AUDITOR_INSTRUCTIONS_TEMPLATE;
            defaultInstructions = DEFAULT_AUDITOR_INSTRUCTIONS_TEMPLATE;
            instructionSettingKey = 'gremlinAuditorInstructionsTemplate';
            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">This is a template for the Auditor Gremlin. Ensure your custom prompt includes the placeholder: <code>{{WRITER_PROSE}}</code> (the text generated by the Writer Gremlin).</small>`;
            textareasHtml = `<textarea id="pp_instructions_editor" class="text_pole" style="min-height: 300px; width: 100%; resize: vertical; box-sizing: border-box;">${currentInstructions}</textarea>`;
            break;
        case 'regexGen':
            currentInstructions = settings.regexGenerationInstructions || DEFAULT_REGEX_GENERATION_INSTRUCTIONS;
            defaultInstructions = DEFAULT_REGEX_GENERATION_INSTRUCTIONS;
            instructionSettingKey = 'regexGenerationInstructions';
            title = 'Edit Regex Generation Prompt';
            placeholdersInfo = `<small style="display:block; margin-bottom:5px;">This prompt is sent to the AI when generating new regex rules. It should instruct the AI on how to identify patterns and format the output. No dynamic pipeline placeholders are used within this prompt itself.</small>`;
            textareasHtml = `<textarea id="pp_instructions_editor" class="text_pole" style="min-height: 300px; width: 100%; resize: vertical; box-sizing: border-box;">${currentInstructions}</textarea>`;
            break;
        default:
            window.toastr.error(`Unknown Gremlin role for instruction editing: ${gremlinRole}`);
            return;
    }

    popupContent.innerHTML = `
        ${placeholdersInfo}
        <div style="margin-top: 10px; margin-bottom: 10px;">
            ${textareasHtml}
        </div>
        <button id="pp_reset_instructions_btn" class="menu_button">Reset to Default</button>
    `;

    const resetButton = popupContent.querySelector('#pp_reset_instructions_btn');
    if (resetButton) {
        resetButton.addEventListener('pointerup', () => {
            if (gremlinRole === 'twins') {
                popupContent.querySelector('#pp_instructions_vex_editor').value = PG_DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE;
                popupContent.querySelector('#pp_instructions_vax_editor').value = PG_DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE;
            } else {
                popupContent.querySelector('#pp_instructions_editor').value = defaultInstructions;
            }
            window.toastr.info('Instructions reset to default. Click "OK" to save this reset, or "Cancel" to discard.');
        });
    }

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, title, { wide: true, large: true, overflowY: 'auto' })) {
        if (gremlinRole === 'twins') {
            const vexInstructions = popupContent.querySelector('#pp_instructions_vex_editor').value;
            const vaxInstructions = popupContent.querySelector('#pp_instructions_vax_editor').value;
            settings.gremlinTwinsVexInstructionsBase = (vexInstructions.trim() === PG_DEFAULT_TWINS_VEX_INSTRUCTIONS_BASE.trim()) ? '' : vexInstructions;
            settings.gremlinTwinsVaxInstructionsBase = (vaxInstructions.trim() === PG_DEFAULT_TWINS_VAX_INSTRUCTIONS_BASE.trim()) ? '' : vaxInstructions;
        } else {
            const newInstructions = popupContent.querySelector('#pp_instructions_editor').value;
            settings[instructionSettingKey] = (newInstructions.trim() === defaultInstructions.trim()) ? '' : newInstructions;
        }
        saveSettingsDebounced();
        window.toastr.success(`Instructions for ${roleUpper} Gremlin saved.`);
    }
}

// *** START: NEW CHAOS MODE FUNCTIONS ***

async function showWriterChaosConfigPopup() {
    if (!isAppReady) { window.toastr.info("SillyTavern is still loading, please wait."); return; }

    const container = document.createElement('div');
    container.id = 'pp-chaos-config-popup-content';
    container.innerHTML = `
        <p>Configure multiple API/Model/Preset options for the Writer Gremlin. When Chaos Mode is on, one of these will be chosen randomly for each generation based on its weight.</p>
        <div class="list-container" style="max-height: 400px; overflow-y: auto;">
            <ul id="pp-chaos-options-list"></ul>
        </div>
        <button id="pp-add-chaos-option-btn" class="menu_button"><i class="fa-solid fa-plus"></i> Add New Chaos Option</button>
    `;

    const renderChaosOptionsList = () => {
        const settings = extension_settings[EXTENSION_NAME];
        const listElement = container.querySelector('#pp-chaos-options-list');
        listElement.innerHTML = '';

        if (!settings.gremlinWriterChaosOptions || settings.gremlinWriterChaosOptions.length === 0) {
            listElement.innerHTML = '<li style="text-align:center; color:var(--text_color_dim); padding: 10px;">No chaos options configured.</li>';
            return;
        }

        settings.gremlinWriterChaosOptions.forEach(option => {
            const item = document.createElement('li');
            item.className = 'list-item';
            item.dataset.optionId = option.id;

            const display = `<strong>${option.api} / ${option.model || 'Not Set'}</strong> (Preset: ${option.preset || 'Default'})`;

            item.innerHTML = `
                <div style="flex-grow:1; min-width:0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${display}</div>
                <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                    <label for="chaos-weight-${option.id}" style="font-size:0.9em; margin:0;">Weight:</label>
                    <input type="number" id="chaos-weight-${option.id}" class="text_pole" value="${option.weight || 1}" min="1" max="100" style="width:60px;">
                    <button class="menu_button pp-chaos-edit-btn" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                    <i class="fa-solid fa-trash-can delete-btn" title="Delete"></i>
                </div>
            `;

            item.querySelector('.delete-btn').addEventListener('pointerup', () => {
                settings.gremlinWriterChaosOptions = settings.gremlinWriterChaosOptions.filter(o => o.id !== option.id);
                saveSettingsDebounced();
                renderChaosOptionsList();
            });

            item.querySelector('.pp-chaos-edit-btn').addEventListener('pointerup', () => {
                showChaosOptionEditorPopup(option.id, renderChaosOptionsList);
            });

            item.querySelector(`#chaos-weight-${option.id}`).addEventListener('change', (e) => {
                const newWeight = parseInt(e.target.value, 10);
                if (!isNaN(newWeight) && newWeight > 0) {
                    option.weight = newWeight;
                    saveSettingsDebounced();
                }
            });

            listElement.appendChild(item);
        });
    };

    container.querySelector('#pp-add-chaos-option-btn').addEventListener('pointerup', () => {
        showChaosOptionEditorPopup(null, renderChaosOptionsList);
    });

    renderChaosOptionsList();
    callGenericPopup(container, POPUP_TYPE.DISPLAY, "Writer Chaos Mode Configuration", { wide: true, large: true, addCloseButton: true });
}

async function showChaosOptionEditorPopup(optionId, onSaveCallback) {
    const settings = extension_settings[EXTENSION_NAME];
    const isNew = optionId === null;
    let option = isNew
        ? { id: generateUUID(), api: 'openai', model: '', source: '', customUrl: '', preset: 'Default', weight: 1 }
        : settings.gremlinWriterChaosOptions.find(o => o.id === optionId);

    if (!option) {
        window.toastr.error("Could not find chaos option to edit.");
        return;
    }

    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
        <div class="pp-custom-binding-inputs" style="display: flex; flex-direction: column; gap: 15px;">
            <div>
                <label for="pp_chaos_preset_selector">Parameter Preset:</label>
                <select id="pp_chaos_preset_selector" class="text_pole"></select>
            </div>
            <hr>
            <div>
                <label for="pp_chaos_api_selector">API Provider:</label>
                <select id="pp_chaos_api_selector" class="text_pole"></select>
            </div>
            <div id="pp_chaos_model_group">
                <label for="pp_chaos_model_selector">Model:</label>
                <select id="pp_chaos_model_selector" class="text_pole"></select>
            </div>
            <div id="pp_chaos_custom_model_group" style="display: none;">
                <label for="pp_chaos_custom_model_input">Custom Model Name:</label>
                <input type="text" id="pp_chaos_custom_model_input" class="text_pole" placeholder="e.g., My-Fine-Tune-v1">
            </div>
            <div id="pp_chaos_custom_url_group" style="display: none;">
                <label for="pp_chaos_custom_url_input">Custom API URL:</label>
                <input type="text" id="pp_chaos_custom_url_input" class="text_pole" placeholder="Enter your custom API URL">
            </div>
            <div id="pp_chaos_source_group" style="display: none;">
                <label for="pp_chaos_source_input">Source (for some OpenAI-compatibles):</label>
                <input type="text" id="pp_chaos_source_input" class="text_pole" placeholder="e.g., DeepSeek">
            </div>
            <hr>
            <div>
                <label for="pp_chaos_weight_input">Weight (higher is more likely):</label>
                <input type="number" id="pp_chaos_weight_input" class="text_pole" value="${option.weight}" min="1" max="100">
            </div>
        </div>
    `;

    const presetSelect = popupContent.querySelector('#pp_chaos_preset_selector');
    const apiSelect = popupContent.querySelector('#pp_chaos_api_selector');
    const modelSelect = popupContent.querySelector('#pp_chaos_model_selector');
    const modelGroup = popupContent.querySelector('#pp_chaos_model_group');
    const customModelGroup = popupContent.querySelector('#pp_chaos_custom_model_group');
    const customModelInput = popupContent.querySelector('#pp_chaos_custom_model_input');
    const customUrlGroup = popupContent.querySelector('#pp_chaos_custom_url_group');
    const customUrlInput = popupContent.querySelector('#pp_chaos_custom_url_input');
    const sourceGroup = popupContent.querySelector('#pp_chaos_source_group');
    const sourceInput = popupContent.querySelector('#pp_chaos_source_input');
    const weightInput = popupContent.querySelector('#pp_chaos_weight_input');

    // Populate Preset dropdown
    const presetOptions = ['<option value="Default">Default</option>', ...Object.keys(openai_setting_names).map(name => `<option value="${name}">${name}</option>`)].join('');
    presetSelect.innerHTML = presetOptions;
    presetSelect.value = option.preset;

    // Populate API Provider dropdown
    for (const name of Object.values(chat_completion_sources)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1).replace(/([A-Z])/g, ' $1').trim();
        apiSelect.appendChild(opt);
    }
    apiSelect.value = option.api;

    const populateModels = (api) => {
        modelSelect.innerHTML = '';
        let sourceSelect = null;

        // CORRECTED: Smartly find the OpenRouter model list, wherever it may be.
        if (api === chat_completion_sources.OPENROUTER) {
            sourceSelect = document.querySelector('#model_openrouter_select');
            if (!sourceSelect || sourceSelect.options.length <= 1) {
                sourceSelect = document.querySelector('#openrouter_model');
            }
        } else {
            const sourceSelectorId = API_TO_SELECTOR_MAP[api];
            if (sourceSelectorId) {
                sourceSelect = document.querySelector(sourceSelectorId);
            }
        }
        const isCustom = api === chat_completion_sources.CUSTOM;
        modelGroup.style.display = !isCustom ? 'block' : 'none';
        customModelGroup.style.display = isCustom ? 'block' : 'none';
        customUrlGroup.style.display = isCustom ? 'block' : 'none';
        sourceGroup.style.display = ['openai', 'openrouter', 'custom'].includes(api) ? 'block' : 'none';

        if (sourceSelect) {
            Array.from(sourceSelect.childNodes).forEach(node => modelSelect.appendChild(node.cloneNode(true)));
            if (modelSelect.options.length <= 1) {
                modelSelect.innerHTML = '<option value="">-- No models loaded in main UI --</option>';
            }
        } else {
             console.warn(`${LOG_PREFIX} Could not find any source model selector for Chaos Editor API: ${api}`);
             modelSelect.innerHTML = '<option value="">-- No models found in main UI --</option>';
        }
    };

    populateModels(option.api);
    apiSelect.addEventListener('change', () => populateModels(apiSelect.value));

    modelSelect.value = option.model;
    customModelInput.value = option.model;
    customUrlInput.value = option.customUrl;
    sourceInput.value = option.source;

    if (await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, isNew ? 'Add Chaos Option' : 'Edit Chaos Option')) {
        const newApi = apiSelect.value;
        const newModel = newApi === chat_completion_sources.CUSTOM ? customModelInput.value.trim() : modelSelect.value;

        const updatedOption = {
            id: option.id,
            preset: presetSelect.value,
            api: newApi,
            model: newModel,
            customUrl: newApi === chat_completion_sources.CUSTOM ? customUrlInput.value.trim() : '',
            source: sourceInput.value.trim(),
            weight: parseInt(weightInput.value, 10) || 1,
        };

        if (isNew) {
            settings.gremlinWriterChaosOptions.push(updatedOption);
        } else {
            const index = settings.gremlinWriterChaosOptions.findIndex(o => o.id === optionId);
            if (index !== -1) {
                settings.gremlinWriterChaosOptions[index] = updatedOption;
            }
        }

        saveSettingsDebounced();
        if (onSaveCallback) onSaveCallback();
        window.toastr.success(`Chaos option ${isNew ? 'added' : 'updated'}.`);
    }
}

function selectChaosOption() {
    const settings = extension_settings[EXTENSION_NAME];
    if (!settings.gremlinWriterChaosOptions?.length) return null;

    const options = settings.gremlinWriterChaosOptions;
    const totalWeight = options.reduce((sum, opt) => sum + (Number(opt.weight) || 1), 0);
    let random = Math.random() * totalWeight;
    let chosenOption = null;

    for (const option of options) {
        random -= (Number(option.weight) || 1);
        if (random <= 0) {
            chosenOption = option;
            break;
        }
    }
    if (!chosenOption) chosenOption = options[0]; // Fallback

    window.toastr.info(`Chaos roll: ${chosenOption.api} / ${chosenOption.model || 'Not Set'} / ${chosenOption.preset || 'Default'} (W: ${chosenOption.weight})`, "Project Gremlin", { timeOut: 5000 });
    return chosenOption;
}

// *** END: NEW CHAOS MODE FUNCTIONS ***

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

async function onBeforeGremlinGeneration(type, generateArgsObject, dryRun) {
    if (!isAppReady) {
        return;
    }
    if (isPipelineRunning) {
         console.log('[ProjectGremlin] Pipeline running, allowing internal /gen call by returning undefined from onBeforeGremlinGeneration.');
         return;
    }
    return;
}

// This function is rewritten to be more robust by querying the DOM directly.
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
        console.log(`${LOG_PREFIX} Dynamic rule generation triggered before Gremlin pipeline.`);
        prosePolisherAnalyzer.messageCounterForTrigger = 0;

        const getCandidateData = (lemmatizedKey) => {
            if (!lemmatizedKey) return null;
            const data = prosePolisherAnalyzer.ngramFrequencies.get(lemmatizedKey);
            return data ? { candidate: data.original, enhanced_context: data.contextSentence } : null;
        };

        const slopCandidateData = Array.from(prosePolisherAnalyzer.slopCandidates)
            .map(getCandidateData)
            .filter(Boolean);

        const candidatesForAutoTrigger = slopCandidateData.slice(0, 50); // TWINS_PRESCREEN_BATCH_SIZE

        if (candidatesForAutoTrigger.length === 0) {
            return;
        }

        let validCandidatesForGeneration = [];
        try {
            if (settings.skipTriageCheck) {
                console.log(`${LOG_PREFIX} [Auto Gen] Skip Triage is enabled. Using raw context.`);
                validCandidatesForGeneration = candidatesForAutoTrigger;
            } else {
                window.toastr.info(`Prose Polisher: Auto-triggering Twins pre-screening for ${candidatesForAutoTrigger.length} candidates...`, "Project Gremlin");
                const rawCandidates = candidatesForAutoTrigger.map(c => c.candidate);
                validCandidatesForGeneration = await prosePolisherAnalyzer.callTwinsForSlopPreScreening(rawCandidates, getCompiledRegexes());
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Error in auto-trigger pre-screening chain:`, error);
            window.toastr.error("Error during auto-trigger pre-screening. See console.");
            return; 
        }

        if (validCandidatesForGeneration.length === 0) {
            window.toastr.info("Prose Polisher: AI pre-screening found no valid candidates for auto-rule generation.", "Project Gremlin");
            return;
        }

        const BATCH_SIZE = 15;
        const batchToProcess = validCandidatesForGeneration.slice(0, BATCH_SIZE);
        prosePolisherAnalyzer.isProcessingAiRules = true;
        let newRulesCount = 0;

        try {
            const toastMsgBase = `Prose Polisher: Auto-triggering`;
            const toastMsgDetails = settings.skipTriageCheck
                ? `for ${batchToProcess.length} candidates...`
                : `for ${batchToProcess.length} pre-screened candidates...`;

            if (settings.regexGenerationMethod === 'twins') {
                window.toastr.info(`${toastMsgBase} Iterative Twins rule generation ${toastMsgDetails}`, "Project Gremlin");
                newRulesCount = await prosePolisherAnalyzer.generateRulesIterativelyWithTwins(batchToProcess, dynamicRules, settings.regexTwinsCycles);
            } else if (settings.regexGenerationMethod === 'single') {
                const gremlinRoleForRegexGen = settings.regexGeneratorRole || 'writer';
                const roleForGenUpper = gremlinRoleForRegexGen.charAt(0).toUpperCase() + gremlinRoleForRegexGen.slice(1);
                window.toastr.info(`${toastMsgBase} Single Gremlin (${roleForGenUpper}) rule generation ${toastMsgDetails}`, "Project Gremlin");
                newRulesCount = await prosePolisherAnalyzer.generateAndSaveDynamicRulesWithSingleGremlin(batchToProcess, dynamicRules, gremlinRoleForRegexGen);
            } else { // 'current'
                window.toastr.info(`${toastMsgBase} rule generation ${toastMsgDetails} (using current connection)`);
                newRulesCount = await prosePolisherAnalyzer.generateAndSaveDynamicRulesWithSingleGremlin(batchToProcess, dynamicRules, 'current');
            }
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

async function onUserMessageRenderedForGremlin(messageId) {
    if (!isAppReady) {
        console.warn(`[ProjectGremlin] onUserMessageRenderedForGremlin called before app ready for message ID ${messageId}.`);
        return;
    }
    
    // --- NEW RELIABLE FLOW ---
    // 1. Analyze the last AI response that just occurred.
    analyzeLatestAiMessage();

    // 2. Check if the new analysis has met the conditions to trigger AI rule generation.
    await triggerDynamicRuleGenerationIfNeeded();
    // --- END OF NEW FLOW ---

    const settings = extension_settings[EXTENSION_NAME];
    const context = getContext();

    if (!settings.projectGremlinEnabled || isPipelineRunning) {
        return;
    }
    
    isPipelineRunning = true;

    try {
        const finalBlueprint = await runGremlinPlanningPipeline();
        if (!finalBlueprint) {
            throw new Error('Project Gremlin planning failed to produce a blueprint.');
        }

        let finalInjectedInstruction;
        const writerInstructionTemplateSetting = settings.gremlinWriterInstructionsTemplate;
        const writerTemplate = (writerInstructionTemplateSetting && writerInstructionTemplateSetting.trim() !== '')
            ? writerInstructionTemplateSetting
            : DEFAULT_WRITER_INSTRUCTIONS_TEMPLATE;

        const auditorInstructionTemplateSetting = settings.gremlinAuditorInstructionsTemplate;
        const auditorTemplate = (auditorInstructionTemplateSetting && auditorInstructionTemplateSetting.trim() !== '')
            ? auditorInstructionTemplateSetting
            : DEFAULT_AUDITOR_INSTRUCTIONS_TEMPLATE;

        if (settings.gremlinAuditorEnabled) {
            window.toastr.info("Gremlin Pipeline: Step 4 - Writer is crafting...", "Project Gremlin", { timeOut: 7000 });
            
            // Apply Writer Environment (Standard or Chaos)
            if (settings.gremlinWriterChaosModeEnabled && settings.gremlinWriterChaosOptions?.length > 0) {
                const chosenOption = selectChaosOption();
                if (!chosenOption || !await applyGremlinWriterChaosOption(chosenOption)) throw new Error("Failed to configure chaotic Writer environment.");
            } else {
                if (!await applyGremlinEnvironment('writer')) throw new Error("Failed to configure Writer environment for Auditor path.");
            }
            
            const writerSystemInstruction = writerTemplate.replace('{{BLUEPRINT}}', finalBlueprint);
            const writerProse = await executeGen(writerSystemInstruction);
            if (!writerProse.trim()) throw new Error("Internal Writer Gremlin step failed to produce a response.");

            window.toastr.info("Gremlin Pipeline: Handing off to Auditor...", "Project Gremlin", { timeOut: 4000 });
            if (!await applyGremlinEnvironment('auditor')) throw new Error("Failed to configure Auditor environment.");
            finalInjectedInstruction = auditorTemplate.replace('{{WRITER_PROSE}}', writerProse);
        } else {
            window.toastr.info("Gremlin Pipeline: Handing off to Writer...", "Project Gremlin", { timeOut: 4000 });

            // Apply Writer Environment (Standard or Chaos)
            if (settings.gremlinWriterChaosModeEnabled && settings.gremlinWriterChaosOptions?.length > 0) {
                const chosenOption = selectChaosOption();
                if (!chosenOption || !await applyGremlinWriterChaosOption(chosenOption)) throw new Error("Failed to configure chaotic Writer environment.");
            } else {
                if (!await applyGremlinEnvironment('writer')) throw new Error("Failed to configure Writer environment.");
            }

            finalInjectedInstruction = writerTemplate.replace('{{BLUEPRINT}}', finalBlueprint);
        }

        window.toastr.success("Gremlin Pipeline: Blueprint complete! Prompt instruction prepared.", "Project Gremlin");
        
        // *** FIX & ENHANCEMENT STARTS HERE ***
        const adherenceInstruction = "[System: Adhere to the detailed blueprint provided in the following instruction.]";
        const sanitizedAdherence = adherenceInstruction.replace(/"/g, '\\"');
        const sanitizedBlueprint = finalInjectedInstruction.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

        const finalScript = `/inject id=gremlin_adherence_prompt position=chat depth=0 "${sanitizedAdherence}" | /inject id=gremlin_final_plan position=chat depth=2 "${sanitizedBlueprint}"`;

        await context.executeSlashCommands(finalScript);
        // *** FIX & ENHANCEMENT ENDS HERE ***

    } catch (error) {
        console.error('[ProjectGremlin] A critical error occurred during the pipeline execution:', error);
        window.toastr.error(`Project Gremlin pipeline failed: ${error.message}. Generation may proceed without blueprint.`, "Project Gremlin Error");
    } finally {
        isPipelineRunning = false;
        if (context.reloadGenerationSettings) {
            context.reloadGenerationSettings();
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
                const editorPopup = deleteBtn.closest('.popup_confirm');
                if (await callGenericPopup('Are you sure you want to to delete this rule?', POPUP_TYPE.CONFIRM)) {
                    await this.handleDelete(rule.id);
                    editorPopup?.querySelector('.popup-button-cancel')?.click();
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
        document.getElementById('prose_polisher_edit_regex_gen_prompt_button').addEventListener('pointerup', () => showInstructionsEditorPopup('regexGen'));

        // Regex Generation Method Controls
        const regexGenMethodSelector = document.getElementById('pp_regex_gen_method_selector');
        const singleGremlinControls = document.getElementById('pp_regex_gen_single_gremlin_controls');
        const iterativeTwinsControls = document.getElementById('pp_regex_gen_iterative_twins_controls');
        const regexGenAiSelector = document.getElementById('pp_regex_gen_ai_selector');
        const regexTwinsCyclesSelector = document.getElementById('pp_regex_twins_cycles_selector');

        function updateRegexGenControlsVisibility() {
            if (!isAppReady) return;
            const method = settings.regexGenerationMethod;
            singleGremlinControls.style.display = (method === 'single') ? 'flex' : 'none';
            iterativeTwinsControls.style.display = (method === 'twins') ? 'flex' : 'none';
        }

        if (regexGenMethodSelector) {
            regexGenMethodSelector.value = settings.regexGenerationMethod;
            regexGenMethodSelector.addEventListener('change', () => {
                settings.regexGenerationMethod = regexGenMethodSelector.value;
                saveSettingsDebounced();
                updateRegexGenControlsVisibility();
            });
        }
        if (regexGenAiSelector) {
            regexGenAiSelector.value = settings.regexGeneratorRole;
            regexGenAiSelector.addEventListener('change', () => {
                settings.regexGeneratorRole = regexGenAiSelector.value;
                saveSettingsDebounced();
            });
        }
        if (regexTwinsCyclesSelector) {
            regexTwinsCyclesSelector.value = settings.regexTwinsCycles;
            regexTwinsCyclesSelector.addEventListener('change', () => {
                settings.regexTwinsCycles = parseInt(regexTwinsCyclesSelector.value, 10);
                saveSettingsDebounced();
            });
        }
        updateRegexGenControlsVisibility(); // Initial setup

        const skipTriageCheck = document.getElementById('pp_skip_triage_check');
        if (skipTriageCheck) {
            skipTriageCheck.checked = settings.skipTriageCheck;
            skipTriageCheck.addEventListener('change', () => {
                settings.skipTriageCheck = skipTriageCheck.checked;
                saveSettingsDebounced();
            });
        }


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
        const gremlinSettingsContainer = document.getElementById('pp_projectGremlin_settings_container');

        const updateGremlinSettingsVisibility = () => {
            if (gremlinSettingsContainer) {
                gremlinSettingsContainer.style.display = gremlinEnableCheckbox.checked ? 'block' : 'none';
            }
        };

        const updateGremlinToggleState = () => {
            if (!isAppReady) return;
            const enabled = settings.projectGremlinEnabled;
            gremlinToggle?.classList.toggle('active', enabled);
            if (gremlinEnableCheckbox) {
                gremlinEnableCheckbox.checked = enabled;
                updateGremlinSettingsVisibility(); // Update visibility when state changes
            }
        };
        const toggleGremlin = () => {
            if (!isAppReady) { window.toastr.warning("SillyTavern is not fully ready yet."); return; }
            settings.projectGremlinEnabled = !settings.projectGremlinEnabled;
            saveSettingsDebounced();
            updateGremlinToggleState();
            window.toastr.info(`Project Gremlin ${settings.projectGremlinEnabled ? 'enabled' : 'disabled'} for next message.`);

            if (!settings.projectGremlinEnabled) {
                const context = getContext();
                context.executeSlashCommands('/inject id=gremlin_final_plan remove | /inject id=gremlin_adherence_prompt remove');
            }
        };
        gremlinToggle?.addEventListener('pointerup', toggleGremlin);
        gremlinEnableCheckbox?.addEventListener('change', (e) => {
            if (settings.projectGremlinEnabled !== e.target.checked) {
                 settings.projectGremlinEnabled = e.target.checked;
                 saveSettingsDebounced();
                 updateGremlinToggleState();
                 updateGremlinSettingsVisibility(); // Ensure visibility updates on direct checkbox change
                 if (!settings.projectGremlinEnabled) {
                    const context = getContext();
                    context.executeSlashCommands('/inject id=gremlin_final_plan remove | /inject id=gremlin_adherence_prompt remove');
                }
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

        // NEW: Bind Writer Chaos Mode controls
        const writerChaosToggle = document.getElementById('pp_gremlinWriterChaosModeEnabled');
        const configureChaosBtn = document.getElementById('pp_configure_writer_chaos_btn');

        writerChaosToggle.checked = settings.gremlinWriterChaosModeEnabled;
        writerChaosToggle.addEventListener('change', () => {
            settings.gremlinWriterChaosModeEnabled = writerChaosToggle.checked;
            saveSettingsDebounced();
            window.toastr.info(`Writer Chaos Mode ${settings.gremlinWriterChaosModeEnabled ? 'enabled' : 'disabled'}.`);
        });
        configureChaosBtn.addEventListener('pointerup', () => showWriterChaosConfigPopup());


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
                GREMLIN_ROLES.forEach(role => {
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

                    const editInstructionsBtn = document.querySelector(`.pp-edit-instructions-btn[data-gremlin-role="${role}"]`);
                    if (editInstructionsBtn) {
                        editInstructionsBtn.addEventListener('pointerup', () => showInstructionsEditorPopup(role));
                    }
                });
                updateGremlinToggleState();
                updateRegexGenControlsVisibility(); // Ensure correct visibility after app ready
                updateGremlinSettingsVisibility(); // Initial visibility setup for Gremlin settings
            } catch (err) { console.error(`${LOG_PREFIX} Error populating Gremlin preset dropdowns or binding instruction editors:`, err); }

            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGremlinGeneration);
            eventSource.makeLast(event_types.USER_MESSAGE_RENDERED, (messageId) => onUserMessageRenderedForGremlin(messageId)); 
            eventSource.on(event_types.chat_id_changed, () => { processedMessageIds.clear(); console.log(`${LOG_PREFIX} Chat changed, cleared processed message ID cache.`); });

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
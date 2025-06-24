// C:\SillyTavern\public\scripts\extensions\third-party\ProsePolisher\projectgremlin.js
import { extension_settings, getContext } from '../../../extensions.js';

// This map is used to get the correct API name for the `/api` slash command.
const CONNECT_API_MAP = {
    openai: { selected: 'openai' },
    claude: { selected: 'claude' },
    google: { selected: 'google' },
    openrouter: { selected: 'openai' }, // OpenRouter uses the OpenAI-compatible endpoint
    deepseek: { selected: 'openai' },   // DeepSeek uses the OpenAI-compatible endpoint
    koboldai: { selected: 'koboldai' },
    novelai: { selected: 'novelai' },
    textgenerationwebui: { selected: 'textgenerationwebui' },
};

/**
 * Centralized function to apply Preset, API, and Model settings for a given pipeline role.
 * This function sets the entire environment for a pipeline step.
 * @param {string} role The Gremlin role (e.e., 'papa', 'twins', 'mama', 'writer', 'auditor').
 * @returns {Promise<boolean>} True if the environment was configured successfully, false otherwise.
 */
export async function applyGremlinEnvironment(role) {
    const settings = extension_settings.ProsePolisher;
    const roleUpper = role.charAt(0).toUpperCase() + role.slice(1);

    const presetName = settings[`gremlin${roleUpper}Preset`];
    const apiName = settings[`gremlin${roleUpper}Api`];
    const modelName = settings[`gremlin${roleUpper}Model`];
    const source = settings[`gremlin${roleUpper}Source`];

    const commands = [];

    // 1. Apply the preset for temp, top_p, etc.
    if (presetName) {
        commands.push(`/preset "${presetName}"`);
    }

    // 2. Apply the API and Model
    if (apiName) {
        const apiConfig = CONNECT_API_MAP[apiName.toLowerCase()];
        if (apiConfig) {
            commands.push(`/api ${apiConfig.selected}`);
            if (modelName) {
                // The source_field parameter is specifically for OpenAI-compatible APIs like OpenRouter/DeepSeek
                const sourceCommand = (apiConfig.selected === 'openai' && source) ? ` source_field=${source}` : '';
                commands.push(`/model "${modelName}"${sourceCommand}`);
            }
        } else {
            toastr.error(`[ProjectGremlin] Unknown API for ${roleUpper}: "${apiName}"`);
            return false;
        }
    }

    if (commands.length === 0) {
        console.log(`[ProjectGremlin] No settings to apply for ${roleUpper}, using current environment.`);
        return true;
    }

    const script = commands.join(' | ');
    console.log(`[ProjectGremlin] Executing environment setup for ${roleUpper}: ${script}`);
    try {
        await getContext().executeSlashCommands(script);
    } catch (err) {
        console.error(`[ProjectGremlin] Failed to execute setup script for ${roleUpper}: "${script}"`, err);
        toastr.error(`Failed to execute script for ${roleUpper}: "${script}".`, "Project Gremlin");
        return false;
    }

    return true;
}


/**
 * Executes a generation command with a given prompt and returns the generated text.
 * Assumes the environment (preset, api, model) has already been set.
 * @param {string} promptText - The text content for the /gen command.
 * @returns {Promise<string>} The generated text.
 */
export async function executeGen(promptText) {
    const context = getContext();
    // Sanitize prompt text to be safe inside a double-quoted string
    const sanitizedPrompt = promptText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `/gen "${sanitizedPrompt}" |`; // The pipe at the end captures the output

    try {
        const result = await context.executeSlashCommandsWithOptions(script, {
            showOutput: false,
            handleExecutionErrors: true,
        });

        if (result && result.isError) {
            throw new Error(`STScript execution failed: ${result.errorMessage}`);
        }
        return result.pipe || '';
    } catch (error) {
        console.error(`[ProjectGremlin] Error executing generation script: "${script.substring(0, 100)}..."`, error);
        toastr.error(`Project Gremlin failed during script execution. Check console for details.`);
        throw error;
    }
}

/**
 * Runs the planning stages of the pipeline (Papa, Twins, Mama).
 * @returns {Promise<string|null>} The final blueprint string, or null on failure.
 */
export async function runGremlinPlanningPipeline() {
    console.log('[ProjectGremlin] The Gremlin planning process is starting...');
    const settings = extension_settings.ProsePolisher;

    // The `/gen` command automatically includes the pending user message in its context.
    // We only need to provide the instructions for the LLM.

    // --- 1. Papa Gremlin (The Architect) ---
    // The prompt is simplified as it no longer needs the explicit user message.
    let blueprint = `[OOC: Based on the provided chat history (which includes the user's latest message), your task is to create a high-level, flexible blueprint for the next response. This blueprint should outline key emotional beats, potential actions, dialogue themes, and sensory details. It should be a guide, not a rigid script. Focus on creating an engaging and logical continuation of the narrative.]`;
    let blueprintSource = 'Base Instructions';
    if (settings.gremlinPapaEnabled) {
        toastr.info("Gremlin Pipeline: Step 1 - Papa Gremlin is drafting...", "Project Gremlin", { timeOut: 7000 });
        if (!await applyGremlinEnvironment('papa')) throw new Error("Failed to configure environment for Papa Gremlin.");
        const papaResult = await executeGen(blueprint);
        if (!papaResult.trim()) throw new Error("Papa Gremlin failed to produce a blueprint.");
        blueprint = papaResult;
        blueprintSource = "Papa's Blueprint";
        console.log('[ProjectGremlin] Papa Gremlin\'s Blueprint:', blueprint);
    }

    // --- 2. Twin Gremlins (The Refiners) ---
    let twinDeliberations = '';
    if (settings.gremlinTwinsEnabled) {
        toastr.info("Gremlin Pipeline: Step 2 - The Twins are refining...", "Project Gremlin", { timeOut: 15000 });
        if (!await applyGremlinEnvironment('twins')) throw new Error("Failed to configure environment for the Twin Gremlins.");
        const vexPrompt = `You are Vex, a storyteller focused on character depth and emotion. Your job is to critique and enhance the blueprint with suggestions for internal thoughts, emotional reactions, subtle body language, and dialogue that reveals character.`;
        const vaxPrompt = `You are Vax, a world-builder focused on plot and action. Your job is to critique and enhance the blueprint with suggestions for impactful actions, environmental interactions, plot progression, and pacing.`;

        for (let i = 1; i <= 6; i++) {
            const isVexTurn = i % 2 !== 0;
            const currentTwin = isVexTurn ? 'Vex' : 'Vax';
            toastr.info(`Gremlin Pipeline: Twin Step ${i}/6 - ${currentTwin}'s turn...`, "Project Gremlin", { timeOut: 5000, preventDuplicates: true });
            const twinPreamble = `**Source Blueprint (${blueprintSource}):**\n${blueprint}\n---\n**Refinement Notes So Far:**\n${twinDeliberations || 'None.'}\n---\n**Your Task:**\n[OOC: ${isVexTurn ? vexPrompt : vaxPrompt} Provide a concise note (1-2 sentences) with a specific, actionable suggestion.]`;
            const twinNote = await executeGen(twinPreamble);
            if (twinNote && twinNote.trim()) {
                twinDeliberations += `**${currentTwin}'s Note ${Math.ceil(i/2)}/3:** ${twinNote}\n\n`;
            }
        }
        console.log('[ProjectGremlin] Full Twin Deliberations:', twinDeliberations);
    }

    // --- 3. Mama Gremlin (The Supervisor) ---
    let finalBlueprint;
    if (settings.gremlinMamaEnabled) {
        toastr.info("Gremlin Pipeline: Step 3 - Mama Gremlin is finalizing...", "Project Gremlin", { timeOut: 7000 });
        if (!await applyGremlinEnvironment('mama')) throw new Error("Failed to configure environment for Mama Gremlin.");
        const mamaPrompt = `[OOC: You are Mama Gremlin, the project supervisor. Synthesize the Source Blueprint and the Twins' Refinement Notes into a single, polished, final blueprint. Integrate the suggestions seamlessly to create a cohesive and detailed plan for the writer. The final output should be a clear set of instructions, not a story. \n\n**Source Blueprint (${blueprintSource}):**\n${blueprint}\n\n**Twins' Notes:**\n${twinDeliberations || 'None.'}]`;
        const mamaResult = await executeGen(mamaPrompt);
        if (!mamaResult.trim()) throw new Error("Mama Gremlin failed to produce the final blueprint.");
        finalBlueprint = mamaResult;
        console.log('[ProjectGremlin] Mama Gremlin\'s Final Blueprint:', finalBlueprint);
    } else {
        // If Mama is disabled, the final blueprint is just the combined output of previous steps.
        finalBlueprint = `**Source Blueprint (${blueprintSource}):**\n${blueprint}\n\n**Twins' Notes (if any):**\n${twinDeliberations || 'None.'}`;
        console.log('[ProjectGremlin] Mama Gremlin skipped. Using combined blueprint:', finalBlueprint);
    }

    return finalBlueprint;
}
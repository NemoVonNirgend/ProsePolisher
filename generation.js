import { getContext } from '../../../extensions.js';

export async function generateText(prompt) {
    const context = getContext();
    const result = await context.executeSlashCommandsWithOptions(
        `/gen ${JSON.stringify(prompt)} |`,
        {
            showOutput: false,
            handleExecutionErrors: true,
        },
    );

    if (result?.isError) {
        throw new Error(result.errorMessage || 'SillyTavern generation failed.');
    }

    return result?.pipe || '';
}

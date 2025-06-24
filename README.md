Okay, here is a comprehensive guide for your Prose Polisher (Regex + AI) extension, updated to include the Project Gremlin pipeline and other features visible in your code.

---
--- START OF FILE README.md (Updated) ---

# Prose Polisher (Regex + AI)

A comprehensive tool to enhance AI writing quality by fixing echoes and repetitive phrases ('slop'), featuring the advanced Project Gremlin multi-agent pipeline.

## Table of Contents
- [Key Features](#key-features)
- [How It Works: The Three Pillars (Regex)](#how-it-works-the-three-pillars-regex)
- [How It Works: Project Gremlin Pipeline](#how-it-works-project-gremlin-pipeline)
- [Usage Guide](#usage-guide)
  - [Initial Setup](#initial-setup)
  - [The Settings Panel](#the-settings-panel)
  - [The Regex Navigator](#the-regex-navigator)
  - [The Gremlin Preset Navigator](#the-gremlin-preset-navigator)
  - [AI Rule Generation in Action (Dynamic Regex)](#ai-rule-generation-in-action-dynamic-regex)
  - [Project Gremlin in Action](#project-gremlin-in-action)
- [For Power Users](#for-power-users)
  - [Manually Adding Static Rules](#manually-adding-static-rules)
  - [Understanding the Dynamic Regex AI Prompt](#understanding-the-dynamic-regex-ai-prompt)
  - [Understanding Project Gremlin's Internal Mechanics](#understanding-project-gremlins-internal-mechanics)
  - [Whitelist and Blacklist Details](#whitelist-and-blacklist-details)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Contributing](#contributing)
- [License](#license)

---

## Key Features

*   **✒️ Curated Static Rules:** Comes pre-loaded with over 50 high-quality rules to fix the most common writing clichés, such as repetitive blushing, hitched breaths, pounding hearts, and more.
*   **🧠 Dynamic AI Learning:** When enabled, the extension actively listens to AI messages, identifies *new* repetitive phrases unique to your current model or character, and uses an LLM to automatically generate new, creative regex rules to fix them.
*   **🎛️ Full Regex Navigator:** A dedicated UI to view, enable/disable, edit, and create your own static or dynamic regex rules without ever touching a JSON file.
*   **📊 On-Demand Chat Analysis:** Analyze your entire chat history with a single click to instantly populate frequency data and identify potential slop candidates for AI rule generation.
*   **🔍 Live Frequency Data:** View a real-time leaderboard of repetitive phrases and detected patterns in your current chat session.
*   **✅ Seamless Regex Integration:** Regex rules are applied globally and instantly after generation, altering both the displayed chat and the context sent in the next prompt, preventing the AI from repeating its own slop.
*   **🔤 Capitalization Correction:** Automatically capitalizes the beginning of sentences in AI responses, ensuring that replacements fit seamlessly and grammatically.
*   **💡 Intelligent Pattern Detection:** The frequency analysis is smart. It groups similar phrases (e.g., "a flicker of doubt crossed his eyes" and "a flicker of anger crossed his face") into a single, more powerful pattern.
*   **🚫 Words Blacklist/Whitelist:** Granular control over the frequency analysis. Tell the extension to ignore phrases containing certain words (whitelist) or prioritize phrases containing others (blacklist) for slop detection.
*   **🤖 Project Gremlin Pipeline:** An **experimental, multi-agent generation pipeline** designed to break down complex response generation into specialized stages (planning, writing, editing) using different AI models for maximum quality and control.
*   **🗄️ Gremlin Preset Navigator:** A UI to browse and select your saved SillyTavern API presets for each specific role within the Project Gremlin pipeline.

---

## How It Works: The Three Pillars (Regex)

Prose Polisher's regex features operate on three core principles to provide a comprehensive solution for fixing common and repetitive phrasing.

1.  **Static Correction (The Foundation):**
    The `regex_rules.json` file contains a list of hand-crafted regex rules that target common, universally acknowledged writing crutches ("slop"). When "Enable Static Regex Fixes" is on, these rules are always active, instantly replacing phrases like *"His cheeks flushed red"* with more engaging alternatives like *"as warmth spread across his cheeks"*. These rules use capture groups and random replacement syntax for variety.

2.  **Dynamic Learning (The Smart Assistant):**
    This is the AI-powered core of the *regex* system. When "Enable Dynamic AI Learning" is active:
    *   The extension analyzes every incoming AI message for repetitive phrases (n-grams of various lengths).
    *   Common words and whitelisted words are ignored. Blacklisted words increase a phrase's priority.
    *   When a phrase is repeated more than a set number of times (`SLOP_THRESHOLD`, default 3), it's flagged as a "slop candidate". Phrases already handled by existing static or dynamic rules are ignored.
    *   After a certain number of *further* messages (`Auto-Rule Gen Trigger`), the extension sends these candidates to an LLM (by default, `deepseek-reasoning` via the Pollinations API, but this is configurable by power users).
    *   The AI is prompted to act as a regex expert, creating new `findRegex` and `replaceString` rules with multiple creative alternatives for the provided slop phrases.
    *   These new rules are automatically saved, activated (if dynamic rules are enabled), and marked as 'new' in the navigator, teaching Prose Polisher how to fix the specific bad habits of your current AI model.

3.  **User Control (The Cockpit):**
    You are the final arbiter of style. The **[Regex Navigator](#the-regex-navigator)** and settings panel give you total control. You can disable rules you don't like, edit AI-generated dynamic rules to better suit your taste, or create entirely new dynamic ones from scratch. You can also manually trigger the chat analysis and AI rule generation process at any time. The **[Whitelist and Blacklist Managers](#whitelist-and-blacklist-details)** provide further control over the dynamic learning process.

---

## How It Works: Project Gremlin Pipeline

Project Gremlin is an alternative, more advanced approach to generating responses, designed to overcome limitations of single-pass generation by breaking down the process into specialized, sequential AI tasks. When enabled, it **replaces** the standard SillyTavern generation flow for that message.

1.  **Trigger:** The pipeline is triggered automatically when you send a user message, *if the Project Gremlin toggle is active*.
2.  **Internal Execution:** Unlike standard generation, Project Gremlin stages often run internally using SillyTavern's slash command system (`/gen`) to get responses from specific models and configurations you define for each "Gremlin" role. The user message and relevant chat history are automatically available to these internal `/gen` calls.
3.  **The Roles:**
    *   **Papa Gremlin (Architect):** (Optional - controlled by settings checkbox) Uses a high-intelligence model to generate a high-level *blueprint* or plan for the next response, based on the chat history and user message.
    *   **Twin Gremlins (Refiners):** (Optional - controlled by settings checkbox) Uses a faster model to perform a 6-step critique and enhancement process on the blueprint, providing specific suggestions from two different perspectives (e.g., character depth vs. plot progression).
    *   **Mama Gremlin (Supervisor):** (Optional - controlled by settings checkbox) Uses a balanced model to synthesize the initial blueprint (or Papa's output) and the Twins' suggestions into a single, polished, detailed *final blueprint*.
    *   **Writer Gremlin:** (Always Active when Gremlin pipeline is enabled) Uses a creative, capable model to write the actual prose response, using the final blueprint (or whatever blueprinting steps were enabled) as its instructions. This stage sets the environment (API/Model/Preset) for the *final* generation call.
    *   **Auditor Gremlin (Editor):** (Optional - controlled by settings checkbox) If enabled, the Writer runs *internally* to produce a draft. The Auditor then uses a high-quality model to take the Writer's draft and the final blueprint, performs line-editing and polishing, and produces the *final* text that SillyTavern displays. This stage sets the environment (API/Model/Preset) for the *final* generation call.
4.  **Final Generation:** The output of the last active stage (Writer's prose if Auditor is off, Auditor's edited text if Auditor is on) is injected into the prompt context as a crucial instruction for the main SillyTavern generation engine. The API, Model, and Preset defined for that final stage (Writer or Auditor) are set as the active generation parameters for this final step.
5.  **Output:** SillyTavern executes the final generation call, guided by the injected output from the pipeline, producing the response you see in the chat. The extension restores the previously active generation settings afterwards.

This multi-pass approach aims to produce more coherent, well-structured, and creative responses than a single API call might achieve.

---

## Usage Guide

### Initial Setup

After installation, navigate to the Extensions settings panel (the gear icon). You will find the "Prose Polisher (Regex + AI)" section.

*   **Enable Static Regex Fixes:** It's highly recommended to keep this checked. This activates the foundational set of rules designed to fix common, universal cliches.
*   **Enable Dynamic AI Learning:** Check this if you want the extension to learn and adapt to your AI's specific writing style by automatically generating new regex rules over time.
*   **Enable Project Gremlin:** This is controlled by a dedicated toggle button that appears next to the send button in the chat UI. The checkbox in settings simply reflects and can control this state. When active, this replaces the standard generation process for the next message.

### The Settings Panel

The main settings panel provides control over both the core regex features and the Project Gremlin pipeline.

*   **Auto-Rule Gen Trigger:** (For Dynamic Regex) This number determines how many AI messages to wait *after* a slop candidate has been identified before sending it to the AI for rule generation. A lower number means faster rule creation; a higher number means it will batch more candidates together.
*   **Open Regex Navigator:** Opens the main UI for managing all your static and dynamic *regex rules*.
*   **Manage Whitelist:** Opens a popup where you can add words (like common words or character names) that, if present in a phrase, will prevent that phrase from being analyzed for frequency.
*   **Manage Blacklist:** Opens a popup where you can add words (like "suddenly", "began to") that, if present in a phrase, will *prioritize* that phrase for slop analysis and AI rule generation.
*   **Clear Frequency Data:** Resets all tracked phrase counts. Use this if you switch models or characters and want to start fresh, or if analysis seems stuck on old data.
*   **Analyze Chat History:** A powerful tool. Click this to have Prose Polisher read your *entire* current chat history and build a list of all repetitive phrases. This is the fastest way to find slop unique to your current character/model. It performs periodic pattern analysis during the scan. Does *not* auto-generate rules.
*   **View Frequency Data:** Opens a popup showing a live leaderboard of the most-repeated phrases and detected patterns in your chat session based on the current frequency data. Useful for identifying potential slop manually.
*   **Generate AI Rules from Analysis:** After running a chat history analysis or letting the extension track messages for a while, click this to *manually* trigger the AI rule generation process for all currently identified slop candidates that haven't been processed yet.

---

**Project Gremlin Settings Section:**

This section lets you configure the multi-agent pipeline. Each role (Papa, Twins, Mama, Writer, Auditor) can be enabled/disabled (except Writer), and you can assign specific API configurations to them.

*   **Enable Project Gremlin:** This checkbox mirrors the chat UI toggle button. Use the button for quickly enabling/disabling per message; use the checkbox here for persistent state changes.
*   **[Role Name] (e.g., Papa Gremlin):** Checkbox to enable/disable this specific role's step in the pipeline (Writer is always active).
*   **API Display (`<API> / <Model>`):** Shows the currently configured API and Model for this role.
*   **Preset Dropdown:** Select a saved SillyTavern API preset (Temperature, Top P, etc.) for this role.
*   **Browse Presets Button (<i class="fa-solid fa-folder-open"></i>):** Opens the [Gremlin Preset Navigator](#the-gremlin-preset-navigator) to visually browse and select a preset from your saved ones.
*   **Select API & Model Button (<i class="fa-solid fa-satellite-dish"></i>):** Opens a popup to manually set the specific API (e.g., `openai`, `claude`, `google`, `openrouter`) and Model name for this role. Includes suggestions for common models suitable for the role's task.

Remember to configure the API/Model for *each* role you enable, otherwise that step may fail or use default ST settings if no configuration is found.

### The Regex Navigator

This is your command center for all regex rules (both static and dynamic). Access it via the "Open Regex Navigator" button in the settings.

*   **Static vs. Dynamic:** Rules are clearly marked with icons (<i class="fa-solid fa-database"></i> for Static, <i class="fa-solid fa-wand-magic-sparkles"></i> for Dynamic) and a label. Static rules (from the base `regex_rules.json` file) cannot be deleted or have their content edited via the UI, but they can be disabled. Dynamic rules (created by you or the AI) are fully editable and deletable.
*   **Enable/Disable:** Click the toggle icon (<i class="fa-solid fa-toggle-on"></i> / <i class="fa-solid fa-toggle-off"></i>) on the right to quickly turn any rule on or off. Disabled rules are not applied.
*   **Edit/View:** Click anywhere else on a rule row (except the toggle) to open the editor for that rule. For static rules, this is a read-only view. For dynamic rules, you can modify the name, regex, replacement, and disabled state.
*   **Create:** Click the "New Dynamic Rule" button in the footer to create a custom rule from scratch.
*   **New Rule Highlighting:** Newly AI-generated dynamic rules will have a pulsing glow around them, making them easy to spot after a rule generation run.

### The Gremlin Preset Navigator

This navigator is specific to the Project Gremlin settings. Access it via the <i class="fa-solid fa-folder-open"></i> button next to the Preset dropdowns in the Project Gremlin settings section.

*   Its purpose is solely to help you browse and select your existing SillyTavern API Presets to assign them to a specific Gremlin role's configuration.
*   It replicates the folder structure you use for saving presets in SillyTavern.
*   Click on folders to navigate. Click on a preset file (marked with <i class="fa-solid fa-file-lines"></i>) to select it. Double-clicking a preset selects it and closes the navigator.
*   Click the "Select Preset" button in the footer after selecting an item.
*   The selected preset will be automatically set in the corresponding Preset dropdown in the settings panel.

### AI Rule Generation in Action (Dynamic Regex)

This process requires both "Enable Dynamic AI Learning" and a functional API setup for the AI to generate rules (by default, this uses a specific Pollinations API endpoint, no additional setup needed unless you change the code).

1.  Enable "Enable Dynamic AI Learning" in the settings.
2.  Chat with your character as you normally would.
3.  As the AI repeats itself, Prose Polisher silently counts phrases in the background.
4.  Once a phrase is repeated enough times (`SLOP_THRESHOLD`), it becomes a slop candidate.
5.  Once the `Auto-Rule Gen Trigger` number of *additional* AI messages have passed (or you click "Generate AI Rules from Analysis"):
    *   Prose Polisher sends the slop candidates to the AI model.
    *   A toast notification will inform you that the AI is working.
6.  Once complete, new regex rules generated by the AI will be added to your dynamic rules. A success message will appear, and the new rules will be visible (and active!) in the Regex Navigator, highlighted with a glow.
7.  The newly added dynamic rules will automatically apply to subsequent AI messages and context, helping to fix the detected slop.

### Project Gremlin in Action

This process requires "Enable Project Gremlin" to be active (via the chat UI toggle or settings checkbox) and requires configuring the API/Model/Preset for the roles you want to use.

1.  Go to settings and configure the API/Model/Preset for the Gremlin roles (Papa, Twins, Mama, Writer, Auditor) you wish to enable. Enable the specific roles you want to use (e.g., Papa, Mama, Writer, Auditor).
2.  Ensure the "Enable Project Gremlin" toggle button next to the chat send button is active (<i class="fa-solid fa-hat-wizard active"></i> icon).
3.  Send your user message as usual.
4.  Instead of standard generation, the Project Gremlin pipeline will begin.
5.  You will see toast notifications indicating which Gremlin stage is currently running (e.g., "Papa Gremlin is drafting...", "The Twins are refining...", "Mama Gremlin is finalizing...", "Writer is crafting...", "Auditor is editing...").
6.  Each stage will use the API/Model/Preset configured in the settings for that role to perform its specific task, often involving internal `/gen` calls.
7.  The output of the final stage (Writer's prose or Auditor's edited text) will be injected into the prompt for SillyTavern's standard generation engine, and the API/Model/Preset for that final stage will be used for this last step.
8.  The final, multi-agent-guided response will appear in the chat. The Gremlin toggle remains active for the next message unless you turn it off. The generation environment is reset for the *next* message.

---

## For Power Users

### Manually Adding Static Rules

If you have a set of regex fixes you always want to use, and want them managed by the extension but not editable via the UI, you can add them to the core ruleset.

1.  Navigate to `/public/scripts/extensions/third-party/ProsePolisher/`.
2.  Open `regex_rules.json` in a text editor.
3.  Add your new rule object to the JSON array, following the existing format. A valid rule requires an `id` (ensure uniqueness, maybe use a static prefix like `STATIC_999`), `scriptName`, `findRegex`, `replaceString`, `disabled` (boolean), and crucially, `isStatic: true`.
    ```json
    {
        "id": "STATIC_999",
        "scriptName": "Slopfix - My Custom Fix",
        "findRegex": "\\b([Hh]e|[Ss]he) let out a breath (?:[Hh]e|[Ss]he) didn't know (?:[Hh]e|[Ss]he) was holding\\b",
        "replaceString": "{{random:$1 exhaled sharply,A sigh escaped $1 lips,with a sudden release of breath}}",
        "disabled": false,
        "isStatic": true
    }
    ```
4.  Restart SillyTavern for the new static rules to be loaded. These will appear in the Regex Navigator as static rules.

### Understanding the Dynamic Regex AI Prompt

Curious how the AI generates dynamic regex rules? The extension uses a detailed system prompt to instruct the LLM (by default, `deepseek-reasoning` via Pollinations API). You can find the full prompt within `content.js` inside the `generateAndSaveDynamicRules` function. This allows you to see the exact instructions the AI follows and even modify them if you wish to experiment with different AI models or styles for rule generation. Remember that changing the target API/Model requires code modification within `generateAndSaveDynamicRules`.

### Understanding Project Gremlin's Internal Mechanics

Project Gremlin operates by leveraging SillyTavern's internal slash command execution.

1.  When you enable Project Gremlin and send a message, the `onUserMessageRendered` event listener intercepts the flow *before* SillyTavern's default generation process begins.
2.  It sets the `isPipelineRunning` flag to `true`.
3.  For the planning stages (Papa, Twins, Mama) and potentially the internal Writer stage (if Auditor is on), it calls `applyGremlinEnvironment(role)` which executes `/preset "Name"`, `/api <name>`, and `/model "<name>" source_field=<source>` slash commands to temporarily set the *global* SillyTavern generation environment for that internal call. It then uses `executeGen(promptText)`, which is essentially executing `/gen "promptText" |`. The pipe `|` captures the output without displaying it in chat.
4.  The `onBeforeGeneration` event listener checks the `isPipelineRunning` flag. If true, it knows this `/gen` call is part of the internal pipeline and allows it to proceed by returning `undefined`.
5.  After the internal stages complete, the final output (blueprint synthesis or edited prose) is prepared.
6.  The *last* active stage (Writer if Auditor is off, Auditor if Auditor is on) has its environment applied via `applyGremlinEnvironment(role)`. This sets the API/Model/Preset for the *final* generation.
7.  The final output is injected into the chat context using `/inject id=... position=chat depth=0 "..."`.
8.  The `onUserMessageRendered` handler finishes. Because it didn't explicitly call `Generate()`, SillyTavern's core logic then proceeds with its *standard* generation trigger, but now using the environment set by the last Gremlin stage and including the injected prompt instruction.
9.  After this final generation completes, the `finally` block in `onUserMessageRendered` sets `isPipelineRunning` back to `false` and calls `context.reloadGenerationSettings()`, which restores the API, Model, and Preset that were active *before* the pipeline started for this message.

This intricate dance allows the extension to temporarily hijack the generation flow, run custom multi-step AI calls, and then hand off to SillyTavern's built-in generation using the refined output and a specific environment.

### Whitelist and Blacklist Details

These lists provide fine-grained control over the dynamic frequency analysis process.

*   **Whitelist:** Phrases containing *any* word from this list (case-insensitive, whole word match) are *skipped entirely* by the frequency counter. This prevents common chat phrases, character names, or other intentionally repeated words from being flagged as slop candidates. The default whitelist includes many common English words. You can add more words via the manager popup.
*   **Blacklist:** Phrases containing *any* word from this list (case-insensitive, whole word match) receive a frequency "boost". When a phrase with a blacklisted word is encountered, its count is increased by `SLOP_THRESHOLD`. This makes phrases containing blacklisted words hit the threshold faster, prioritizing them for AI rule generation. Useful for known AI crutch words like "suddenly", "began to", "just", "quite", etc. You can add words via the manager popup.

---

## Troubleshooting & FAQ

*   **Q: The AI-generated regex rules aren't very good!**
    *   **A:** The quality depends heavily on the LLM used for generation (`deepseek-reasoning` by default) and the prompt provided to it. You can **edit or delete any bad rule** via the [Regex Navigator](#the-regex-navigator). For more advanced control, you can [modify the system prompt in `content.js`](#understanding-the-dynamic-regex-ai-prompt) or attempt to change the target API/Model for rule generation (requires code changes).
*   **Q: The Dynamic AI Learning isn't doing anything.**
    *   **A:** Make sure "Enable Dynamic AI Learning" is checked in settings. Remember that it takes *several repetitions* of a phrase (`SLOP_THRESHOLD`, default 3) before it's even considered a slop candidate. After that, it waits for the `Auto-Rule Gen Trigger` number of *additional* AI messages. Try using the "Analyze Chat History" button to quickly populate frequency data, then "Generate AI Rules from Analysis" to force the process. Check the "View Frequency Data" popup to see if phrases are being tracked and counted.
*   **Q: Project Gremlin isn't running when I send a message.**
    *   **A:** Check the toggle button next to the chat send button – is the wizard hat icon pulsing and colored (active)? If not, click it. You can also check the "Enable Project Gremlin" checkbox in settings. Ensure that the API and Model are configured for at least the Writer Gremlin role in the settings, as this stage is always active and needed for the final generation step.
*   **Q: Project Gremlin starts but one of the stages fails or gives a weird error.**
    *   **A:** This usually indicates an issue with the API/Model configured for that specific Gremlin role.
        *   Check the API/Model names in the settings against what your chosen API provider actually offers and what is currently configured in SillyTavern's API settings. Typo's are common!
        *   Ensure the API key is correct and the API provider is selected correctly in SillyTavern's main API settings.
        *   Check the browser console (F12) for specific error messages from `projectgremlin.js`. Errors like "Failed to execute setup script..." or "Failed to produce a blueprint/response" point to issues with the LLM call for that stage.
*   **Q: I see rules marked (PP) in the standard Regex Processor UI, but I can't edit them there.**
    *   **A:** This is intentional. Prose Polisher's regex rules are managed exclusively within its own **[Regex Navigator](#the-regex-navigator)** to keep the standard Regex Processor UI clean and avoid confusion. Always use the Prose Polisher Navigator to manage its rules.
*   **Q: My normal API/Model settings seem to change after using Project Gremlin.**
    *   **A:** This is expected behavior for the message generated *by* Project Gremlin, as the pipeline sets the API/Model/Preset of the *last* stage (Writer or Auditor) for the final generation step via slash commands. However, after the generation is complete, Prose Polisher *should* restore the API/Model/Preset that was active *before* the pipeline started for that message. If this isn't happening, it might be a bug, but usually, the settings will revert for the *next* user message. You can always manually re-select your desired API/Model/Preset in SillyTavern's main UI.

---

## Contributing

Feedback, bug reports, and pull requests are welcome!

1.  **Suggestions & Bug Reports:** Please open an issue on the GitHub repository, providing as much detail as possible (SillyTavern version, API/Model used, steps to reproduce, console errors).
2.  **New Static Rules:** If you have a high-quality regex for a common cliché or repetitive pattern found in AI writing, feel free to open a pull request to add it to the `regex_rules.json` file for everyone to use. Please follow the existing format and include at least 5 creative, grammatically seamless replacement options.

---

## License

[Specify your license here, e.g., MIT] (The provided code doesn't specify a license, so you should add one)

---
--- END OF FILE README.md (Updated) ---

This updated README.md covers the Static and Dynamic regex features, the Project Gremlin pipeline, the navigators, and the whitelist/blacklist, explaining how they work and how to use them via the settings panel and chat UI. It also adds relevant sections for power users and troubleshooting.

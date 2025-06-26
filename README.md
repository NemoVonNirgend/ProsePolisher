***

## Prose Polisher: A Complete User Guide

Welcome to Prose Polisher! This guide will walk you through every feature, helping you transform your AI's writing from repetitive to remarkable.

### Table of Contents
1.  **[Introduction: What Does This Do?](#1-introduction-what-does-this-do)**
2.  **[Part 1: The Basics - First-Time Setup](#2-part-1-the-basics---first-time-setup)**
3.  **[Part 2: The Analyzer - Your Slop-Fighting Toolkit](#3-part-2-the-analyzer---your-slop-fighting-toolkit)**
4.  **[Part 3: The Regex Navigator - Your Command Center](#4-part-3-the-regex-navigator---your-command-center)**
5.  **[Part 4: Project Gremlin - The Ultimate AI Writing Pipeline](#5-part-4-project-gremlin---the-ultimate-ai-writing-pipeline)**
6.  **[Part 5: Common Workflows](#6-part-5-common-workflows)**

---

### 1. Introduction: What Does This Do?

Prose Polisher is a two-pronged tool designed to dramatically improve AI writing quality:

*   **The Regex Polisher:** It finds and replaces common, repetitive, or clichéd phrases (which we call "slop") with more creative and varied alternatives. It does this through a combination of a pre-made list of fixes and an AI that learns the *specific* bad habits of your model and creates new fixes on the fly.
*   **Project Gremlin:** An advanced, experimental, multi-AI pipeline that acts like a team of writers and editors. It meticulously plans, refines, and audits the AI's response *before* it's written, resulting in unparalleled quality, coherence, and creativity.

Let's dive into how to use it.

### 2. Part 1: The Basics - First-Time Setup

Find the **Prose Polisher (Regex + AI)** dropdown in your Extensions settings panel.

1.  **Enable Static Regex Fixes:**
    *   **What it is:** This switch activates over 50 hand-crafted rules that fix the most common writing clichés (e.g., "his heart hammered," "she bit her lip," "a smirk tugged at his lips").
    *   **How to use it:** **Check this box.** This is the foundational layer of the extension and provides immediate quality improvements.

2.  **Enable Dynamic AI Learning:**
    *   **What it is:** This is the "smart" part of the extension. When active, it reads the AI's messages, identifies new, unique repetitive phrases, and uses an AI to automatically generate new rules to fix them.
    *   **How to use it:** **Check this box.** This allows the extension to adapt and learn the specific bad habits of your current AI model.

3.  **Integrate with Global Regex:**
    *   **What it is:** This setting pushes all active Prose Polisher rules into SillyTavern's main regex engine. This is how the fixes are applied to the chat and context.
    *   **How to use it:** **Keep this box checked (Recommended).** If you turn this off, none of the fixes will be applied. After changing this setting, a "Reload to apply?" prompt will appear; click "Reload Now".

4.  **Auto-Rule Gen Trigger:**
    *   **What it is:** After the analyzer identifies a new repetitive phrase, this number determines how many *more* AI messages to wait before it automatically tries to generate a fix.
    *   **How to use it:** The default (e.g., 30) is fine for most users. A lower number means faster (but more frequent) AI rule generation. A higher number will batch more candidates together for a single, larger generation task.

### 3. Part 2: The Analyzer - Your Slop-Fighting Toolkit

This set of buttons gives you manual control over the AI learning process.

*   **Analyze Chat History**
    *   **What it is:** Reads your *entire* current chat history in one go to find all repetitive phrases. This is the fastest way to identify slop.
    *   **How to use it:**
        1.  Click the button. A toast notification will say the analysis has started.
        2.  Wait for the "Analysis complete" notification.
        3.  The system now knows about all the repeated phrases. You can now use "Generate AI Rules" (see below) to fix them.

*   **View Frequency Data**
    *   **What it is:** Opens a popup showing a live leaderboard of the most-repeated phrases and patterns the analyzer has found, ranked by a "Slop Score."
    *   **How to use it:** Click this at any time to see what phrases the AI is overusing. Phrases in **bold orange** are smart patterns the analyzer has detected (e.g., it grouped "his face paled" and "his knuckles whitened" into a pattern).

*   **Generate AI Rules from Analysis**
    *   **What it is:** This is the manual trigger for the AI rule-generation process. It takes all the slop candidates found so far and sends them to an LLM to create regex fixes.
    *   **How to use it:**
        1.  After a chat session or after using "Analyze Chat History," click this button.
        2.  A series of toast notifications will appear, informing you that the "Twins" are pre-screening candidates and the "Writer/Mama/etc." is generating rules.
        3.  When it's done, you'll get a success message. Any newly created rules are now active and can be seen in the Regex Navigator.

*   **Manage Whitelist**
    *   **What it is:** A list of words the analyzer should **ignore**. This is perfect for character names, place names, or common words you don't want to be flagged as repetitive.
    *   **How to use it:**
        1.  Click the button to open the manager.
        2.  Type a word (e.g., "Kael", "Eldoria") into the input box and click "Add".
        3.  The word is now ignored by the frequency analysis.

*   **Manage Blacklist**
    *   **What it is:** A list of "banned" words and a corresponding weight (1-10). Any phrase containing a blacklisted word gets a huge penalty, making it much more likely to be flagged as slop. This is great for words you truly despise (e.g., "suddenly," "began to").
    *   **How to use it:**
        1.  Click the button.
        2.  Type a word or phrase (e.g., "suddenly") into the input box.
        3.  Set a weight (a higher weight means a bigger penalty).
        4.  Click "Add".

*   **Clear Frequency Data**
    *   **What it is:** Resets the analyzer's memory.
    *   **How to use it:** Click this when you start a new chat, switch characters, or change AI models to ensure the analysis starts fresh.

*   **Regex Generation Controls**
    *   **Regex Generation Method:** Choose between "Single Gremlin" (one AI call for a batch of rules) or "Iterative Twins" (a more complex, back-and-forth process for potentially higher quality but slower generation). "Single Gremlin" is a great starting point.
    *   **Using Gremlin / Twin Refinement Cycles:** These dropdowns let you choose which Gremlin's API settings to use for rule generation or how many cycles the Twins should perform. You can generally leave these on their defaults unless you become a power user.
    *   **Edit Regex Gen Prompt:** This opens an editor for the master prompt used to generate regex. **For advanced users only.**
    *   **Skip Triage/Twin Check:** Bypasses the AI's pre-screening step. This is faster but may result in the AI trying to generate rules for nonsensical phrases.

### 4. Part 3: The Regex Navigator - Your Command Center

Click the **"Open Regex Navigator"** button to access the heart of the extension. This is where you manage all rules.

*   **The Rule List:**
    *   The main view shows all static and dynamic rules.
    *   <i class="fa-solid fa-database"></i> **Static Rules:** These are built-in. You cannot edit their content, but you can disable them.
    *   <i class="fa-solid fa-wand-magic-sparkles"></i> **Dynamic Rules:** These are created by the AI or you. They are fully editable.
    *   **Disabled rules** will be greyed out. **Newly added AI rules** will have a colored border so you can easily review them.

*   **Managing a Rule:**
    *   **Toggle On/Off:** Click the toggle icon (<i class="fa-solid fa-toggle-on"></i> / <i class="fa-solid fa-toggle-off"></i>) on the right of any rule to enable or disable it instantly.
    *   **Edit a Rule:** Click anywhere on a dynamic rule's entry to open the editor. Here you can change its name, the "find" regex, and the "replace" string.
    *   **Delete a Rule:** In the editor for a dynamic rule, click the "Delete Rule" button.
    *   **Create a New Rule:** Click the `+ New Dynamic Rule` button at the bottom of the navigator. This opens a blank editor for you to create your own custom fix.

### 5. Part 4: Project Gremlin - The Ultimate AI Writing Pipeline

Project Gremlin is for when you want the absolute highest quality response and don't mind the extra time and API cost. It's a team of specialized AIs that plan the next response.

*   **Enabling Project Gremlin:**
    *   In the chat input bar, you will see a new **Wizard Hat icon** (<i class="fa-solid fa-hat-wizard"></i>).
    *   **Click this button to toggle the pipeline.** When it's active (glowing), it will run automatically on your *next* message send. The toggle in the settings panel will reflect this state.

*   **The Gremlin Roles & Their Configuration:**
    Each Gremlin has its own configuration block. They all follow the same pattern:

    1.  **Enable/Disable Checkbox:** Turn this role on or off within the pipeline.
    2.  **Preset Dropdown:** Select a SillyTavern parameter preset (for temperature, top_p, etc.) for this Gremlin.
    3.  **Browse Button (<i class="fa-solid fa-folder-open"></i>):** Opens a file-browser style popup (**Preset Navigator**) to visually select a preset.
    4.  **API Button (<i class="fa-solid fa-satellite-dish"></i>):** This is the most important button. It opens a popup where you can assign a specific API (OpenAI, Claude, OpenRouter, etc.) and Model for that Gremlin.
    5.  **Instructions Button (<i class="fa-solid fa-file-pen"></i>):** Opens a large text editor where you can view and edit the master prompt for that Gremlin.

Here's what each Gremlin does:

*   **<i class="fa-solid fa-chess-king"></i> Papa Gremlin (The Architect):**
    *   **Role:** Reads the entire chat history and creates a high-level "blueprint" for the next response. It focuses on plot progression, character consistency, and emotional beats.
    *   **Recommended Model:** A high-intelligence model (e.g., GPT-4, Claude Opus).

*   **<i class="fa-solid fa-users"></i> Twin Gremlins (The Refiners):**
    *   **Role:** A duo (Vex & Vax) that brainstorms creative ideas based on Papa's blueprint. Vex focuses on character emotion and depth, while Vax focuses on plot, action, and world-building.
    *   **Recommended Model:** A fast, creative model (e.g., Gemini Flash, Hermes).
    *   **Refinement Iterations:** Controls how many ideas each Twin generates. The default of 3 (6 total calls) is a good balance.

*   **<i class="fa-solid fa-crown"></i> Mama Gremlin (The Supervisor):**
    *   **Role:** Takes Papa's blueprint and the Twins' chaotic ideas, then synthesizes them into a single, polished, and rule-compliant final blueprint. She is the quality control manager.
    *   **Recommended Model:** A balanced model that's good at following complex instructions (e.g., GPT-4-Turbo, Claude Sonnet).

*   **<i class="fa-solid fa-pen-fancy"></i> Writer Gremlin (The Author):**
    *   **Role:** This Gremlin is **always active** when the pipeline runs. It takes the final blueprint from Mama and writes the actual character response.
    *   **Recommended Model:** Your favorite creative roleplaying model.

*   **<i class="fa-solid fa-user-shield"></i> Auditor Gremlin (The Editor):**
    *   **Role:** An optional final step. If enabled, the Auditor receives the Writer's complete response and does a final line-edit to polish the prose, fix grammar, and enhance impact.
    *   **Recommended Model:** A high-quality model with strong editing skills (e.g., GPT-4, Claude Opus).

### 6. Part 5: Common Workflows

#### Workflow 1: Fixing a New, Annoying Phrase

1.  You notice your AI keeps saying "a cold shiver ran down her spine."
2.  Go to the Prose Polisher settings and click **"Analyze Chat History."**
3.  Wait for the analysis to complete.
4.  Click **"Generate AI Rules from Analysis."**
5.  Wait for the AI to work. You'll get a toast saying new rules have been created.
6.  Click **"Open Regex Navigator."** You will see a new, highlighted rule named something like "Slopfix - Shivering Spine." You can click to view or edit its replacement options.
7.  The next time the AI tries to write that phrase, it will be automatically replaced with a more creative alternative.

#### Workflow 2: Getting a "Perfect" Response

1.  You're at a critical point in the story and want a high-quality, long, and creative response from the AI.
2.  In the Prose Polisher settings, configure your Gremlins. For example, assign Claude Opus to Papa, Gemini Flash to the Twins, and your best RP model to the Writer.
3.  In the chat box, click the **Wizard Hat icon** (<i class="fa-solid fa-hat-wizard"></i>) to activate the pipeline for the next message. The icon will glow.
4.  Type your message and hit send.
5.  Watch the toast notifications as Papa, the Twins, and Mama do their work. This will take longer than a normal generation.
6.  The final, high-quality response appears in the chat, crafted by the entire Gremlin team. The wizard hat will deactivate, ready for the next time you need it.

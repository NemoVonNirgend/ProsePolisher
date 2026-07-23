export const DEFAULT_SETTINGS = {
    isStaticEnabled: true,
    isDynamicEnabled: true,
    integrateWithGlobalRegex: true,
    dynamicTriggerCount: 30,
    regexGenerationInstructions: '',
    skipTriageCheck: false,
    autoActivateGeneratedRules: false,
    slopThreshold: 5,
    leaderboardUpdateCycle: 10,
    pruningCycle: 20,
    ngramMax: 7,
    patternMinCommon: 2,
    blacklist: {
        ozone: 3,
        whisper: 3,
        shivers: 3,
        obsidian: 3,
        'white knuckles': 3,
        'head ducked': 3,
    },
};

export function normalizeSettings(existingSettings = {}) {
    return {
        ...DEFAULT_SETTINGS,
        ...existingSettings,
        blacklist: {
            ...DEFAULT_SETTINGS.blacklist,
            ...(existingSettings.blacklist || {}),
        },
    };
}

function bindCheckbox(id, initialValue, onChange) {
    const element = document.getElementById(id);
    if (!element) return;
    element.checked = Boolean(initialValue);
    element.addEventListener('change', () => onChange(element.checked));
}

function bindNumber(id, initialValue, { min, max, integer = false }, onChange) {
    const element = document.getElementById(id);
    if (!element) return;
    element.value = initialValue;
    element.addEventListener('input', () => {
        const value = integer
            ? Number.parseInt(element.value, 10)
            : Number.parseFloat(element.value);
        if (!Number.isFinite(value) || value < min || (max !== undefined && value > max)) return;
        onChange(value);
    });
}

function bindButton(id, handler) {
    document.getElementById(id)?.addEventListener('pointerup', handler);
}

export function bindSettingsUi({
    settings,
    analyzer,
    navigator,
    saveSettings,
    updateGlobalRegex,
    hideGlobalRules,
    showReloadPrompt,
    showPromptEditor,
}) {
    bindCheckbox('prose_polisher_enable_global_regex', settings.integrateWithGlobalRegex, async value => {
        settings.integrateWithGlobalRegex = value;
        saveSettings();
        await updateGlobalRegex();
        hideGlobalRules();
        showReloadPrompt();
    });
    bindCheckbox('prose_polisher_enable_static', settings.isStaticEnabled, async value => {
        settings.isStaticEnabled = value;
        saveSettings();
        await updateGlobalRegex();
        showReloadPrompt();
    });
    bindCheckbox('prose_polisher_enable_dynamic', settings.isDynamicEnabled, async value => {
        settings.isDynamicEnabled = value;
        if (!value) analyzer.messageCounterForTrigger = 0;
        saveSettings();
        await updateGlobalRegex();
        showReloadPrompt();
    });
    bindCheckbox('pp_skip_triage_check', settings.skipTriageCheck, value => {
        settings.skipTriageCheck = value;
        saveSettings();
    });
    bindCheckbox('pp_auto_activate_generated_rules', settings.autoActivateGeneratedRules, value => {
        settings.autoActivateGeneratedRules = value;
        saveSettings();
    });

    bindNumber(
        'prose_polisher_dynamic_trigger',
        settings.dynamicTriggerCount,
        { min: 1, integer: true },
        value => {
            settings.dynamicTriggerCount = value;
            saveSettings();
        },
    );
    bindNumber('prose_polisher_slop_threshold', settings.slopThreshold, { min: 1 }, value => {
        settings.slopThreshold = value;
        saveSettings();
    });
    bindNumber(
        'prose_polisher_leaderboard_update_cycle',
        settings.leaderboardUpdateCycle,
        { min: 1, integer: true },
        value => {
            settings.leaderboardUpdateCycle = value;
            saveSettings();
        },
    );
    bindNumber(
        'prose_polisher_pruning_cycle',
        settings.pruningCycle,
        { min: 5, integer: true },
        value => {
            settings.pruningCycle = value;
            saveSettings();
        },
    );
    bindNumber(
        'prose_polisher_ngram_max',
        settings.ngramMax,
        { min: 3, max: 20, integer: true },
        value => {
            settings.ngramMax = value;
            saveSettings();
        },
    );
    bindNumber(
        'prose_polisher_pattern_min_common',
        settings.patternMinCommon,
        { min: 2, max: 10, integer: true },
        value => {
            settings.patternMinCommon = value;
            saveSettings();
        },
    );

    bindButton('prose_polisher_open_navigator_button', () => navigator.open());
    bindButton('prose_polisher_analyze_chat_button', () => analyzer.manualAnalyzeChatHistory());
    bindButton('prose_polisher_view_frequency_button', () => analyzer.showFrequencyLeaderboard());
    bindButton(
        'prose_polisher_generate_rules_button',
        () => analyzer.handleGenerateRulesFromAnalysisClick(settings.dynamicRules, navigator),
    );
    bindButton('prose_polisher_manage_whitelist_button', () => analyzer.showWhitelistManager());
    bindButton('prose_polisher_manage_blacklist_button', () => analyzer.showBlacklistManager());
    bindButton('prose_polisher_clear_frequency_button', () => analyzer.clearFrequencyData());
    bindButton('prose_polisher_edit_regex_gen_prompt_button', showPromptEditor);
}

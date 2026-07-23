import {
    normalizeRule,
    parseAlternatives,
    previewRule,
    validateRule,
} from './rule-utils.js';

export class RuleNavigator {
    constructor({
        callPopup,
        popupType,
        toastr,
        isReady,
        getChat,
        getStaticRules,
        getDynamicRules,
        persistDynamicRules,
        updateGlobalRegex,
        showReloadPrompt,
        ruleIdPrefix,
    }) {
        this.callPopup = callPopup;
        this.popupType = popupType;
        this.toastr = toastr;
        this.isReady = isReady;
        this.getChat = getChat;
        this.getStaticRules = getStaticRules;
        this.getDynamicRules = getDynamicRules;
        this.persistDynamicRules = persistDynamicRules;
        this.updateGlobalRegex = updateGlobalRegex;
        this.showReloadPrompt = showReloadPrompt;
        this.ruleIdPrefix = ruleIdPrefix;
    }

    async open() {
        if (!this.isReady()) {
            this.toastr.info('SillyTavern is still loading, please wait.');
            return;
        }

        this.getDynamicRules().forEach(rule => delete rule.isNew);
        const container = document.createElement('div');
        container.className = 'prose-polisher-navigator-content';
        container.id = 'prose-polisher-navigator-content-id';
        container.innerHTML = `
            <div class="modal-header"><h2>Regex Rule Navigator</h2></div>
            <div class="navigator-body">
                <div class="navigator-main-panel"><div id="regex-navigator-list-view"></div></div>
            </div>
            <div class="modal-footer">
                <button id="prose-polisher-new-rule-btn" class="menu_button">
                    <i class="fa-solid fa-plus"></i> New Dynamic Rule
                </button>
            </div>`;

        this.renderRuleList(container);
        container.querySelector('#prose-polisher-new-rule-btn')
            .addEventListener('pointerup', () => this.openRuleEditor(null));
        this.callPopup(
            container,
            this.popupType.DISPLAY,
            'Regex Rule Navigator',
            { wide: true, large: true, addCloseButton: true },
        );
    }

    renderRuleList(container = null) {
        if (!this.isReady()) return;
        const modalContent = container || document.getElementById('prose-polisher-navigator-content-id');
        if (!modalContent) return;

        const listView = modalContent.querySelector('#regex-navigator-list-view');
        listView.replaceChildren();
        const dynamicRules = [...this.getDynamicRules()].sort(
            (a, b) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
                (a.scriptName || '').localeCompare(b.scriptName || ''),
        );
        const allRules = [...this.getStaticRules(), ...dynamicRules];

        if (allRules.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'pp-empty-rules';
            empty.textContent = 'No rules defined.';
            listView.appendChild(empty);
            return;
        }

        for (const rule of allRules) {
            listView.appendChild(this.createRuleListItem(rule));
        }
    }

    createRuleListItem(rule) {
        const item = document.createElement('div');
        item.className = 'regex-navigator-item';
        item.classList.toggle('is-dynamic', !rule.isStatic);
        item.classList.toggle('is-disabled', Boolean(rule.disabled));
        item.classList.toggle('is-newly-added', Boolean(rule.isNew));

        const fallbackName = (rule.scriptName || `rule_${Date.now()}`).replace(/\s+/g, '_');
        rule.id ||= `${this.ruleIdPrefix}${fallbackName}`;
        item.dataset.id = rule.id;

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
        item.addEventListener('pointerup', event => {
            if (event.target.closest('.status-toggle-icon')) {
                this.toggleRuleStatus(rule.id);
            } else {
                this.openRuleEditor(rule.id);
            }
        });
        return item;
    }

    findRule(ruleId) {
        return this.getDynamicRules().find(rule => rule.id === ruleId) ||
            this.getStaticRules().find(rule => rule.id === ruleId);
    }

    async toggleRuleStatus(ruleId) {
        if (!this.isReady()) return;
        const rule = this.findRule(ruleId);
        if (!rule) {
            console.warn(`[ProsePolisher:RuleNavigator] Rule not found: ${ruleId}`);
            return;
        }

        rule.disabled = !rule.disabled;
        if (!rule.isStatic) this.persistDynamicRules();
        this.renderRuleList();
        await this.updateGlobalRegex();
        this.toastr.success(`Rule "${rule.scriptName}" ${rule.disabled ? 'disabled' : 'enabled'}.`);
    }

    createEditor(rule) {
        const editor = document.createElement('div');
        editor.className = 'prose-polisher-rule-editor-popup';
        editor.dataset.ruleId = rule.id;
        editor.innerHTML = `
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
                <div class="actions-left">
                    <label class="checkbox_label">
                        <input type="checkbox" id="pp_editor_disabled" ${rule.disabled ? 'checked' : ''}>
                        <span>Disabled</span>
                    </label>
                </div>
                ${rule.isStatic ? '' : '<button id="pp_editor_delete" class="menu_button is_dangerous">Delete Rule</button>'}
            </div>`;

        editor.querySelector('#pp_editor_name').value = rule.scriptName || '';
        editor.querySelector('#pp_editor_find').value = rule.findRegex || '';
        editor.querySelector('#pp_editor_alternatives').value = parseAlternatives(rule).join('\n');
        return editor;
    }

    previewEditorRule(editor) {
        const candidate = normalizeRule({
            scriptName: editor.querySelector('#pp_editor_name').value,
            findRegex: editor.querySelector('#pp_editor_find').value,
            alternatives: editor.querySelector('#pp_editor_alternatives').value
                .split('\n')
                .map(value => value.trim())
                .filter(Boolean),
        });
        const chatText = (this.getChat() || [])
            .filter(message => !message.is_user)
            .map(message => message.mes || '')
            .join('\n\n');
        const preview = previewRule(chatText, candidate);
        const validation = editor.querySelector('#pp_editor_validation');
        const results = editor.querySelector('#pp_editor_preview_results');
        validation.textContent = preview.valid
            ? `${preview.examples.length} example match${preview.examples.length === 1 ? '' : 'es'} found.`
            : preview.errors.join(' ');
        validation.classList.toggle('is-valid', preview.valid);
        validation.classList.toggle('is-invalid', !preview.valid);
        results.replaceChildren();

        for (const example of preview.examples) {
            const card = document.createElement('div');
            card.className = 'pp-rule-preview-card';
            const before = document.createElement('div');
            const after = document.createElement('div');
            before.textContent = `Before: ${example.before}`;
            after.textContent = `After: ${example.after}`;
            card.append(before, after);
            results.appendChild(card);
        }
    }

    async openRuleEditor(ruleId) {
        if (!this.isReady()) {
            this.toastr.info('SillyTavern is still loading, please wait.');
            return;
        }

        const isNew = ruleId === null;
        const rule = isNew
            ? {
                id: `DYN_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                scriptName: '',
                findRegex: '',
                alternatives: [],
                replaceString: '',
                disabled: true,
                isStatic: false,
                isNew: true,
            }
            : this.findRule(ruleId);
        if (!rule) return;

        const editor = this.createEditor(rule);
        editor.querySelector('#pp_editor_preview')
            .addEventListener('pointerup', () => this.previewEditorRule(editor));
        editor.querySelector('#pp_editor_delete')?.addEventListener('pointerup', async event => {
            event.stopPropagation();
            if (await this.callPopup('Are you sure you want to delete this rule?', this.popupType.CONFIRM)) {
                await this.handleDelete(rule.id);
                editor.closest('.popup_confirm')?.querySelector('.popup-button-cancel')?.click();
            }
        });

        const confirmed = await this.callPopup(
            editor,
            this.popupType.CONFIRM,
            isNew ? 'Create New Rule' : 'Edit Rule',
            { wide: true, large: true },
        );
        if (!confirmed) return;

        rule.disabled = editor.querySelector('#pp_editor_disabled').checked;
        if (!rule.isStatic) {
            const normalized = normalizeRule({
                ...rule,
                scriptName: editor.querySelector('#pp_editor_name').value.trim(),
                findRegex: editor.querySelector('#pp_editor_find').value.trim(),
                alternatives: editor.querySelector('#pp_editor_alternatives').value
                    .split('\n')
                    .map(value => value.trim())
                    .filter(Boolean),
            });
            const validation = validateRule(normalized);
            if (!validation.valid) {
                this.toastr.error(validation.errors.join(' '));
                return;
            }
            Object.assign(rule, normalized);
        }

        if (isNew) this.getDynamicRules().push(rule);
        if (!rule.isStatic) this.persistDynamicRules();
        this.renderRuleList();
        await this.updateGlobalRegex();
        this.toastr.success(isNew ? 'New rule created.' : 'Rule updated.');
        this.showReloadPrompt();
    }

    async handleDelete(ruleId) {
        const dynamicRules = this.getDynamicRules();
        const index = dynamicRules.findIndex(rule => rule.id === ruleId);
        if (index === -1) return;

        dynamicRules.splice(index, 1);
        this.persistDynamicRules();
        this.renderRuleList();
        await this.updateGlobalRegex();
        this.toastr.success('Dynamic rule deleted.');
        this.showReloadPrompt();
    }
}

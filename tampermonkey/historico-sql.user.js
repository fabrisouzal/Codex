// ==UserScript==
// @name         Histórico SQL
// @namespace    http://tampermonkey.net/
// @version      2026-06-05.01
// @description  Histórico de queries com favoritos, etiquetas, comentários, export/import e painel de configurações
// @match        http://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @match        https://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/historico-sql.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/historico-sql.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* global CodeMirror */

(function () {
    'use strict';

    if (window.__SQL_HELPER_HISTORY_V13_INITIALIZED__) {
        console.warn('[SQL Helper] Script já inicializado.');
        return;
    }
    window.__SQL_HELPER_HISTORY_V13_INITIALIZED__ = true;

    /********************************************************************
     * STORAGE KEYS
     ********************************************************************/

    const HISTORY_STORAGE_KEY = 'sql_helper_history_execucao_direta_v6_export_import';
    const SETTINGS_STORAGE_KEY = 'sql_helper_execucao_direta_settings_v3';
    const UI_STATE_STORAGE_KEY = 'sql_helper_execucao_direta_ui_state_v1';
    const RECENT_SEARCHES_KEY = 'sql_helper_recent_searches_v1';
    const SETTINGS_SCHEMA_VERSION = 1;
    const HISTORY_RENDER_LIMIT = 250;

    /********************************************************************
     * DEFAULTS
     ********************************************************************/

    const DEFAULT_SETTINGS = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        capture: {
            autoSaveEnabled: true,
            captureOnRunButton: true,
            captureOnCtrlEnter: true,
            ignoreConsecutiveDuplicates: true
        },
        history: {
            maxItems: 99999999,
            recentSearchesMax: 8,
            commentMaxLength: 600
        },
        interface: {
            panelWidth: 430,
            theme: 'office',
            cardsExpandedByDefault: false,
            showRunCount: true,
            showIcons: true
        }
    };

    const SELECTORS = {
        runButton: [
            '#btnexecutar',
            '#btnExecutar',
            "input[id*='btnExecutar']",
            "input[id*='btnexecutar']",
            "button[id*='btnExecutar']",
            "button[id*='btnexecutar']",
            "input[type='submit'][value*='Executar']",
            "input[type='button'][value*='Executar']",
            "button[type='submit']"
        ],
        sqlEditor: '#edtdeclaracao, #txtSql, textarea[name*="edtdeclaracao"], textarea[name*="txtSql"]'
    };

    const state = {
        panel: null,
        listContainer: null,
        searchInput: null,
        searchClearBtn: null,
        searchSuggestionsBox: null,
        favoritesOnlyCheckbox: null,
        footerInfo: null,
        tagFilterSelect: null,
        sortSelect: null,
        toggleBtnRef: null,
        selectedHistoryItemId: null,

        commentOverlay: null,
        commentTextarea: null,
        commentPreview: null,
        currentCommentItemId: null,

        exportOverlay: null,
        exportImportFileInput: null,
        importModeMergeRadio: null,
        importModeReplaceRadio: null,

        settingsOverlay: null,
        tagsOverlay: null,
        tagsListContainer: null,

        hookedRunButton: null,
        mutationObserver: null,
        hookRunButtonTimer: null
    };

    const StorageService = {
        getJson(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? safeJsonParse(raw, fallback) : fallback;
            } catch {
                return fallback;
            }
        },
        setJson(key, value, label = 'dados') {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                console.error(`[SQL Helper] Erro ao salvar ${label}:`, e);
                return false;
            }
        },
        migrateSettings(settings) {
            const migrated = settings && typeof settings === 'object' ? { ...settings } : {};
            if (!migrated.schemaVersion || migrated.schemaVersion < SETTINGS_SCHEMA_VERSION) {
                migrated.schemaVersion = SETTINGS_SCHEMA_VERSION;
            }
            return migrated;
        }
    };

    const PageAdapter = {
        findRunButton() {
            for (const sel of SELECTORS.runButton) {
                const btn = Array.from(document.querySelectorAll(sel)).find(el => {
                    if (!el || el.closest?.('#sql-helper-panel, #sql-helper-comment-overlay, #sql-helper-export-overlay, #sql-helper-settings-overlay, #sql-helper-tags-overlay')) return false;
                    return true;
                });
                if (btn) return btn;
            }
            return null;
        },
        findEditorElement() {
            const direct = document.querySelector(SELECTORS.sqlEditor);
            if (direct) return direct;
            return Array.from(document.querySelectorAll('textarea')).find(el => {
                if (!el || el.id === 'sql-helper-comment-textarea') return false;
                if (el.closest?.('#sql-helper-panel, #sql-helper-comment-overlay, #sql-helper-export-overlay, #sql-helper-settings-overlay, #sql-helper-tags-overlay')) return false;
                return true;
            }) || null;
        },
        findCodeMirror() {
            try {
                if (window.CodeMirror) {
                    const editorEl = this.findEditorElement();
                    const wrappers = Array.from(document.querySelectorAll('.CodeMirror'));
                    const instances = wrappers.map(el => el?.CodeMirror).filter(Boolean);
                    if (editorEl) {
                        const byTextArea = instances.find(cm => {
                            try { return cm.getTextArea && cm.getTextArea() === editorEl; } catch { return false; }
                        });
                        if (byTextArea) return byTextArea;
                        if (editorEl.nextElementSibling?.CodeMirror) return editorEl.nextElementSibling.CodeMirror;
                    }
                    const visible = instances.find(cm => {
                        const wrapper = cm.getWrapperElement && cm.getWrapperElement();
                        return wrapper && wrapper.offsetParent !== null;
                    });
                    if (visible) return visible;
                    if (instances[0]) return instances[0];
                }
            } catch {}
            return null;
        },
        dispatchMouseClick(el) {
            if (!el) return false;
            ['mousedown', 'mouseup', 'click'].forEach(type => {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
            return true;
        }
    };

    /********************************************************************
     * HELPERS GERAIS
     ********************************************************************/

    function safeJsonParse(raw, fallback) {
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function debounce(fn, wait) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function deepMerge(base, override) {
        const result = Array.isArray(base) ? [...base] : { ...base };
        if (!override || typeof override !== 'object') return result;

        Object.keys(override).forEach(key => {
            const baseVal = result[key];
            const overVal = override[key];

            if (
                baseVal &&
                overVal &&
                typeof baseVal === 'object' &&
                typeof overVal === 'object' &&
                !Array.isArray(baseVal) &&
                !Array.isArray(overVal)
            ) {
                result[key] = deepMerge(baseVal, overVal);
            } else {
                result[key] = overVal;
            }
        });

        return result;
    }

    function clamp(num, min, max) {
        return Math.max(min, Math.min(max, num));
    }

    function getSettings() {
        const parsed = StorageService.migrateSettings(StorageService.getJson(SETTINGS_STORAGE_KEY, {}));
        const merged = deepMerge(DEFAULT_SETTINGS, parsed || {});

        merged.capture.autoSaveEnabled = !!merged.capture.autoSaveEnabled;
        merged.capture.captureOnRunButton = merged.capture.captureOnRunButton !== false;
        merged.capture.captureOnCtrlEnter = merged.capture.captureOnCtrlEnter !== false;
        merged.capture.ignoreConsecutiveDuplicates = merged.capture.ignoreConsecutiveDuplicates !== false;

        merged.history.maxItems = clamp(Number(merged.history.maxItems) || DEFAULT_SETTINGS.history.maxItems, 100, 99999999);
        merged.history.recentSearchesMax = clamp(Number(merged.history.recentSearchesMax) || DEFAULT_SETTINGS.history.recentSearchesMax, 3, 20);
        merged.history.commentMaxLength = clamp(Number(merged.history.commentMaxLength) || DEFAULT_SETTINGS.history.commentMaxLength, 100, 2000);

        merged.interface.panelWidth = clamp(Number(merged.interface.panelWidth) || DEFAULT_SETTINGS.interface.panelWidth, 320, 700);
        if (!['office', 'soft', 'dark', 'contrast'].includes(String(merged.interface.theme || ''))) {
            merged.interface.theme = DEFAULT_SETTINGS.interface.theme;
        }
        merged.interface.cardsExpandedByDefault = !!merged.interface.cardsExpandedByDefault;
        merged.interface.showRunCount = merged.interface.showRunCount !== false;
        merged.interface.showIcons = merged.interface.showIcons !== false;

        merged.schemaVersion = SETTINGS_SCHEMA_VERSION;

        return merged;
    }

    function saveSettings(settings) {
        StorageService.setJson(SETTINGS_STORAGE_KEY, StorageService.migrateSettings(settings), 'settings');
    }

    function resetSettings() {
        saveSettings(DEFAULT_SETTINGS);
        applySettingsToUI();
        renderHistoryList();
    }

    function getCommentMaxLength() {
        return getSettings().history.commentMaxLength;
    }

    function getRecentSearchesMax() {
        return getSettings().history.recentSearchesMax;
    }

    function getHistoryMaxItems() {
        return getSettings().history.maxItems;
    }

    function loadUiState() {
        const parsed = StorageService.getJson(UI_STATE_STORAGE_KEY, null);
        return {
            panelOpen:   !!parsed?.panelOpen,
            scrollTop:   Number(parsed?.scrollTop) || 0,
            searchValue: String(parsed?.searchValue || ''),
            favOnly:     !!parsed?.favOnly,
            selectedTag: String(parsed?.selectedTag || ''),
            sortValue:   String(parsed?.sortValue || 'lastUsed_desc')
        };
    }

    function saveUiState(partial) {
        const current = loadUiState();
        StorageService.setJson(UI_STATE_STORAGE_KEY, { ...current, ...partial }, 'estado da UI');
    }

    function persistCurrentUiState() {
        saveUiState({
            scrollTop:   state.listContainer?.scrollTop || 0,
            searchValue: state.searchInput?.value || '',
            favOnly:     !!state.favoritesOnlyCheckbox?.checked,
            selectedTag: state.tagFilterSelect?.value || '',
            sortValue:   state.sortSelect?.value || 'lastUsed_desc'
        });
    }

    function generateId() {
        return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2);
    }

    function normalizeQuery(query) {
        return String(query || '')
            .replace(/\r/g, '')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function getItemKey(item) {
        return normalizeQuery(item?.query || '').toLowerCase();
    }

    function hasActiveFilters() {
        return Boolean(
            (state.searchInput?.value || '').trim() ||
            state.favoritesOnlyCheckbox?.checked ||
            (state.tagFilterSelect?.value || '').trim()
        );
    }

    /********************************************************************
     * BUSCA AVANÇADA
     ********************************************************************/

    function normalizeForSearch(str) {
        return String(str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function parseSearchTerms(raw) {
        return raw.trim().split(/\s+/).filter(Boolean).map(term => {
            const fromMatch = term.match(/^(?:from|table):(.+)$/i);
            if (fromMatch) return { type: 'from', raw: fromMatch[1], value: normalizeForSearch(fromMatch[1]) };

            const dateMatch = term.match(/^\d{4}(-\d{2})?(-\d{2})?$/) || term.match(/^\d{2}\/\d{4}$/);
            if (dateMatch) return { type: 'date', raw: term, value: term };

            return { type: 'text', raw: term, value: normalizeForSearch(term) };
        });
    }

    function highlightTerms(text, terms) {
        let result = escapeHtml(text);
        if (!terms.length) return result;

        const textTerms = terms
            .filter(t => t.type === 'text' || t.type === 'from')
            .map(t => t.raw)
            .filter(Boolean);

        for (const term of textTerms) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try {
                result = result.replace(
                    new RegExp(escaped, 'gi'),
                    m => `<mark class="sql-highlight">${m}</mark>`
                );
            } catch {}
        }
        return result;
    }

    function highlightSearchInsideText(text, terms) {
        let result = escapeHtml(text);
        const textTerms = (terms || [])
            .filter(t => t.type === 'text' || t.type === 'from')
            .map(t => t.raw)
            .filter(Boolean);

        for (const term of textTerms) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try {
                result = result.replace(
                    new RegExp(escaped, 'gi'),
                    m => `<mark class="sql-highlight">${m}</mark>`
                );
            } catch {}
        }
        return result;
    }

    function renderSqlToken(token, nextToken, terms) {
        const upper = token.toUpperCase();
        const keywordSet = new Set([
            'ADD', 'ALTER', 'AND', 'AS', 'ASC', 'BEGIN', 'BETWEEN', 'BY', 'CASE', 'CAST',
            'COALESCE', 'COLLATE', 'COLUMN', 'COMMIT', 'CONSTRAINT', 'CREATE', 'CROSS',
            'DATABASE', 'DECLARE', 'DEFAULT', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE',
            'END', 'EXCEPT', 'EXEC', 'EXISTS', 'FOR', 'FOREIGN', 'FROM', 'FULL', 'GROUP',
            'HAVING', 'IF', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS',
            'JOIN', 'KEY', 'LEFT', 'LIKE', 'LIMIT', 'NOT', 'NULL', 'ON', 'OR', 'ORDER',
            'OUTER', 'PRIMARY', 'PROCEDURE', 'RIGHT', 'ROLLBACK', 'ROW_NUMBER', 'SELECT',
            'SET', 'TABLE', 'THEN', 'TOP', 'TRUNCATE', 'UNION', 'UPDATE', 'VALUES', 'VIEW',
            'WHEN', 'WHERE', 'WITH'
        ]);
        const typeSet = new Set([
            'BIGINT', 'BIT', 'CHAR', 'DATE', 'DATETIME', 'DECIMAL', 'FLOAT', 'INT',
            'MONEY', 'NUMERIC', 'NVARCHAR', 'SMALLINT', 'TEXT', 'TIME', 'TIMESTAMP',
            'UNIQUEIDENTIFIER', 'VARCHAR', 'XML'
        ]);

        let cls = '';
        if (/^--/.test(token)) cls = 'sql-syn-comment';
        else if (/^'(?:''|[^'])*'$/.test(token)) cls = 'sql-syn-string';
        else if (/^\d+(?:\.\d+)?$/.test(token)) cls = 'sql-syn-number';
        else if (keywordSet.has(upper)) cls = 'sql-syn-keyword';
        else if (typeSet.has(upper)) cls = 'sql-syn-type';
        else if (/^[A-Za-z_][\w$#@]*$/.test(token) && nextToken === '(') cls = 'sql-syn-function';
        else if (/^[(),.;=*+\-/<>!]+$/.test(token)) cls = 'sql-syn-operator';

        const html = highlightSearchInsideText(token, terms);
        return cls ? `<span class="${cls}">${html}</span>` : html;
    }

    function renderSqlLine(line, terms) {
        const tokenRegex = /--.*$|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$#@]*\b|[(),.;=*+\-/<>!]+|\s+|./g;
        const tokens = String(line || '').match(tokenRegex) || [''];
        return tokens.map((token, index) => {
            if (/^\s+$/.test(token)) return escapeHtml(token);
            const nextToken = (tokens.slice(index + 1).find(t => !/^\s+$/.test(t)) || '').trim();
            return renderSqlToken(token, nextToken, terms);
        }).join('');
    }

    function renderSqlQuery(query, terms) {
        const lines = String(query || '').replace(/\r/g, '').split('\n');
        return lines.map((line, index) => {
            const lineNo = String(index + 1);
            const code = renderSqlLine(line, terms) || '&nbsp;';
            return `<div class="sql-code-line"><span class="sql-line-no">${lineNo}</span><span class="sql-line-code">${code}</span></div>`;
        }).join('');
    }

    function loadRecentSearches() {
        return StorageService.getJson(RECENT_SEARCHES_KEY, [])
            .filter(s => typeof s === 'string' && s.trim());
    }

    function saveRecentSearch(term) {
        const trimmed = term.trim();
        if (!trimmed) return;
        const max = getRecentSearchesMax();
        const list = loadRecentSearches().filter(s => s !== trimmed);
        list.unshift(trimmed);
        StorageService.setJson(RECENT_SEARCHES_KEY, list.slice(0, max), 'busca recente');
    }

    function clearRecentSearches() {
        StorageService.setJson(RECENT_SEARCHES_KEY, [], 'buscas recentes');
        renderSearchSuggestions('');
    }

    function renderSearchSuggestions(filter) {
        const box = state.searchSuggestionsBox;
        if (!box) return;

        const recent = loadRecentSearches();
        const filtered = filter
            ? recent.filter(s => s.toLowerCase().includes(filter.toLowerCase()))
            : recent;

        box.innerHTML = '';
        if (!filtered.length) {
            box.style.display = 'none';
            return;
        }

        filtered.forEach(term => {
            const item = document.createElement('div');
            item.className = 'sql-search-suggestion';
            item.textContent = term;
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                state.searchInput.value = term;
                box.style.display = 'none';
                renderHistoryList();
            });
            box.appendChild(item);
        });
        box.style.display = 'block';
    }

    function formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString('pt-BR');
        } catch {
            return iso;
        }
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (e) {
                console.warn('[SQL Helper] clipboard API falhou, tentando fallback:', e);
            }
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (!ok) throw new Error('execCommand retornou false');
            return true;
        } catch (e) {
            console.error('[SQL Helper] Falha ao copiar (fallback):', e);
            return false;
        }
    }

    /********************************************************************
     * EDITOR
     ********************************************************************/

    function findRunButton() {
        return PageAdapter.findRunButton();
    }

    function getEditorInstance() {
        return PageAdapter.findCodeMirror();
    }

    function getEditorValue() {
        if (window.__SQL_EDITOR_QUERY_API__ && typeof window.__SQL_EDITOR_QUERY_API__.getValue === 'function') {
            try { return window.__SQL_EDITOR_QUERY_API__.getValue(); } catch {}
        }
        const cm = getEditorInstance();
        if (cm) return cm.getValue();

        const editorEl = PageAdapter.findEditorElement();
        return editorEl?.value || '';
    }

    function setEditorValue(text) {
        const value = String(text || '');
        if (window.__SQL_EDITOR_QUERY_API__ && typeof window.__SQL_EDITOR_QUERY_API__.setValue === 'function') {
            try {
                if (window.__SQL_EDITOR_QUERY_API__.setValue(value)) return true;
            } catch (e) {
                console.warn('[SQL Helper] Ponte do Editor de Query falhou ao colar:', e);
            }
        }

        const cm = getEditorInstance();
        if (cm) {
            cm.setValue(value);
            try { cm.save(); } catch {}
            cm.focus();
            const lastLine = Math.max(cm.lineCount() - 1, 0);
            const lastCh = cm.getLine(lastLine)?.length || 0;
            cm.setCursor(lastLine, lastCh);
            const ta = (() => { try { return cm.getTextArea && cm.getTextArea(); } catch { return null; } })();
            if (ta) syncTextAreaValue(ta, value);
            return true;
        }

        const editorEl = PageAdapter.findEditorElement();
        if (editorEl) {
            syncTextAreaValue(editorEl, value);
            editorEl.focus();
            return true;
        }
        alert('Editor SQL não encontrado para colar a query.');
        return false;
    }

    function syncTextAreaValue(editorEl, value) {
        const proto = editorEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(editorEl, value);
        else editorEl.value = value;
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true }));
        editorEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    function triggerRun() {
        if (window.__SQL_EDITOR_QUERY_API__ && typeof window.__SQL_EDITOR_QUERY_API__.execute === 'function') {
            try {
                if (window.__SQL_EDITOR_QUERY_API__.execute()) return;
            } catch (e) {
                console.warn('[SQL Helper] Ponte do Editor de Query falhou ao executar:', e);
            }
        }
        const btn = findRunButton();
        if (btn) PageAdapter.dispatchMouseClick(btn);
        else alert('Botão Executar não encontrado.');
    }

    /********************************************************************
     * HISTÓRICO
     ********************************************************************/

    function cleanQueryName(text) {
        return String(text || '')
            .replace(/[:;,.]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 90);
    }

    function titleCaseIdentifier(identifier) {
        return String(identifier || '')
            .replace(/[\[\]`"]/g, '')
            .split('.')
            .pop()
            .replace(/[_]+/g, ' ')
            .replace(/[^\wÀ-ÿ\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function suggestQueryName(item) {
        const comment = cleanQueryName(item?.comment || '');
        if (comment) return comment;

        const query = String(item?.query || '');
        const blockComment = query.match(/\/\*+([\s\S]*?)\*\//);
        if (blockComment) {
            const line = blockComment[1]
                .split(/\r?\n/)
                .map(l => cleanQueryName(l.replace(/^[=\-\s*]+|[=\-\s*]+$/g, '')))
                .find(Boolean);
            if (line) return line;
        }

        const lineComment = query.match(/^\s*--\s*(.+)$/m);
        if (lineComment) {
            const line = cleanQueryName(lineComment[1]);
            if (line) return line;
        }

        const normalized = query
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/--.*$/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const upper = normalized.toUpperCase();
        const firstWord = (upper.match(/^\s*(WITH|SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE)\b/) || [])[1] || 'SQL';
        const tableMatch = normalized.match(/\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM|TRUNCATE\s+TABLE)\s+([\[\]`"\w$.#@]+)/i);
        const table = titleCaseIdentifier(tableMatch?.[1] || '');
        if (firstWord === 'SELECT' || firstWord === 'WITH') return table ? `Consulta de ${table}` : 'Consulta SQL';
        if (firstWord === 'INSERT') return table ? `Inserção em ${table}` : 'Inserção SQL';
        if (firstWord === 'UPDATE' || firstWord === 'MERGE') return table ? `Atualização de ${table}` : 'Atualização SQL';
        if (firstWord === 'DELETE' || firstWord === 'TRUNCATE') return table ? `Exclusão em ${table}` : 'Exclusão SQL';
        if (firstWord === 'EXEC' || firstWord === 'EXECUTE') return 'Execução de procedimento SQL';
        return 'Query SQL';
    }

    function promptQueryName(item) {
        const current = item.name || '';
        const suggested = current || suggestQueryName(item);
        const nextName = prompt('Nome da query:', suggested);
        if (nextName === null) return;
        updateHistoryEntry(item.id, { name: cleanQueryName(nextName) });
    }

    function normalizeItem(raw) {
        if (!raw) return null;

        const query = normalizeQuery(raw.query || '');
        if (!query) return null;

        const nowIso = new Date().toISOString();
        const createdAt = raw.createdAt || nowIso;
        const lastUsedAt = raw.lastUsedAt || createdAt;

        let comment = String(raw.comment || '');
        const maxCommentLength = getCommentMaxLength();
        if (comment.length > maxCommentLength) {
            comment = comment.slice(0, maxCommentLength);
        }

        let tags = [];
        if (Array.isArray(raw.tags)) {
            tags = raw.tags;
        } else if (typeof raw.tags === 'string') {
            tags = raw.tags.split(/[|,]/g);
        }

        tags = [...new Set(
            tags.map(tag => String(tag || '').trim()).filter(Boolean)
        )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

        return {
            id: raw.id || generateId(),
            query,
            name: cleanQueryName(raw.name || ''),
            createdAt,
            lastUsedAt,
            runCount: Math.max(Number(raw.runCount) || 1, 1),
            isFavorite: !!raw.isFavorite,
            tags,
            comment
        };
    }

    function loadHistory() {
        const parsed = StorageService.getJson(HISTORY_STORAGE_KEY, []);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeItem).filter(Boolean);
    }

    function saveHistory(history) {
        try {
            const cleaned = history
                .map(normalizeItem)
                .filter(Boolean)
                .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt))
                .slice(0, getHistoryMaxItems());

            StorageService.setJson(HISTORY_STORAGE_KEY, cleaned, 'historico');
        } catch (e) {
            console.error('[SQL Helper] Erro ao salvar histórico:', e);
        }
    }

    function getFilteredHistory() {
        const history = loadHistory();
        const search = (state.searchInput?.value || '').trim().toLowerCase();
        const onlyFavorites = !!state.favoritesOnlyCheckbox?.checked;
        const selectedTag = (state.tagFilterSelect?.value || '').trim();

        return history.filter(item => {
            if (onlyFavorites && !item.isFavorite) return false;
            if (selectedTag && !item.tags.includes(selectedTag)) return false;
            if (!search) return true;

            const haystack = [
                item.name || '',
                item.query,
                item.comment || '',
                (item.tags || []).join(' ')
            ].join('\n').toLowerCase();

            return haystack.includes(search);
        });
    }

    function addHistoryEntry(queryText) {
        const q = normalizeQuery(queryText);
        if (!q) return;

        const history = loadHistory();
        const now = new Date().toISOString();
        const settings = getSettings();

        if (settings.capture.ignoreConsecutiveDuplicates && history.length) {
            const mostRecent = history[0];
            if (getItemKey(mostRecent) === q.toLowerCase()) {
                mostRecent.lastUsedAt = now;
                mostRecent.runCount += 1;
                saveHistory(history);
                renderHistoryList();
                return;
            }
        }

        const existing = history.find(item => getItemKey(item) === q.toLowerCase());

        if (existing) {
            existing.lastUsedAt = now;
            existing.runCount += 1;
        } else {
            const newItem = normalizeItem({
                id: generateId(),
                query: q,
                createdAt: now,
                lastUsedAt: now,
                runCount: 1,
                isFavorite: false,
                tags: [],
                comment: ''
            });
            if (newItem) history.unshift(newItem);
        }

        saveHistory(history);
        renderHistoryList();
    }

    function updateHistoryEntry(id, patch) {
        const history = loadHistory();
        const idx = history.findIndex(item => item.id === id);
        if (idx === -1) return;

        history[idx] = normalizeItem({ ...history[idx], ...patch, id: history[idx].id });
        saveHistory(history);
        renderHistoryList();
    }

    function deleteHistoryEntry(id) {
        saveHistory(loadHistory().filter(item => item.id !== id));
        renderHistoryList();
    }

    function clearHistory() {
        saveHistory([]);
        renderHistoryList();
    }

    function collectAllTags(history) {
        return [...new Set(history.flatMap(item => item.tags || []))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    }

    function countTagUsage(history, tag) {
        return history.filter(item => (item.tags || []).includes(tag)).length;
    }

    function renameTagEverywhere(oldTag, newTag) {
        const cleanOld = String(oldTag || '').trim();
        const cleanNew = String(newTag || '').trim();
        if (!cleanOld || !cleanNew) return;
        const history = loadHistory().map(item => {
            const tags = (item.tags || []).map(tag => tag === cleanOld ? cleanNew : tag);
            return normalizeItem({ ...item, tags: [...new Set(tags)] });
        });
        saveHistory(history);
        renderHistoryList();
        renderTagsManagerList();
    }

    function deleteTagEverywhere(tagToDelete) {
        const cleanTag = String(tagToDelete || '').trim();
        if (!cleanTag) return;
        const history = loadHistory().map(item => normalizeItem({
            ...item,
            tags: (item.tags || []).filter(tag => tag !== cleanTag)
        }));
        saveHistory(history);
        if (state.tagFilterSelect && state.tagFilterSelect.value === cleanTag) state.tagFilterSelect.value = '';
        renderHistoryList();
        renderTagsManagerList();
    }

    /********************************************************************
     * EXPORT / IMPORT
     ********************************************************************/

    function formatDateForFilename(d) {
        const pad = n => String(n).padStart(2, '0');
        return [
            d.getFullYear(),
            pad(d.getMonth() + 1),
            pad(d.getDate())
        ].join('') + '_' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
    }

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function getHistoryForExport() {
        return hasActiveFilters() ? getFilteredHistory() : loadHistory();
    }

    function exportHistoryJSON() {
        const nowStr = formatDateForFilename(new Date());
        downloadFile(
            `sql_history_${nowStr}.json`,
            JSON.stringify(getHistoryForExport(), null, 2),
            'application/json;charset=utf-8;'
        );
    }

    function toCsvValue(value) {
        const str = String(value ?? '').replace(/"/g, '""');
        return `"${str}"`;
    }

    function exportHistoryCSV() {
        const header = ['id', 'name', 'createdAt', 'lastUsedAt', 'runCount', 'isFavorite', 'tags', 'comment', 'query'].join(';');
        const lines = [header];

        for (const item of getHistoryForExport()) {
            lines.push([
                toCsvValue(item.id),
                toCsvValue(item.name || ''),
                toCsvValue(item.createdAt),
                toCsvValue(item.lastUsedAt),
                toCsvValue(item.runCount),
                toCsvValue(item.isFavorite ? 'true' : 'false'),
                toCsvValue((item.tags || []).join(' | ')),
                toCsvValue(item.comment || ''),
                toCsvValue(item.query || '')
            ].join(';'));
        }

        downloadFile(
            `sql_history_${formatDateForFilename(new Date())}.csv`,
            lines.join('\r\n'),
            'text/csv;charset=utf-8;'
        );
    }

    function parseCsvLine(line) {
        const result = [];
        let cur = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c === ';' && !inQuotes) {
                result.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        result.push(cur);
        return result;
    }

    function applyImportedItems(importedItems, mode) {
        const normalized = importedItems.map(normalizeItem).filter(Boolean);
        if (!normalized.length) {
            alert('Nenhum item válido encontrado para importar.');
            return;
        }

        let history = mode === 'replace' ? [] : loadHistory();
        const existingByQuery = new Map(history.map(item => [getItemKey(item), item]));
        let added = 0;
        let merged = 0;

        for (const imported of normalized) {
            const key = getItemKey(imported);
            const existing = existingByQuery.get(key);

            if (!existing) {
                history.push(imported);
                existingByQuery.set(key, imported);
                added++;
                continue;
            }

            existing.lastUsedAt = new Date(Math.max(new Date(existing.lastUsedAt), new Date(imported.lastUsedAt))).toISOString();
            existing.createdAt = new Date(Math.min(new Date(existing.createdAt), new Date(imported.createdAt))).toISOString();
            existing.runCount = Math.max(existing.runCount || 1, imported.runCount || 1);
            existing.isFavorite = existing.isFavorite || imported.isFavorite;
            existing.tags = [...new Set([...(existing.tags || []), ...(imported.tags || [])])]
                .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
            if (!existing.comment && imported.comment) existing.comment = imported.comment;
            merged++;
        }

        saveHistory(history);
        renderHistoryList();
        alert(`Importação concluída.\nAdicionados: ${added}\nMesclados: ${merged}`);
    }

    function importFromJSON(text, mode) {
        const raw = safeJsonParse(text, null);
        if (!Array.isArray(raw)) {
            alert('JSON inválido: esperado um array de itens.');
            return;
        }
        applyImportedItems(raw, mode);
    }

    function importFromCSV(text, mode) {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) {
            alert('CSV vazio.');
            return;
        }

        const header = parseCsvLine(lines[0]);
        const indexOf = name => header.indexOf(name);
        const idxQuery = indexOf('query');
        if (idxQuery === -1) {
            alert('CSV inválido: coluna "query" não encontrada.');
            return;
        }

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const get = idx => (idx >= 0 && idx < cols.length ? cols[idx] : '');
            rows.push({
                id: get(indexOf('id')),
                name: get(indexOf('name')),
                createdAt: get(indexOf('createdAt')),
                lastUsedAt: get(indexOf('lastUsedAt')),
                runCount: get(indexOf('runCount')),
                isFavorite: get(indexOf('isFavorite')) === 'true',
                tags: get(indexOf('tags')),
                comment: get(indexOf('comment')),
                query: get(idxQuery)
            });
        }

        applyImportedItems(rows, mode);
    }

    /********************************************************************
     * MARKDOWN
     ********************************************************************/

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderMarkdown(md) {
        if (!md) return '';

        const lines = escapeHtml(md).split('\n');
        const out = [];
        let inList = false;

        function closeList() {
            if (inList) {
                out.push('</ul>');
                inList = false;
            }
        }

        function formatInline(text) {
            return text
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`(.+?)`/g, '<code>$1</code>');
        }

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line.trim()) {
                closeList();
                continue;
            }

            const listMatch = line.match(/^\s*-\s+(.+)$/);
            if (listMatch) {
                if (!inList) {
                    out.push('<ul>');
                    inList = true;
                }
                out.push(`<li>${formatInline(listMatch[1])}</li>`);
                continue;
            }

            closeList();

            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                out.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
            } else {
                out.push(`<p>${formatInline(line)}</p>`);
            }
        }

        closeList();
        return out.join('');
    }

    function getHistoryIconSvg(iconName) {
        const icons = {
            history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>',
            settings: '<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .2 1.7 1.7 0 0 0-.8 1.7v.2H9.1v-.2a1.7 1.7 0 0 0-.8-1.7 1.7 1.7 0 0 0-2-.2l-.2.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1.1H3v-3.8h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.2 1.7 1.7 0 0 0 .8-1.7V1.6h5.8v.2a1.7 1.7 0 0 0 .8 1.7 1.7 1.7 0 0 0 2 .2l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1.1h.1v3.8h-.1A1.7 1.7 0 0 0 19.4 15z"/></svg>',
            export: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>',
            copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>',
            run: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
            paste: '<svg viewBox="0 0 24 24"><path d="M8 4h8l1 2h2v15H5V6h2z"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
            delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>',
            edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13 6 5 5"/></svg>',
            tag: '<svg viewBox="0 0 24 24"><path d="M20 13 11 22 2 13V4h9z"/><path d="M7.5 8.5h.01"/></svg>',
            close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
            star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
            expand: '<svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>',
            collapse: '<svg viewBox="0 0 24 24"><path d="m10 8 4 4-4 4"/></svg>',
            reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'
        };
        return icons[iconName] || icons.history;
    }

    function createIconSpan(iconName) {
        const icon = document.createElement('span');
        icon.className = `sql-helper-icon sql-helper-icon-${iconName}`;
        icon.innerHTML = getHistoryIconSvg(iconName);
        return icon;
    }

    function setIconButtonContent(button, label, iconName) {
        button.textContent = '';
        if (iconName) button.appendChild(createIconSpan(iconName));
        const text = document.createElement('span');
        text.className = 'sql-helper-btn-text';
        text.textContent = label;
        button.appendChild(text);
    }

    function createIconButton(label, iconName, className) {
        const button = document.createElement('button');
        button.type = 'button';
        if (className) button.className = className;
        setIconButtonContent(button, label, iconName);
        return button;
    }

    /********************************************************************
     * STYLES
     ********************************************************************/

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            :root {
                --sql-helper-panel-width: ${getSettings().interface.panelWidth}px;
            }

            #sql-helper-toggle-btn {
                position: fixed;
                bottom: 16px;
                right: 16px;
                z-index: 999999;
                padding: 8px 12px;
                font-size: 12px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                background: #1e293b;
                color: #f9fafb;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            #sql-helper-panel {
                position: fixed;
                top: 0;
                right: 0;
                width: var(--sql-helper-panel-width);
                height: 100vh;
                background: #020617;
                color: #e5e7eb;
                z-index: 999998;
                box-shadow: -2px 0 10px rgba(0,0,0,0.4);
                display: flex;
                flex-direction: column;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            }
            #sql-helper-panel.hidden { display: none; }
            #sql-helper-header {
                padding: 10px 12px;
                border-bottom: 1px solid #1f2937;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            #sql-helper-header-top {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            #sql-helper-header-title { font-size: 14px; font-weight: 600; }
            #sql-helper-search-wrapper {
                position: relative;
                width: 100%;
            }
            #sql-helper-search {
                width: 100%;
                padding: 4px 26px 4px 6px;
                font-size: 12px;
                border-radius: 4px;
                border: 1px solid #374151;
                background: #020617;
                color: #e5e7eb;
                box-sizing: border-box;
            }
            #sql-helper-search:focus {
                outline: none;
                border-color: #3b82f6;
                box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
            }
            #sql-helper-search-clear {
                position: absolute;
                right: 4px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: #6b7280;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                padding: 0 2px;
            }
            #sql-helper-search-clear:hover { color: #f97316; }
            #sql-helper-search-suggestions {
                position: absolute;
                top: calc(100% + 2px);
                left: 0;
                right: 0;
                background: #0f172a;
                border: 1px solid #1e293b;
                border-radius: 4px;
                z-index: 1000001;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                max-height: 160px;
                overflow-y: auto;
            }
            .sql-search-suggestion {
                padding: 5px 8px;
                font-size: 11px;
                color: #cbd5e1;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sql-search-suggestion:hover { background: #1e293b; color: #f9fafb; }
            mark.sql-highlight {
                background: #854d0e;
                color: #fef9c3;
                border-radius: 2px;
                padding: 0 1px;
            }
            #sql-helper-controls {
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 11px;
            }
            .sql-helper-control-row {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: nowrap;
            }
            .sql-helper-control-label {
                font-size: 10px;
                color: #6b7280;
                white-space: nowrap;
                min-width: 46px;
            }
            .sql-helper-fav-label {
                font-size: 11px;
                color: #e5e7eb;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
            }
            #sql-helper-sort {
                flex: 1;
                padding: 3px 4px;
                font-size: 11px;
                border-radius: 4px;
                border: 1px solid #4b5563;
                background: #020617;
                color: #e5e7eb;
            }
            .sql-helper-btn {
                border-radius: 4px;
                border: 1px solid #4b5563;
                background: #111827;
                color: #e5e7eb;
                padding: 3px 6px;
                cursor: pointer;
                font-size: 11px;
            }
            .sql-helper-btn.danger { border-color: #b91c1c; color: #fecaca; }
            .sql-helper-btn.secondary { border-color: #4b5563; background: #020617; }
            #sql-helper-tag-filter {
                padding: 3px 4px;
                font-size: 11px;
                border-radius: 4px;
                border: 1px solid #4b5563;
                background: #020617;
                color: #e5e7eb;
                max-width: 160px;
            }
            .sql-card {
                background: #020617;
                border: 1px solid #1e293b;
                border-radius: 6px;
                padding: 10px;
                margin-bottom: 10px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                cursor: pointer;
            }
            .sql-card.selected {
                border-color: #8fb0d8;
                box-shadow: 0 0 0 2px rgba(143,176,216,.22);
            }
            .sql-card:focus {
                outline: none;
                border-color: #8fb0d8;
                box-shadow: 0 0 0 2px rgba(143,176,216,.22);
            }
            .sql-card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .sql-card-meta {
                font-size: 11px;
                color: #94a3b8;
                line-height: 1.4;
            }
            .sql-card-title-box {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .sql-card-name {
                color: #f8fafc;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.25;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sql-card-header-actions {
                display: flex;
                gap: 4px;
                align-items: center;
                flex-shrink: 0;
            }
            .sql-card-header-actions button {
                border-radius: 999px;
                border: 1px solid #4b5563;
                background: #0b1120;
                color: #e5e7eb;
                padding: 2px 6px;
                font-size: 10px;
                cursor: pointer;
            }
            .sql-card-body { display: flex; flex-direction: column; gap: 8px; }
            .sql-card.collapsed .sql-card-body { display: none; }
            .sql-card-query {
                border-radius: 4px;
                background: #020617;
                border: 1px solid #111827;
                padding: 6px;
            }
            .sql-card-query pre {
                margin: 0;
                font-size: 12px;
                font-family: "JetBrains Mono","Fira Code",monospace;
                max-height: 96px;
                overflow: hidden;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .sql-code-line {
                display: grid;
                grid-template-columns: 22px minmax(0,1fr);
                column-gap: 7px;
                min-height: 15px;
                line-height: 15px;
            }
            .sql-line-no {
                color: #64748b;
                font-size: 9px;
                line-height: 15px;
                text-align: right;
                user-select: none;
                opacity: .75;
                font-variant-numeric: tabular-nums;
            }
            .sql-line-code {
                min-width: 0;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .sql-syn-keyword { color: #185abd; font-weight: 700; }
            .sql-syn-type { color: #5c2d91; font-weight: 600; }
            .sql-syn-function { color: #0078d4; }
            .sql-syn-string { color: #a4262c; }
            .sql-syn-number { color: #107c10; }
            .sql-syn-comment { color: #6b7280; font-style: italic; }
            .sql-syn-operator { color: #605e5c; }
            .sql-card-query.expanded pre { max-height: none; }
            .sql-show-more {
                margin-top: 4px;
                font-size: 11px;
                background: none;
                border: none;
                color: #60a5fa;
                cursor: pointer;
                padding: 0;
            }
            .sql-meta-row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                font-size: 11px;
                margin-top: 2px;
            }
            .sql-tag {
                background: #0f172a;
                border: 1px solid #1e293b;
                border-radius: 999px;
                padding: 2px 6px;
                font-size: 10px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .sql-tag button {
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                padding: 0;
                font-size: 10px;
            }
            .sql-add-tag-btn { font-size: 10px; padding: 2px 6px; }
            .sql-comment-preview-inline {
                max-width: 220px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: #9ca3af;
                cursor: pointer;
            }
            .sql-comment-expanded {
                margin-top: 4px;
                padding: 8px 0 0 8px;
                border-left: 2px solid #334155;
                font-size: 11px;
            }
            .sql-comment-expanded p,
            .sql-comment-expanded ul,
            .sql-comment-expanded h1,
            .sql-comment-expanded h2,
            .sql-comment-expanded h3,
            .sql-comment-expanded h4,
            .sql-comment-expanded h5,
            .sql-comment-expanded h6 { margin: 0 0 6px; }
            .sql-card-actions {
                display: none;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 2px;
                padding-top: 8px;
                border-top: 1px solid rgba(148,163,184,.22);
            }
            .sql-card.selected .sql-card-actions,
            .sql-card:focus-within .sql-card-actions {
                display: flex;
            }
            .sql-card-actions button {
                font-size: 11px;
                padding: 3px 6px;
                border-radius: 4px;
                background: #0b1120;
                border: 1px solid #334155;
                color: #e2e8f0;
                cursor: pointer;
            }
            .sql-card-actions .danger { border-color: #b91c1c; color: #fecaca; }
            #sql-helper-footer {
                padding: 8px 10px;
                font-size: 10px;
                border-top: 1px solid #1f2937;
                color: #6b7280;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex: 0 0 auto;
                position: relative;
                z-index: 1000002;
                min-height: 42px;
                overflow: visible;
            }
            #sql-helper-footer-left {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: nowrap;
                width: 100%;
                min-width: 0;
                padding-right: 304px;
                box-sizing: border-box;
            }
            #sql-helper-footer-info {
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                pointer-events: none;
            }
            #sql-helper-footer-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                position: absolute;
                top: 50%;
                right: 10px;
                transform: translateY(-50%);
                z-index: 1000003;
                pointer-events: auto;
                min-width: 294px;
                min-height: 34px;
                padding: 4px;
                box-sizing: border-box;
                background: inherit;
            }
            #sql-helper-footer-actions .sql-helper-btn {
                min-height: 30px;
                padding: 5px 9px;
                position: relative;
                z-index: 1000004;
            }

            #sql-helper-comment-overlay,
            #sql-helper-export-overlay,
            #sql-helper-tags-overlay,
            #sql-helper-settings-overlay {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.65);
                z-index: 1000000;
                display: none;
                align-items: center;
                justify-content: center;
            }

            #sql-helper-comment-modal,
            #sql-helper-export-modal,
            #sql-helper-tags-modal,
            #sql-helper-settings-modal {
                background: #020617;
                border-radius: 8px;
                border: 1px solid #1f2937;
                color: #e5e7eb;
                box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            }

            #sql-helper-comment-modal {
                width: 700px;
                max-width: 95vw;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            #sql-helper-export-modal,
            #sql-helper-tags-modal,
            #sql-helper-settings-modal {
                width: 520px;
                max-width: 95vw;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            #sql-helper-comment-header,
            #sql-helper-export-header,
            #sql-helper-tags-header,
            #sql-helper-settings-header {
                padding: 10px 12px;
                border-bottom: 1px solid #1f2937;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                font-weight: 600;
            }

            #sql-helper-comment-body {
                display: grid;
                grid-template-columns: 1fr 1fr;
                min-height: 260px;
                max-height: 60vh;
            }

            #sql-helper-comment-editor,
            #sql-helper-comment-preview-wrapper {
                padding: 8px 10px;
                font-size: 12px;
            }

            #sql-helper-comment-editor { border-right: 1px solid #1f2937; }

            #sql-helper-comment-editor label,
            #sql-helper-comment-preview-wrapper label {
                display: block;
                font-size: 11px;
                color: #9ca3af;
                margin-bottom: 4px;
            }

            #sql-helper-comment-textarea {
                width: 100%;
                height: 100%;
                min-height: 220px;
                resize: none;
                border-radius: 4px;
                border: 1px solid #374151;
                background: #020617;
                color: #e5e7eb;
                padding: 6px 8px;
                font-size: 12px;
                box-sizing: border-box;
            }

            #sql-helper-comment-preview {
                width: 100%;
                height: 100%;
                min-height: 220px;
                border-radius: 4px;
                border: 1px solid #111827;
                background: #020617;
                padding: 6px 8px;
                overflow-y: auto;
                font-size: 12px;
                box-sizing: border-box;
            }

            #sql-helper-comment-footer,
            #sql-helper-export-footer,
            #sql-helper-settings-footer {
                padding: 8px 10px;
                border-top: 1px solid #1f2937;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 6px;
                font-size: 11px;
            }

            .sql-helper-comment-hint { color: #6b7280; font-size: 10px; }

            .sql-helper-comment-close {
                cursor: pointer;
                border: none;
                background: transparent;
                color: #9ca3af;
                font-size: 14px;
            }
            .sql-helper-comment-close:hover { color: #f97316; }

            #sql-helper-export-body,
            #sql-helper-tags-body,
            #sql-helper-settings-body {
                padding: 10px 12px;
                font-size: 12px;
            }

            #sql-helper-tags-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-height: 58vh;
                overflow: auto;
            }
            .sql-tags-manager-card {
                border: 1px solid #1f2937;
                border-radius: 8px;
                background: #06101f;
                padding: 11px;
            }
            .sql-tags-manager-title {
                color: #f8fafc;
                text-transform: uppercase;
                letter-spacing: .4px;
                font-size: 12px;
                font-weight: 800;
                margin-bottom: 3px;
            }
            .sql-tags-manager-hint {
                color: #94a3b8;
                font-size: 11px;
                line-height: 1.35;
                margin-bottom: 10px;
            }
            .sql-tags-manager-empty {
                border: 1px dashed #334155;
                border-radius: 8px;
                padding: 18px;
                text-align: center;
                color: #94a3b8;
                background: #06101f;
            }
            .sql-tag-manager-row {
                display: grid;
                grid-template-columns: minmax(0,1fr) auto;
                gap: 10px;
                align-items: center;
                border: 1px solid #1f2937;
                border-radius: 8px;
                padding: 8px 9px;
                background: #06101f;
            }
            .sql-tag-manager-main {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sql-tag-manager-name {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #e5e7eb;
                font-weight: 600;
                font-size: 12px;
            }
            .sql-tag-manager-count {
                color: #94a3b8;
                font-size: 10px;
                white-space: nowrap;
                border: 1px solid #334155;
                border-radius: 999px;
                padding: 2px 6px;
            }
            .sql-tag-manager-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                flex-wrap: wrap;
            }

            #sql-helper-export-sections,
            #sql-helper-settings-sections {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin-top: 6px;
            }

            #sql-helper-export-options,
            #sql-helper-import-options {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .sql-helper-export-caption { font-size: 11px; color: #9ca3af; }
            .sql-helper-import-row { display: flex; flex-direction: column; gap: 6px; }
            .sql-helper-import-mode { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #e5e7eb; }
            .sql-helper-import-mode label { display: flex; align-items: center; gap: 4px; }
            .sql-helper-import-file { display: flex; align-items: center; gap: 6px; }

            #sql-helper-autosave-wrapper {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 10px;
                color: #9ca3af;
                white-space: nowrap;
            }

            #sql-helper-autosave { margin: 0; cursor: pointer; }
            #sql-helper-autosave-label-status { font-weight: 500; }

            .sql-settings-section {
                border: 1px solid #1f2937;
                border-radius: 6px;
                padding: 10px;
                background: #06101f;
            }
            .sql-settings-section-title {
                font-size: 12px;
                font-weight: 600;
                margin-bottom: 8px;
                color: #f8fafc;
            }
            .sql-settings-row {
                display: grid;
                grid-template-columns: 1fr auto;
                gap: 10px;
                align-items: center;
                padding: 6px 0;
                border-bottom: 1px solid rgba(255,255,255,0.04);
            }
            .sql-settings-row:last-child {
                border-bottom: none;
            }
            .sql-settings-label {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .sql-settings-label strong {
                font-size: 11px;
                color: #e5e7eb;
                font-weight: 600;
            }
            .sql-settings-label span {
                font-size: 10px;
                color: #94a3b8;
            }
            .sql-settings-row input[type="number"] {
                width: 92px;
                padding: 4px 6px;
                border-radius: 4px;
                border: 1px solid #374151;
                background: #020617;
                color: #e5e7eb;
                font-size: 12px;
                box-sizing: border-box;
            }
            .sql-settings-row input[type="range"] {
                width: 180px;
            }
            .sql-settings-range-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sql-settings-danger-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            #sql-helper-list {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 8px 8px 12px;
                scrollbar-width: auto;
                scrollbar-color: #64748b #0f172a;
            }
            .sql-helper-render-limit {
                margin: 8px 2px 4px;
                padding: 8px 10px;
                border: 1px solid rgba(148, 163, 184, .35);
                border-radius: 8px;
                color: #cbd5e1;
                background: rgba(15, 23, 42, .72);
                font-size: 11px;
                line-height: 1.35;
            }

            #sql-helper-list::-webkit-scrollbar {
                width: 14px;
            }

            #sql-helper-list::-webkit-scrollbar-track {
                background: #0f172a;
                border-left: 1px solid #1e293b;
            }

            #sql-helper-list::-webkit-scrollbar-thumb {
                background: #64748b;
                border-radius: 10px;
                border: 3px solid #0f172a;
            }

            #sql-helper-list::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
            }

            /* Visual Office, alinhado ao Editor de Query */
            #sql-helper-toggle-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                border: 1px solid #b7c5d8;
                background: linear-gradient(#fff,#f7fbff);
                color: #20385f;
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(32,56,95,.18), inset 0 1px 0 rgba(255,255,255,.85);
            }
            #sql-helper-toggle-btn:hover,
            .sql-helper-btn:hover,
            .sql-card-actions button:hover,
            .sql-card-header-actions button:hover {
                background: linear-gradient(#ffffff,#eaf3ff);
                border-color: #8fb0d8;
            }
            #sql-helper-panel {
                background: #fbfdff;
                color: #1f2937;
                border-left: 1px solid #cfdbe8;
                box-shadow: -3px 0 18px rgba(32,56,95,.18);
            }
            #sql-helper-header {
                background: linear-gradient(#f7fbff,#eaf1f9);
                border-bottom: 1px solid #cfdbe8;
                gap: 8px;
            }
            #sql-helper-header-title {
                color: #20385f;
                font-weight: 800;
                letter-spacing: .1px;
            }
            #sql-helper-search,
            #sql-helper-sort,
            #sql-helper-tag-filter,
            #sql-helper-comment-textarea,
            .sql-settings-row input[type="number"] {
                background: #fff;
                color: #20385f;
                border: 1px solid #b7c5d8;
                border-radius: 6px;
            }
            #sql-helper-search:focus {
                border-color: #8fb0d8;
                box-shadow: 0 0 0 2px rgba(143,176,216,.28);
            }
            #sql-helper-search-suggestions {
                background: #fff;
                border-color: #cfdbe8;
                box-shadow: 0 8px 24px rgba(32,56,95,.18);
            }
            .sql-search-suggestion { color: #40506a; }
            .sql-search-suggestion:hover { background: #eef4fb; color: #20385f; }
            .sql-helper-control-label,
            #sql-helper-footer,
            .sql-helper-comment-hint,
            .sql-helper-export-caption { color: #68758a; }
            .sql-helper-fav-label,
            #sql-helper-autosave-wrapper,
            .sql-helper-import-mode { color: #374151; }
            .sql-helper-btn,
            .sql-card-actions button,
            .sql-card-header-actions button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                min-height: 23px;
                border-radius: 6px;
                border: 1px solid #b7c5d8;
                background: linear-gradient(#fff,#f7fbff);
                color: #20385f;
                box-shadow: inset 0 1px 0 rgba(255,255,255,.85);
                white-space: nowrap;
            }
            .sql-helper-btn.secondary { border-color: #b7c5d8; background: linear-gradient(#fff,#f7fbff); }
            .sql-helper-btn.danger,
            .sql-card-actions .danger {
                border-color: #d99a31;
                color: #6b3d00;
                background: linear-gradient(#fff7e6,#ffe9bf);
            }
            .sql-helper-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 15px;
                height: 15px;
                flex: 0 0 15px;
                border-radius: 4px;
                background: linear-gradient(135deg,#f7fbff,#dcecff);
            }
            .sql-helper-icon svg {
                width: 13px;
                height: 13px;
                display: block;
                stroke: #185abd;
                fill: none;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .sql-helper-hide-icons .sql-helper-icon { display: none !important; }
            .sql-helper-icon-run { background: linear-gradient(135deg,#e8f5e9,#c8e6c9); }
            .sql-helper-icon-run svg { stroke: #107c10; fill: #107c10; }
            .sql-helper-icon-copy { background: linear-gradient(135deg,#eef6ff,#d7e8ff); }
            .sql-helper-icon-copy svg { stroke: #0078d4; }
            .sql-helper-icon-export { background: linear-gradient(135deg,#e6f4ea,#c7ead2); }
            .sql-helper-icon-export svg { stroke: #217346; }
            .sql-helper-icon-settings,
            .sql-helper-icon-edit { background: linear-gradient(135deg,#f3f2f1,#e1dfdd); }
            .sql-helper-icon-settings svg,
            .sql-helper-icon-edit svg { stroke: #5c2d91; }
            .sql-helper-icon-delete,
            .sql-helper-icon-clear { background: linear-gradient(135deg,#fff4ce,#fde7a9); }
            .sql-helper-icon-delete svg,
            .sql-helper-icon-clear svg { stroke: #ca5010; }
            .sql-card {
                background: #fff;
                border-color: #d6e0eb;
                border-radius: 8px;
                box-shadow: 0 1px 2px rgba(32,56,95,.08);
            }
            .sql-card.selected {
                border-color: #8fb0d8;
                box-shadow: 0 0 0 2px rgba(143,176,216,.24), 0 1px 2px rgba(32,56,95,.08);
            }
            .sql-card-actions { border-top-color: rgba(32,56,95,.10); }
            .sql-card-name { color: #20385f; }
            .sql-card-meta { color: #607089; }
            .sql-card-query {
                background: #f8fbff;
                border-color: #d6e0eb;
            }
            .sql-card-query pre { color: #1f2937; }
            .sql-line-no {
                color: #7a8798;
                border-right: 1px solid #d6e0eb;
                padding-right: 5px;
            }
            .sql-syn-keyword { color: #185abd; }
            .sql-syn-type { color: #5c2d91; }
            .sql-syn-function { color: #0078d4; }
            .sql-syn-string { color: #a4262c; }
            .sql-syn-number { color: #107c10; }
            .sql-syn-comment { color: #6b7280; }
            .sql-syn-operator { color: #605e5c; }
            .sql-show-more { color: #185abd; }
            .sql-tag {
                background: #eef4fb;
                border-color: #cfdbe8;
                color: #20385f;
                border-radius: 999px;
            }
            .sql-comment-preview-inline { color: #607089; }
            .sql-comment-expanded {
                border-left-color: #8fb0d8;
                color: #374151;
            }
            mark.sql-highlight {
                background: #fff4ce;
                color: #6b3d00;
            }
            #sql-helper-footer {
                background: #f8fbff;
                border-top-color: #d6e0eb;
                position: relative;
                z-index: 1000002;
                flex: 0 0 auto;
                min-height: 42px;
                overflow: visible;
            }
            #sql-helper-footer-left {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: nowrap;
                width: 100%;
                min-width: 0;
                padding-right: 304px;
                box-sizing: border-box;
            }
            #sql-helper-footer-info {
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                pointer-events: none;
            }
            #sql-helper-footer-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                position: absolute;
                top: 50%;
                right: 10px;
                transform: translateY(-50%);
                z-index: 1000003;
                pointer-events: auto;
                min-width: 294px;
                min-height: 34px;
                padding: 4px;
                box-sizing: border-box;
                background: inherit;
            }
            #sql-helper-footer-left .sql-helper-btn {
                flex: 0 0 auto;
                pointer-events: auto;
            }
            #sql-helper-footer-actions .sql-helper-btn {
                min-height: 30px;
                padding: 5px 9px;
                position: relative;
                z-index: 1000004;
            }
            #sql-helper-list {
                background: #fbfdff;
                min-height: 0;
                scrollbar-color: #b7c5d8 #eef4fb;
            }
            #sql-helper-list::-webkit-scrollbar-track {
                background: #eef4fb;
                border-left-color: #d6e0eb;
            }
            #sql-helper-list::-webkit-scrollbar-thumb {
                background: #b7c5d8;
                border-color: #eef4fb;
            }
            #sql-helper-comment-overlay,
            #sql-helper-export-overlay,
            #sql-helper-tags-overlay,
            #sql-helper-settings-overlay {
                background: rgba(15,23,42,.42);
            }
            #sql-helper-comment-modal,
            #sql-helper-export-modal,
            #sql-helper-tags-modal,
            #sql-helper-settings-modal {
                background: #fff;
                border-color: #cfdbe8;
                color: #1f2937;
                border-radius: 10px;
                box-shadow: 0 12px 44px rgba(0,0,0,.32);
            }
            #sql-helper-settings-modal {
                width: min(920px,94vw);
                max-height: 88vh;
            }
            #sql-helper-export-modal { width: min(760px,94vw); }
            #sql-helper-tags-modal { width: min(720px,94vw); }
            #sql-helper-comment-header,
            #sql-helper-export-header,
            #sql-helper-tags-header,
            #sql-helper-settings-header {
                background: linear-gradient(#f7fbff,#eaf1f9);
                border-bottom-color: #cfdbe8;
                color: #20385f;
            }
            #sql-helper-export-body,
            #sql-helper-tags-body,
            #sql-helper-settings-body {
                background: #fbfdff;
                overflow: auto;
            }
            .sql-tag-manager-row {
                background: #fff;
                border-color: #d6e0eb;
            }
            .sql-tags-manager-card {
                background: #fff;
                border-color: #d6e0eb;
            }
            .sql-tags-manager-title { color: #20385f; }
            .sql-tags-manager-hint { color: #68758a; }
            .sql-tags-manager-empty {
                background: #fff;
                border-color: #cfdbe8;
                color: #68758a;
            }
            .sql-tag-manager-name { color: #20385f; }
            .sql-tag-manager-count {
                color: #68758a;
                border-color: #d6e0eb;
                background: #f8fbff;
            }
            #sql-helper-settings-sections,
            #sql-helper-export-sections {
                display: grid;
                grid-template-columns: minmax(280px,1fr) minmax(280px,1fr);
                gap: 12px;
            }
            #sql-helper-export-sections > div {
                background: #fff;
                border: 1px solid #d6e0eb;
                border-radius: 8px;
                padding: 11px;
            }
            #sql-helper-export-sections > div[style*="border-top"] {
                grid-column: 1 / -1;
            }
            .sql-settings-section {
                background: #fff;
                border-color: #d6e0eb;
                border-radius: 8px;
                padding: 11px;
            }
            .sql-settings-section-title {
                color: #20385f;
                text-transform: uppercase;
                letter-spacing: .4px;
                font-size: 12px;
                font-weight: 800;
            }
            .sql-settings-row {
                grid-template-columns: 1fr minmax(120px,auto);
                border-bottom-color: rgba(32,56,95,.08);
            }
            .sql-settings-row select {
                min-width: 150px;
                padding: 4px 7px;
                border-radius: 6px;
                border: 1px solid #b7c5d8;
                background: #fff;
                color: #20385f;
                font-size: 12px;
                box-sizing: border-box;
            }
            .sql-settings-label strong { color: #374151; }
            .sql-settings-label span { color: #68758a; line-height: 1.35; }
            .sql-settings-range-wrap span { color: #607089 !important; }
            #sql-helper-comment-preview {
                background: #f8fbff;
                border-color: #d6e0eb;
                color: #1f2937;
            }
            #sql-helper-comment-editor { border-right-color: #d6e0eb; }
            #sql-helper-comment-footer,
            #sql-helper-export-footer,
            #sql-helper-tags-footer,
            #sql-helper-settings-footer {
                background: #f8fbff;
                border-top-color: #d6e0eb;
                color: #607089;
            }
            .sql-helper-comment-close { color: #607089; }
            .sql-helper-comment-close:hover { color: #ca5010; }
            .sql-helper-comment-close svg {
                width: 15px;
                height: 15px;
                display: block;
                stroke: currentColor;
                fill: none;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            body.sql-helper-theme-soft #sql-helper-panel,
            body.sql-helper-theme-soft #sql-helper-export-body,
            body.sql-helper-theme-soft #sql-helper-settings-body,
            body.sql-helper-theme-soft #sql-helper-list { background: #f6f8f4; }
            body.sql-helper-theme-soft #sql-helper-header,
            body.sql-helper-theme-soft #sql-helper-comment-header,
            body.sql-helper-theme-soft #sql-helper-export-header,
            body.sql-helper-theme-soft #sql-helper-tags-header,
            body.sql-helper-theme-soft #sql-helper-settings-header,
            body.sql-helper-theme-soft #sql-helper-footer,
            body.sql-helper-theme-soft #sql-helper-comment-footer,
            body.sql-helper-theme-soft #sql-helper-export-footer,
            body.sql-helper-theme-soft #sql-helper-tags-footer,
            body.sql-helper-theme-soft #sql-helper-settings-footer { background: linear-gradient(#fbfcf8,#edf3e8); border-color: #d5dfce; }
            body.sql-helper-theme-soft .sql-card,
            body.sql-helper-theme-soft .sql-tags-manager-card,
            body.sql-helper-theme-soft .sql-tag-manager-row,
            body.sql-helper-theme-soft .sql-settings-section,
            body.sql-helper-theme-soft #sql-helper-export-sections > div { border-color: #d5dfce; }
            body.sql-helper-theme-soft .sql-helper-btn,
            body.sql-helper-theme-soft .sql-card-actions button,
            body.sql-helper-theme-soft .sql-card-header-actions button,
            body.sql-helper-theme-soft #sql-helper-toggle-btn { border-color: #b9c9ad; color: #2f4f2f; background: linear-gradient(#fff,#f7fbf4); }
            body.sql-helper-theme-soft #sql-helper-header-title,
            body.sql-helper-theme-soft .sql-settings-section-title { color: #2f4f2f; }

            body.sql-helper-theme-dark #sql-helper-panel,
            body.sql-helper-theme-dark #sql-helper-list,
            body.sql-helper-theme-dark #sql-helper-export-body,
            body.sql-helper-theme-dark #sql-helper-settings-body { background: #111827; color: #e5e7eb; }
            body.sql-helper-theme-dark #sql-helper-header,
            body.sql-helper-theme-dark #sql-helper-footer,
            body.sql-helper-theme-dark #sql-helper-comment-header,
            body.sql-helper-theme-dark #sql-helper-export-header,
            body.sql-helper-theme-dark #sql-helper-tags-header,
            body.sql-helper-theme-dark #sql-helper-settings-header,
            body.sql-helper-theme-dark #sql-helper-comment-footer,
            body.sql-helper-theme-dark #sql-helper-export-footer,
            body.sql-helper-theme-dark #sql-helper-tags-footer,
            body.sql-helper-theme-dark #sql-helper-settings-footer { background: linear-gradient(#1f2937,#111827); border-color: #374151; color: #e5e7eb; }
            body.sql-helper-theme-dark .sql-card,
            body.sql-helper-theme-dark .sql-settings-section,
            body.sql-helper-theme-dark #sql-helper-export-sections > div,
            body.sql-helper-theme-dark #sql-helper-comment-modal,
            body.sql-helper-theme-dark #sql-helper-export-modal,
            body.sql-helper-theme-dark #sql-helper-tags-modal,
            body.sql-helper-theme-dark #sql-helper-settings-modal { background: #0f172a; border-color: #334155; color: #e5e7eb; }
            body.sql-helper-theme-dark .sql-tag-manager-row { background: #0f172a; border-color: #334155; }
            body.sql-helper-theme-dark .sql-tags-manager-card,
            body.sql-helper-theme-dark .sql-tags-manager-empty { background: #0f172a; border-color: #334155; }
            body.sql-helper-theme-dark .sql-tags-manager-title { color: #dbeafe; }
            body.sql-helper-theme-dark .sql-tags-manager-hint { color: #94a3b8; }
            body.sql-helper-theme-dark .sql-tag-manager-name { color: #e5e7eb; }
            body.sql-helper-theme-dark .sql-tag-manager-count { color: #94a3b8; border-color: #334155; background: #020617; }
            body.sql-helper-theme-dark #sql-helper-search,
            body.sql-helper-theme-dark #sql-helper-sort,
            body.sql-helper-theme-dark #sql-helper-tag-filter,
            body.sql-helper-theme-dark #sql-helper-comment-textarea,
            body.sql-helper-theme-dark .sql-settings-row input[type="number"],
            body.sql-helper-theme-dark .sql-settings-row select { background: #020617; color: #e5e7eb; border-color: #475569; }
            body.sql-helper-theme-dark .sql-card-query,
            body.sql-helper-theme-dark #sql-helper-comment-preview { background: #020617; border-color: #1e293b; color: #e5e7eb; }
            body.sql-helper-theme-dark .sql-card-query pre,
            body.sql-helper-theme-dark .sql-settings-label strong,
            body.sql-helper-theme-dark .sql-card-name,
            body.sql-helper-theme-dark .sql-helper-fav-label,
            body.sql-helper-theme-dark #sql-helper-autosave-wrapper,
            body.sql-helper-theme-dark .sql-helper-import-mode { color: #e5e7eb; }
            body.sql-helper-theme-dark .sql-line-no { color: #64748b; border-right-color: #334155; }
            body.sql-helper-theme-dark .sql-syn-keyword { color: #93c5fd; }
            body.sql-helper-theme-dark .sql-syn-type { color: #c4b5fd; }
            body.sql-helper-theme-dark .sql-syn-function { color: #67e8f9; }
            body.sql-helper-theme-dark .sql-syn-string { color: #fca5a5; }
            body.sql-helper-theme-dark .sql-syn-number { color: #86efac; }
            body.sql-helper-theme-dark .sql-syn-comment { color: #94a3b8; }
            body.sql-helper-theme-dark .sql-syn-operator { color: #cbd5e1; }
            body.sql-helper-theme-dark .sql-card-meta,
            body.sql-helper-theme-dark .sql-settings-label span,
            body.sql-helper-theme-dark #sql-helper-footer,
            body.sql-helper-theme-dark .sql-helper-export-caption { color: #94a3b8; }
            body.sql-helper-theme-dark .sql-helper-btn,
            body.sql-helper-theme-dark .sql-card-actions button,
            body.sql-helper-theme-dark .sql-card-header-actions button,
            body.sql-helper-theme-dark #sql-helper-toggle-btn { border-color: #475569; color: #e5e7eb; background: linear-gradient(#1f2937,#111827); }
            body.sql-helper-theme-dark #sql-helper-header-title,
            body.sql-helper-theme-dark .sql-settings-section-title { color: #dbeafe; }

            body.sql-helper-theme-contrast #sql-helper-panel,
            body.sql-helper-theme-contrast #sql-helper-list,
            body.sql-helper-theme-contrast #sql-helper-export-body,
            body.sql-helper-theme-contrast #sql-helper-settings-body { background: #fff; color: #111827; }
            body.sql-helper-theme-contrast #sql-helper-header,
            body.sql-helper-theme-contrast #sql-helper-footer,
            body.sql-helper-theme-contrast #sql-helper-comment-header,
            body.sql-helper-theme-contrast #sql-helper-export-header,
            body.sql-helper-theme-contrast #sql-helper-tags-header,
            body.sql-helper-theme-contrast #sql-helper-settings-header,
            body.sql-helper-theme-contrast #sql-helper-comment-footer,
            body.sql-helper-theme-contrast #sql-helper-export-footer,
            body.sql-helper-theme-contrast #sql-helper-tags-footer,
            body.sql-helper-theme-contrast #sql-helper-settings-footer { background: #fff; border-color: #111827; color: #111827; }
            body.sql-helper-theme-contrast .sql-card,
            body.sql-helper-theme-contrast .sql-settings-section,
            body.sql-helper-theme-contrast #sql-helper-export-sections > div,
            body.sql-helper-theme-contrast #sql-helper-comment-modal,
            body.sql-helper-theme-contrast #sql-helper-export-modal,
            body.sql-helper-theme-contrast #sql-helper-tags-modal,
            body.sql-helper-theme-contrast #sql-helper-settings-modal { background: #fff; border-color: #111827; color: #111827; box-shadow: none; }
            body.sql-helper-theme-contrast .sql-tag-manager-row { background: #fff; border-color: #111827; }
            body.sql-helper-theme-contrast .sql-tags-manager-card,
            body.sql-helper-theme-contrast .sql-tags-manager-empty { background: #fff; border-color: #111827; color: #111827; }
            body.sql-helper-theme-contrast .sql-tags-manager-title,
            body.sql-helper-theme-contrast .sql-tags-manager-hint { color: #111827; }
            body.sql-helper-theme-contrast .sql-tag-manager-name,
            body.sql-helper-theme-contrast .sql-tag-manager-count { color: #111827; border-color: #111827; background: #fff; }
            body.sql-helper-theme-contrast #sql-helper-search,
            body.sql-helper-theme-contrast #sql-helper-sort,
            body.sql-helper-theme-contrast #sql-helper-tag-filter,
            body.sql-helper-theme-contrast #sql-helper-comment-textarea,
            body.sql-helper-theme-contrast .sql-settings-row input[type="number"],
            body.sql-helper-theme-contrast .sql-settings-row select { background: #fff; color: #111827; border-color: #111827; }
            body.sql-helper-theme-contrast .sql-helper-btn,
            body.sql-helper-theme-contrast .sql-card-actions button,
            body.sql-helper-theme-contrast .sql-card-header-actions button,
            body.sql-helper-theme-contrast #sql-helper-toggle-btn { border-color: #111827; color: #111827; background: #fff; box-shadow: none; }
            body.sql-helper-theme-contrast #sql-helper-header-title,
            body.sql-helper-theme-contrast .sql-settings-section-title,
            body.sql-helper-theme-contrast .sql-card-name,
            body.sql-helper-theme-contrast .sql-settings-label strong,
            body.sql-helper-theme-contrast .sql-card-query pre { color: #111827; }
            body.sql-helper-theme-contrast .sql-line-no { color: #111827; border-right-color: #111827; opacity: 1; }
            body.sql-helper-theme-contrast .sql-syn-keyword,
            body.sql-helper-theme-contrast .sql-syn-type,
            body.sql-helper-theme-contrast .sql-syn-function,
            body.sql-helper-theme-contrast .sql-syn-string,
            body.sql-helper-theme-contrast .sql-syn-number,
            body.sql-helper-theme-contrast .sql-syn-comment,
            body.sql-helper-theme-contrast .sql-syn-operator { color: #111827; font-weight: 700; }
            @media(max-width:820px){
                #sql-helper-settings-sections,
                #sql-helper-export-sections { grid-template-columns: 1fr; }
                #sql-helper-comment-body { grid-template-columns: 1fr; }
                #sql-helper-comment-editor { border-right: 0; border-bottom: 1px solid #d6e0eb; }
            }
        `;
        document.head.appendChild(style);
    }

    function applyThemeClass(theme) {
        document.body.classList.remove(
            'sql-helper-theme-office',
            'sql-helper-theme-soft',
            'sql-helper-theme-dark',
            'sql-helper-theme-contrast'
        );
        document.body.classList.add(`sql-helper-theme-${theme || DEFAULT_SETTINGS.interface.theme}`);
    }

    function applySettingsToUI() {
        const settings = getSettings();

        document.documentElement.style.setProperty('--sql-helper-panel-width', `${settings.interface.panelWidth}px`);

        applyThemeClass(settings.interface.theme);
        document.body.classList.toggle('sql-helper-hide-icons', !settings.interface.showIcons);
        if (state.panel) state.panel.classList.toggle('sql-helper-hide-icons', !settings.interface.showIcons);
        if (state.toggleBtnRef) state.toggleBtnRef.classList.toggle('sql-helper-hide-icons', !settings.interface.showIcons);

        if (state.commentTextarea) {
            state.commentTextarea.maxLength = settings.history.commentMaxLength;
        }
    }

    /********************************************************************
     * MODAL COMENTÁRIO
     ********************************************************************/

    function updateCommentPreview(text) {
        if (!state.commentPreview) return;
        state.commentPreview.innerHTML = text.trim()
            ? renderMarkdown(text)
            : '<span style="color:#6b7280;font-size:11px;">O preview aparecerá aqui...</span>';
    }

    function closeCommentModal() {
        state.currentCommentItemId = null;
        if (state.commentOverlay) state.commentOverlay.style.display = 'none';
    }

    function openCommentModal(item) {
        state.currentCommentItemId = item.id;
        const maxLength = getCommentMaxLength();
        state.commentTextarea.maxLength = maxLength;
        state.commentTextarea.value = item.comment || '';
        updateCommentPreview(state.commentTextarea.value);
        state.commentOverlay.style.display = 'flex';
        state.commentTextarea.focus();
    }

    function createCommentModal() {
        const overlay = document.createElement('div');
        overlay.id = 'sql-helper-comment-overlay';

        const modal = document.createElement('div');
        modal.id = 'sql-helper-comment-modal';

        const header = document.createElement('div');
        header.id = 'sql-helper-comment-header';
        header.innerHTML = '<div>Comentário da Query</div>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sql-helper-comment-close';
        closeBtn.innerHTML = getHistoryIconSvg('close');
        closeBtn.title = 'Fechar';
        closeBtn.addEventListener('click', closeCommentModal);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.id = 'sql-helper-comment-body';

        const editorWrapper = document.createElement('div');
        editorWrapper.id = 'sql-helper-comment-editor';
        editorWrapper.innerHTML = `<label>Comentário (Markdown):</label>`;

        const textarea = document.createElement('textarea');
        textarea.id = 'sql-helper-comment-textarea';
        textarea.placeholder = 'Em termos práticos, você pode usar essa query para...\n\nUse **negrito**, *itálico*, `código`,\n- listas\n# títulos';
        textarea.maxLength = getCommentMaxLength();
        editorWrapper.appendChild(textarea);

        const previewWrapper = document.createElement('div');
        previewWrapper.id = 'sql-helper-comment-preview-wrapper';
        previewWrapper.innerHTML = '<label>Preview:</label>';

        const preview = document.createElement('div');
        preview.id = 'sql-helper-comment-preview';
        previewWrapper.appendChild(preview);

        body.appendChild(editorWrapper);
        body.appendChild(previewWrapper);

        const footer = document.createElement('div');
        footer.id = 'sql-helper-comment-footer';

        const hint = document.createElement('div');
        hint.className = 'sql-helper-comment-hint';
        hint.textContent = `Limite configurado: ${getCommentMaxLength()} caracteres.`;

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '6px';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(clearBtn, 'Limpar comentário', 'clear');
        clearBtn.addEventListener('click', () => {
            if (!state.currentCommentItemId) return closeCommentModal();
            updateHistoryEntry(state.currentCommentItemId, { comment: '' });
            closeCommentModal();
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'sql-helper-btn';
        setIconButtonContent(saveBtn, 'Salvar', 'settings');
        saveBtn.addEventListener('click', () => {
            if (!state.currentCommentItemId) return closeCommentModal();
            const text = String(textarea.value || '').slice(0, getCommentMaxLength());
            updateHistoryEntry(state.currentCommentItemId, { comment: text });
            closeCommentModal();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'sql-helper-btn danger';
        setIconButtonContent(cancelBtn, 'Cancelar', 'close');
        cancelBtn.addEventListener('click', closeCommentModal);

        buttons.append(clearBtn, saveBtn, cancelBtn);
        footer.append(hint, buttons);

        modal.append(header, body, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        textarea.addEventListener('input', () => {
            const max = getCommentMaxLength();
            if (textarea.value.length > max) {
                textarea.value = textarea.value.slice(0, max);
            }
            hint.textContent = `Limite configurado: ${max} caracteres.`;
            updateCommentPreview(textarea.value);
        });

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeCommentModal();
        });

        state.commentOverlay = overlay;
        state.commentTextarea = textarea;
        state.commentPreview = preview;
        updateCommentPreview('');
    }

    /********************************************************************
     * MODAL EXPORT / IMPORT
     ********************************************************************/

    function closeExportModal() {
        if (state.exportOverlay) state.exportOverlay.style.display = 'none';
    }

    function openExportModal() {
        if (state.exportOverlay) state.exportOverlay.style.display = 'flex';
    }

    function handleImportFile() {
        const file = state.exportImportFileInput?.files?.[0];
        if (!file) {
            alert('Selecione um arquivo CSV ou JSON para importar.');
            return;
        }

        const mode = state.importModeReplaceRadio?.checked ? 'replace' : 'merge';
        const reader = new FileReader();

        reader.onload = e => {
            const text = String(e.target?.result || '');
            const name = file.name.toLowerCase();
            if (name.endsWith('.json')) return importFromJSON(text, mode);
            if (name.endsWith('.csv') || name.endsWith('.txt')) return importFromCSV(text, mode);
            return text.trim().startsWith('[') ? importFromJSON(text, mode) : importFromCSV(text, mode);
        };

        reader.onerror = () => alert('Erro ao ler o arquivo para importação.');
        reader.readAsText(file, 'utf-8');
    }

    function createExportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'sql-helper-export-overlay';

        const modal = document.createElement('div');
        modal.id = 'sql-helper-export-modal';

        const header = document.createElement('div');
        header.id = 'sql-helper-export-header';
        header.innerHTML = '<div>Exportar / Importar histórico</div>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sql-helper-comment-close';
        closeBtn.innerHTML = getHistoryIconSvg('close');
        closeBtn.title = 'Fechar';
        closeBtn.addEventListener('click', closeExportModal);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.id = 'sql-helper-export-body';
        body.innerHTML = '<div>Use esta tela para exportar seu histórico ou importar de outro analista.</div>';

        const sections = document.createElement('div');
        sections.id = 'sql-helper-export-sections';

        const exportSection = document.createElement('div');
        exportSection.innerHTML = '<div style="font-weight:600;">Exportar</div>';

        const exportOptions = document.createElement('div');
        exportOptions.id = 'sql-helper-export-options';

        const btnJson = document.createElement('button');
        btnJson.className = 'sql-helper-btn';
        setIconButtonContent(btnJson, 'Exportar JSON', 'export');
        btnJson.addEventListener('click', exportHistoryJSON);

        const jsonCaption = document.createElement('div');
        jsonCaption.className = 'sql-helper-export-caption';
        jsonCaption.textContent = 'Ideal para backup e reimportação programática.';

        const btnCsv = document.createElement('button');
        btnCsv.className = 'sql-helper-btn secondary';
        setIconButtonContent(btnCsv, 'Exportar CSV', 'export');
        btnCsv.addEventListener('click', exportHistoryCSV);

        const csvCaption = document.createElement('div');
        csvCaption.className = 'sql-helper-export-caption';
        csvCaption.textContent = 'Separador ";" – abre bem no Excel/Sheets.';

        exportOptions.append(btnJson, jsonCaption, btnCsv, csvCaption);
        exportSection.appendChild(exportOptions);

        const importSection = document.createElement('div');
        importSection.innerHTML = '<div style="font-weight:600;">Importar</div>';

        const importOptions = document.createElement('div');
        importOptions.id = 'sql-helper-import-options';

        const importRow = document.createElement('div');
        importRow.className = 'sql-helper-import-row';

        const importMode = document.createElement('div');
        importMode.className = 'sql-helper-import-mode';
        importMode.innerHTML = '<div>Modo de importação:</div>';

        const mergeRadio = document.createElement('input');
        mergeRadio.type = 'radio';
        mergeRadio.name = 'sql-helper-import-mode';
        mergeRadio.value = 'merge';
        mergeRadio.checked = true;

        const mergeLabel = document.createElement('label');
        mergeLabel.append(mergeRadio, document.createTextNode('Mesclar com histórico atual (mantém tudo).'));

        const replaceRadio = document.createElement('input');
        replaceRadio.type = 'radio';
        replaceRadio.name = 'sql-helper-import-mode';
        replaceRadio.value = 'replace';

        const replaceLabel = document.createElement('label');
        replaceLabel.append(replaceRadio, document.createTextNode('Substituir histórico atual (cuidado!).'));

        importMode.append(mergeLabel, replaceLabel);

        const fileRow = document.createElement('div');
        fileRow.className = 'sql-helper-import-file';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,.csv,.txt';

        const importBtn = document.createElement('button');
        importBtn.className = 'sql-helper-btn';
        setIconButtonContent(importBtn, 'Importar arquivo', 'paste');
        importBtn.addEventListener('click', handleImportFile);

        fileRow.append(fileInput, importBtn);

        const importCaption = document.createElement('div');
        importCaption.className = 'sql-helper-export-caption';
        importCaption.textContent = 'Aceita arquivos JSON/CSV gerados por este painel.';

        importRow.append(importMode, fileRow, importCaption);
        importOptions.appendChild(importRow);
        importSection.appendChild(importOptions);

        const dangerSection = document.createElement('div');
        dangerSection.style.borderTop = '1px solid #d6e0eb';
        dangerSection.style.paddingTop = '10px';

        const dangerTitle = document.createElement('div');
        dangerTitle.style.fontWeight = '600';
        dangerTitle.style.color = '#6b3d00';
        dangerTitle.textContent = 'Zona de perigo';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'sql-helper-btn danger';
        setIconButtonContent(clearBtn, 'Limpar todo o histórico', 'delete');
        clearBtn.style.marginTop = '6px';
        clearBtn.addEventListener('click', () => {
            if (confirm('Apagar TODO o histórico de queries desta tela? Esta ação não pode ser desfeita.')) {
                clearHistory();
                closeExportModal();
            }
        });

        const dangerCaption = document.createElement('div');
        dangerCaption.className = 'sql-helper-export-caption';
        dangerCaption.textContent = 'Remove permanentemente todas as queries salvas.';
        dangerCaption.style.marginTop = '4px';

        dangerSection.append(dangerTitle, clearBtn, dangerCaption);
        sections.append(exportSection, importSection, dangerSection);

        body.appendChild(sections);

        const footer = document.createElement('div');
        footer.id = 'sql-helper-export-footer';

        const info = document.createElement('div');
        info.textContent = 'Dica: filtros ativos também afetam a exportação.';

        const footerCloseBtn = document.createElement('button');
        footerCloseBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(footerCloseBtn, 'Fechar', 'close');
        footerCloseBtn.addEventListener('click', closeExportModal);

        footer.append(info, footerCloseBtn);
        modal.append(header, body, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeExportModal();
        });

        state.exportOverlay = overlay;
        state.exportImportFileInput = fileInput;
        state.importModeMergeRadio = mergeRadio;
        state.importModeReplaceRadio = replaceRadio;
    }

    /********************************************************************
     * MODAL CONFIGURAÇÕES
     ********************************************************************/

    function closeSettingsModal() {
        applySettingsToUI();
        if (state.settingsOverlay) state.settingsOverlay.style.display = 'none';
    }

    function closeTagsManager() {
        if (state.tagsOverlay) state.tagsOverlay.style.display = 'none';
    }

    function openTagsManager() {
        if (!state.tagsOverlay) createTagsManagerModal();
        renderTagsManagerList();
        state.tagsOverlay.style.display = 'flex';
    }

    function renderTagsManagerList() {
        if (!state.tagsListContainer) return;
        const history = loadHistory();
        const tags = collectAllTags(history);
        state.tagsListContainer.innerHTML = '';

        if (!tags.length) {
            const empty = document.createElement('div');
            empty.className = 'sql-tags-manager-empty';
            empty.textContent = 'Nenhuma etiqueta criada ainda.';
            state.tagsListContainer.appendChild(empty);
            return;
        }

        tags.forEach(tag => {
            const row = document.createElement('div');
            row.className = 'sql-tag-manager-row';

            const main = document.createElement('div');
            main.className = 'sql-tag-manager-main';

            const name = document.createElement('div');
            name.className = 'sql-tag-manager-name';
            name.textContent = tag;
            name.title = tag;

            const count = document.createElement('div');
            count.className = 'sql-tag-manager-count';
            count.textContent = `${countTagUsage(history, tag)} uso(s)`;

            const actions = document.createElement('div');
            actions.className = 'sql-tag-manager-actions';

            const renameBtn = document.createElement('button');
            renameBtn.className = 'sql-helper-btn secondary';
            setIconButtonContent(renameBtn, 'Renomear', 'edit');
            renameBtn.addEventListener('click', () => {
                const next = prompt('Novo nome da etiqueta:', tag);
                if (next === null) return;
                const cleanNext = next.trim();
                if (!cleanNext || cleanNext === tag) return;
                renameTagEverywhere(tag, cleanNext);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'sql-helper-btn danger';
            setIconButtonContent(deleteBtn, 'Excluir', 'delete');
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Remover a etiqueta "${tag}" de todas as queries?`)) deleteTagEverywhere(tag);
            });

            actions.append(renameBtn, deleteBtn);
            main.append(name, count);
            row.append(main, actions);
            state.tagsListContainer.appendChild(row);
        });
    }

    function createTagsManagerModal() {
        const overlay = document.createElement('div');
        overlay.id = 'sql-helper-tags-overlay';

        const modal = document.createElement('div');
        modal.id = 'sql-helper-tags-modal';

        const header = document.createElement('div');
        header.id = 'sql-helper-tags-header';
        header.innerHTML = '<div><div>Etiquetas</div><span style="display:block;font-size:11px;font-weight:400;color:#607089;margin-top:2px;">Renomeie ou remova etiquetas em todas as queries.</span></div>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sql-helper-comment-close';
        closeBtn.innerHTML = getHistoryIconSvg('close');
        closeBtn.title = 'Fechar';
        closeBtn.addEventListener('click', closeTagsManager);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.id = 'sql-helper-tags-body';

        const card = document.createElement('div');
        card.className = 'sql-tags-manager-card';

        const cardTitle = document.createElement('div');
        cardTitle.className = 'sql-tags-manager-title';
        cardTitle.textContent = 'Etiquetas criadas';

        const cardHint = document.createElement('div');
        cardHint.className = 'sql-tags-manager-hint';
        cardHint.textContent = 'Renomear combina etiquetas iguais; excluir apenas remove a etiqueta, sem apagar queries.';

        const list = document.createElement('div');
        list.id = 'sql-helper-tags-list';
        card.append(cardTitle, cardHint, list);
        body.appendChild(card);

        const footer = document.createElement('div');
        footer.id = 'sql-helper-tags-footer';

        const info = document.createElement('div');
        info.textContent = 'Alterações afetam todas as queries que usam a etiqueta.';

        const doneBtn = document.createElement('button');
        doneBtn.className = 'sql-helper-btn';
        setIconButtonContent(doneBtn, 'Concluir', 'settings');
        doneBtn.addEventListener('click', closeTagsManager);

        footer.append(info, doneBtn);
        modal.append(header, body, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeTagsManager();
        });

        state.tagsOverlay = overlay;
        state.tagsListContainer = list;
    }

    function openSettingsModal() {
        if (!state.settingsOverlay) return;

        const settings = getSettings();

        const autoSave = state.settingsOverlay.querySelector('[data-setting="capture.autoSaveEnabled"]');
        const captureOnRun = state.settingsOverlay.querySelector('[data-setting="capture.captureOnRunButton"]');
        const captureOnCtrlEnter = state.settingsOverlay.querySelector('[data-setting="capture.captureOnCtrlEnter"]');
        const ignoreDupes = state.settingsOverlay.querySelector('[data-setting="capture.ignoreConsecutiveDuplicates"]');

        const maxItems = state.settingsOverlay.querySelector('[data-setting="history.maxItems"]');
        const recentSearchesMax = state.settingsOverlay.querySelector('[data-setting="history.recentSearchesMax"]');
        const commentMaxLength = state.settingsOverlay.querySelector('[data-setting="history.commentMaxLength"]');

        const panelWidth = state.settingsOverlay.querySelector('[data-setting="interface.panelWidth"]');
        const panelWidthValue = state.settingsOverlay.querySelector('[data-setting-label="interface.panelWidth"]');
        const theme = state.settingsOverlay.querySelector('[data-setting="interface.theme"]');
        const cardsExpanded = state.settingsOverlay.querySelector('[data-setting="interface.cardsExpandedByDefault"]');
        const showRunCount = state.settingsOverlay.querySelector('[data-setting="interface.showRunCount"]');
        const showIcons = state.settingsOverlay.querySelector('[data-setting="interface.showIcons"]');

        if (autoSave) autoSave.checked = settings.capture.autoSaveEnabled;
        if (captureOnRun) captureOnRun.checked = settings.capture.captureOnRunButton;
        if (captureOnCtrlEnter) captureOnCtrlEnter.checked = settings.capture.captureOnCtrlEnter;
        if (ignoreDupes) ignoreDupes.checked = settings.capture.ignoreConsecutiveDuplicates;

        if (maxItems) maxItems.value = settings.history.maxItems;
        if (recentSearchesMax) recentSearchesMax.value = settings.history.recentSearchesMax;
        if (commentMaxLength) commentMaxLength.value = settings.history.commentMaxLength;

        if (panelWidth) panelWidth.value = settings.interface.panelWidth;
        if (panelWidthValue) panelWidthValue.textContent = `${settings.interface.panelWidth}px`;
        if (theme) theme.value = settings.interface.theme;
        if (cardsExpanded) cardsExpanded.checked = settings.interface.cardsExpandedByDefault;
        if (showRunCount) showRunCount.checked = settings.interface.showRunCount;
        if (showIcons) showIcons.checked = settings.interface.showIcons;

        state.settingsOverlay.style.display = 'flex';
    }

    function createSettingsRow({ title, description, control }) {
        const row = document.createElement('div');
        row.className = 'sql-settings-row';

        const label = document.createElement('div');
        label.className = 'sql-settings-label';
        label.innerHTML = `<strong>${title}</strong><span>${description}</span>`;

        row.append(label, control);
        return row;
    }

    function createSettingsModal() {
        const overlay = document.createElement('div');
        overlay.id = 'sql-helper-settings-overlay';

        const modal = document.createElement('div');
        modal.id = 'sql-helper-settings-modal';

        const header = document.createElement('div');
        header.id = 'sql-helper-settings-header';
        header.innerHTML = '<div><div>Configurações</div><span style="display:block;font-size:11px;font-weight:400;color:#607089;margin-top:2px;">Organize captura, histórico, aparência e dados.</span></div>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sql-helper-comment-close';
        closeBtn.innerHTML = getHistoryIconSvg('close');
        closeBtn.title = 'Fechar';
        closeBtn.addEventListener('click', closeSettingsModal);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.id = 'sql-helper-settings-body';

        const sections = document.createElement('div');
        sections.id = 'sql-helper-settings-sections';

        const captureSection = document.createElement('div');
        captureSection.className = 'sql-settings-section';
        captureSection.innerHTML = '<div class="sql-settings-section-title">Captura</div>';

        const autoSave = document.createElement('input');
        autoSave.type = 'checkbox';
        autoSave.setAttribute('data-setting', 'capture.autoSaveEnabled');

        const captureOnRun = document.createElement('input');
        captureOnRun.type = 'checkbox';
        captureOnRun.setAttribute('data-setting', 'capture.captureOnRunButton');

        const captureOnCtrlEnter = document.createElement('input');
        captureOnCtrlEnter.type = 'checkbox';
        captureOnCtrlEnter.setAttribute('data-setting', 'capture.captureOnCtrlEnter');

        const ignoreDupes = document.createElement('input');
        ignoreDupes.type = 'checkbox';
        ignoreDupes.setAttribute('data-setting', 'capture.ignoreConsecutiveDuplicates');

        captureSection.append(
            createSettingsRow({
                title: 'Capturar histórico automaticamente',
                description: 'Liga/desliga o salvamento automático do histórico.',
                control: autoSave
            }),
            createSettingsRow({
                title: 'Capturar ao clicar em Executar',
                description: 'Salva a query quando o botão Executar for usado.',
                control: captureOnRun
            }),
            createSettingsRow({
                title: 'Capturar ao pressionar Ctrl+Enter',
                description: 'Salva a query quando Ctrl+Enter for usado no editor.',
                control: captureOnCtrlEnter
            }),
            createSettingsRow({
                title: 'Ignorar queries repetidas em sequência',
                description: 'Evita duplicar entradas consecutivas iguais; apenas incrementa o contador.',
                control: ignoreDupes
            })
        );

        const historySection = document.createElement('div');
        historySection.className = 'sql-settings-section';
        historySection.innerHTML = '<div class="sql-settings-section-title">Histórico</div>';

        const maxItems = document.createElement('input');
        maxItems.type = 'number';
        maxItems.min = '100';
        maxItems.max = '99999999';
        maxItems.step = '100';
        maxItems.setAttribute('data-setting', 'history.maxItems');

        const recentSearchesMax = document.createElement('input');
        recentSearchesMax.type = 'number';
        recentSearchesMax.min = '3';
        recentSearchesMax.max = '20';
        recentSearchesMax.step = '1';
        recentSearchesMax.setAttribute('data-setting', 'history.recentSearchesMax');

        const commentMaxLength = document.createElement('input');
        commentMaxLength.type = 'number';
        commentMaxLength.min = '100';
        commentMaxLength.max = '2000';
        commentMaxLength.step = '50';
        commentMaxLength.setAttribute('data-setting', 'history.commentMaxLength');

        historySection.append(
            createSettingsRow({
                title: 'Limite de itens salvos',
                description: 'Define quantas queries podem ficar no histórico.',
                control: maxItems
            }),
            createSettingsRow({
                title: 'Limite de buscas recentes',
                description: 'Quantidade máxima de buscas recentes exibidas nas sugestões.',
                control: recentSearchesMax
            }),
            createSettingsRow({
                title: 'Limite de caracteres do comentário',
                description: 'Tamanho máximo do comentário salvo em cada query.',
                control: commentMaxLength
            })
        );

        const interfaceSection = document.createElement('div');
        interfaceSection.className = 'sql-settings-section';
        interfaceSection.innerHTML = '<div class="sql-settings-section-title">Interface</div>';

        const panelWidthWrap = document.createElement('div');
        panelWidthWrap.className = 'sql-settings-range-wrap';

        const panelWidth = document.createElement('input');
        panelWidth.type = 'range';
        panelWidth.min = '320';
        panelWidth.max = '700';
        panelWidth.step = '10';
        panelWidth.setAttribute('data-setting', 'interface.panelWidth');

        const panelWidthValue = document.createElement('span');
        panelWidthValue.setAttribute('data-setting-label', 'interface.panelWidth');
        panelWidthValue.style.minWidth = '52px';
        panelWidthValue.style.color = '#cbd5e1';
        panelWidthValue.style.fontSize = '11px';

        panelWidth.addEventListener('input', () => {
            panelWidthValue.textContent = `${panelWidth.value}px`;
        });

        panelWidthWrap.append(panelWidth, panelWidthValue);

        const themeSelect = document.createElement('select');
        themeSelect.setAttribute('data-setting', 'interface.theme');
        [
            { value: 'office', label: 'Office claro' },
            { value: 'soft', label: 'Suave' },
            { value: 'dark', label: 'Escuro' },
            { value: 'contrast', label: 'Alto contraste' }
        ].forEach(({ value, label }) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            themeSelect.appendChild(option);
        });
        themeSelect.addEventListener('change', () => {
            applyThemeClass(themeSelect.value);
        });

        const cardsExpanded = document.createElement('input');
        cardsExpanded.type = 'checkbox';
        cardsExpanded.setAttribute('data-setting', 'interface.cardsExpandedByDefault');

        const showRunCount = document.createElement('input');
        showRunCount.type = 'checkbox';
        showRunCount.setAttribute('data-setting', 'interface.showRunCount');

        const showIcons = document.createElement('input');
        showIcons.type = 'checkbox';
        showIcons.setAttribute('data-setting', 'interface.showIcons');

        interfaceSection.append(
            createSettingsRow({
                title: 'Largura do painel',
                description: 'Ajusta a largura lateral do painel.',
                control: panelWidthWrap
            }),
            createSettingsRow({
                title: 'Tema visual',
                description: 'Troca as cores do painel e dos modais.',
                control: themeSelect
            }),
            createSettingsRow({
                title: 'Cards expandidos por padrão',
                description: 'Quando desligado, os cards começam recolhidos.',
                control: cardsExpanded
            }),
            createSettingsRow({
                title: 'Exibir contagem de execuções no card',
                description: 'Mostra o total de execuções no cabeçalho do card.',
                control: showRunCount
            }),
            createSettingsRow({
                title: 'Mostrar ícones nos botões',
                description: 'Alterna entre botões com ícone e botões somente texto.',
                control: showIcons
            })
        );

        const dangerSection = document.createElement('div');
        dangerSection.className = 'sql-settings-section';
        dangerSection.innerHTML = '<div class="sql-settings-section-title">Dados e restauração</div>';

        const dangerActions = document.createElement('div');
        dangerActions.className = 'sql-settings-danger-actions';

        const clearRecentBtn = document.createElement('button');
        clearRecentBtn.className = 'sql-helper-btn danger';
        setIconButtonContent(clearRecentBtn, 'Limpar buscas recentes', 'clear');
        clearRecentBtn.addEventListener('click', () => {
            const total = loadRecentSearches().length;
            if (!total) {
                alert('Não há buscas recentes para limpar.');
                return;
            }
            if (confirm(`Remover ${total} busca(s) recente(s)? Esta ação não pode ser desfeita.`)) {
                clearRecentSearches();
                alert('Buscas recentes removidas.');
            }
        });

        const resetSettingsBtn = document.createElement('button');
        resetSettingsBtn.className = 'sql-helper-btn danger';
        setIconButtonContent(resetSettingsBtn, 'Restaurar padrão', 'reset');
        resetSettingsBtn.addEventListener('click', () => {
            if (confirm('Redefinir todas as configurações para o padrão?')) {
                resetSettings();
                openSettingsModal();
                alert('Configurações redefinidas.');
            }
        });

        dangerActions.append(clearRecentBtn, resetSettingsBtn);
        dangerSection.appendChild(dangerActions);

        sections.append(captureSection, historySection, interfaceSection, dangerSection);
        body.appendChild(sections);

        const footer = document.createElement('div');
        footer.id = 'sql-helper-settings-footer';

        const info = document.createElement('div');
        info.textContent = 'O tema pode ser pré-visualizado; as alterações ficam salvas ao concluir.';

        const footerButtons = document.createElement('div');
        footerButtons.style.display = 'flex';
        footerButtons.style.gap = '6px';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(cancelBtn, 'Cancelar', 'close');
        cancelBtn.addEventListener('click', closeSettingsModal);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'sql-helper-btn';
        setIconButtonContent(saveBtn, 'Salvar', 'settings');
        saveBtn.addEventListener('click', () => {
            const current = getSettings();

            const next = deepMerge(current, {
                capture: {
                    autoSaveEnabled: !!autoSave.checked,
                    captureOnRunButton: !!captureOnRun.checked,
                    captureOnCtrlEnter: !!captureOnCtrlEnter.checked,
                    ignoreConsecutiveDuplicates: !!ignoreDupes.checked
                },
                history: {
                    maxItems: clamp(Number(maxItems.value) || DEFAULT_SETTINGS.history.maxItems, 100, 99999999),
                    recentSearchesMax: clamp(Number(recentSearchesMax.value) || DEFAULT_SETTINGS.history.recentSearchesMax, 3, 20),
                    commentMaxLength: clamp(Number(commentMaxLength.value) || DEFAULT_SETTINGS.history.commentMaxLength, 100, 2000)
                },
                interface: {
                    panelWidth: clamp(Number(panelWidth.value) || DEFAULT_SETTINGS.interface.panelWidth, 320, 700),
                    theme: themeSelect.value,
                    cardsExpandedByDefault: !!cardsExpanded.checked,
                    showRunCount: !!showRunCount.checked,
                    showIcons: !!showIcons.checked
                }
            });

            saveSettings(next);

            // Ajustar listas persistidas aos novos limites
            const recent = loadRecentSearches().slice(0, next.history.recentSearchesMax);
            StorageService.setJson(RECENT_SEARCHES_KEY, recent, 'buscas recentes');
            saveHistory(loadHistory());

            applySettingsToUI();
            renderHistoryList();
            closeSettingsModal();
        });

        footerButtons.append(cancelBtn, saveBtn);
        footer.append(info, footerButtons);

        modal.append(header, body, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeSettingsModal();
        });

        state.settingsOverlay = overlay;
    }

    /********************************************************************
     * UI PRINCIPAL
     ********************************************************************/

    function togglePanel(forceOpen) {
        if (!state.panel) return;
        const willOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : state.panel.classList.contains('hidden');

        if (!willOpen) persistCurrentUiState();

        state.panel.classList.toggle('hidden', !willOpen);
        if (state.toggleBtnRef) {
            state.toggleBtnRef.style.display = willOpen ? 'none' : 'block';
        }
        saveUiState({ panelOpen: willOpen });

        if (willOpen) {
            const ui = loadUiState();
            if (state.searchInput && ui.searchValue) {
                state.searchInput.value = ui.searchValue;
                if (state.searchClearBtn) state.searchClearBtn.style.display = 'block';
            }
            if (state.favoritesOnlyCheckbox) {
                state.favoritesOnlyCheckbox.checked = ui.favOnly;
            }

            renderHistoryList();

            if (state.tagFilterSelect && ui.selectedTag) {
                state.tagFilterSelect.value = ui.selectedTag;
            }
            if (state.sortSelect && ui.sortValue) {
                state.sortSelect.value = ui.sortValue;
            }

            requestAnimationFrame(() => {
                if (state.listContainer && ui.scrollTop) {
                    state.listContainer.scrollTop = ui.scrollTop;
                }
            });
        }
    }

    function selectHistoryCard(card, itemId) {
        state.selectedHistoryItemId = itemId;
        if (!state.listContainer) return;
        state.listContainer.querySelectorAll('.sql-card.selected').forEach(el => {
            if (el !== card) el.classList.remove('selected');
        });
        if (card) card.classList.add('selected');
    }

    function renderHistoryList() {
        if (!state.listContainer) return;

        const settings = getSettings();
        const savedScroll = state.listContainer.scrollTop;
        const history = loadHistory();

        const rawSearch = (state.searchInput?.value || '').trim();
        const terms = rawSearch ? parseSearchTerms(rawSearch) : [];
        const onlyFavorites = !!state.favoritesOnlyCheckbox?.checked;
        const selectedTag = (state.tagFilterSelect?.value || '').trim();
        const sortValue  = (state.sortSelect?.value || 'lastUsed_desc');

        const filtered = history.filter(item => {
            if (onlyFavorites && !item.isFavorite) return false;

            if (selectedTag === '__with_tags__') return item.tags.length > 0;
            if (selectedTag === '__without_tags__') return item.tags.length === 0;
            if (selectedTag && !['__with_tags__', '__without_tags__', ''].includes(selectedTag) && !item.tags.includes(selectedTag)) return false;

            if (!terms.length) return true;

            return terms.every(term => {
                if (term.type === 'from') {
                    return normalizeForSearch(item.query).includes(term.value);
                }
                if (term.type === 'date') {
                    const dates = [item.createdAt, item.lastUsedAt]
                        .map(d => formatDate(d))
                        .join(' ');
                    return dates.includes(term.value);
                }
                const haystack = normalizeForSearch([
                    item.name || '',
                    item.query,
                    item.comment || '',
                    (item.tags || []).join(' ')
                ].join('\n'));
                return haystack.includes(term.value);
            });
        });

        const sortFns = {
            lastUsed_desc:  (a, b) => new Date(b.lastUsedAt)  - new Date(a.lastUsedAt),
            lastUsed_asc:   (a, b) => new Date(a.lastUsedAt)  - new Date(b.lastUsedAt),
            created_desc:   (a, b) => new Date(b.createdAt)   - new Date(a.createdAt),
            created_asc:    (a, b) => new Date(a.createdAt)   - new Date(b.createdAt),
            tag_asc:        (a, b) => (a.tags[0] || '\uFFFF').localeCompare(b.tags[0] || '\uFFFF', 'pt-BR', { sensitivity: 'base' }),
            tag_desc:       (a, b) => (b.tags[0] || '').localeCompare(a.tags[0] || '', 'pt-BR', { sensitivity: 'base' }),
            runCount_desc:  (a, b) => (b.runCount || 0) - (a.runCount || 0)
        };
        filtered.sort(sortFns[sortValue] || sortFns.lastUsed_desc);
        const visibleItems = filtered.slice(0, HISTORY_RENDER_LIMIT);

        if (state.tagFilterSelect) {
            const current = state.tagFilterSelect.value;
            const allTags = collectAllTags(history);
            state.tagFilterSelect.innerHTML = '';

            const specialOpts = [
                { value: '', label: 'Todas as etiquetas' },
                { value: '__with_tags__', label: 'Somente com etiquetas' },
                { value: '__without_tags__', label: 'Somente sem etiquetas' }
            ];
            specialOpts.forEach(({ value, label }) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                state.tagFilterSelect.appendChild(opt);
            });

            if (allTags.length) {
                const sep = document.createElement('option');
                sep.disabled = true;
                sep.textContent = '──────────────';
                state.tagFilterSelect.appendChild(sep);
            }

            allTags.forEach(tag => {
                const opt = document.createElement('option');
                opt.value = tag;
                opt.textContent = tag;
                state.tagFilterSelect.appendChild(opt);
            });

            const validValues = ['', '__with_tags__', '__without_tags__', ...allTags];
            if (validValues.includes(current)) state.tagFilterSelect.value = current;
        }

        state.listContainer.innerHTML = '';

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.style.fontSize = '11px';
            empty.style.color = '#9ca3af';
            const isFiltered = rawSearch || onlyFavorites || selectedTag;
            empty.textContent = isFiltered
                ? 'Nenhuma query encontrada com os filtros aplicados.'
                : 'Nenhuma query no histórico.';
            state.listContainer.appendChild(empty);
        }

        visibleItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'sql-card';
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', item.name ? `Selecionar query ${item.name}` : 'Selecionar query do histórico');
            if (state.selectedHistoryItemId === item.id) card.classList.add('selected');
            card.addEventListener('click', e => {
                if (e.target?.closest?.('.sql-card-actions')) return;
                selectHistoryCard(card, item.id);
            });
            card.addEventListener('focusin', () => selectHistoryCard(card, item.id));
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectHistoryCard(card, item.id);
                }
            });
            if (!settings.interface.cardsExpandedByDefault) {
                card.classList.add('collapsed');
            }

            const header = document.createElement('div');
            header.className = 'sql-card-header';

            const titleBox = document.createElement('div');
            titleBox.className = 'sql-card-title-box';

            if (item.name) {
                const nameEl = document.createElement('div');
                nameEl.className = 'sql-card-name';
                nameEl.textContent = item.name;
                nameEl.title = item.name;
                titleBox.appendChild(nameEl);
            }

            const meta = document.createElement('div');
            meta.className = 'sql-card-meta';

            const metaParts = [
                formatDate(item.createdAt),
                `último uso: ${formatDate(item.lastUsedAt)}`
            ];

            if (settings.interface.showRunCount) {
                metaParts.push(`execuções: ${item.runCount || 1}`);
            }

            meta.textContent = metaParts.join(' • ');
            titleBox.appendChild(meta);

            const headerActions = document.createElement('div');
            headerActions.className = 'sql-card-header-actions';

            const nameBtn = document.createElement('button');
            setIconButtonContent(nameBtn, item.name ? 'Nome' : 'Sugerir nome', 'edit');
            nameBtn.title = item.name ? 'Editar nome da query' : 'Sugerir nome editável para a query';
            nameBtn.addEventListener('click', () => promptQueryName(item));

            const favBtn = document.createElement('button');
            setIconButtonContent(favBtn, item.isFavorite ? 'Favorito' : 'Favoritar', 'star');
            favBtn.title = 'Marcar / desmarcar favorito';
            favBtn.addEventListener('click', () => updateHistoryEntry(item.id, { isFavorite: !item.isFavorite }));

            const collapseBtn = document.createElement('button');
            setIconButtonContent(collapseBtn, card.classList.contains('collapsed') ? 'Abrir' : 'Recolher', card.classList.contains('collapsed') ? 'collapse' : 'expand');
            collapseBtn.title = 'Recolher/expandir card';
            collapseBtn.addEventListener('click', () => {
                card.classList.toggle('collapsed');
                setIconButtonContent(collapseBtn, card.classList.contains('collapsed') ? 'Abrir' : 'Recolher', card.classList.contains('collapsed') ? 'collapse' : 'expand');
            });

            headerActions.append(nameBtn, favBtn, collapseBtn);
            header.append(titleBox, headerActions);

            const body = document.createElement('div');
            body.className = 'sql-card-body';

            const querySection = document.createElement('div');
            querySection.className = 'sql-card-query';

            const queryPre = document.createElement('pre');
            queryPre.innerHTML = renderSqlQuery(item.query, terms);

            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'sql-show-more';
            showMoreBtn.textContent = 'Mostrar mais ▼';
            showMoreBtn.addEventListener('click', () => {
                const expanded = querySection.classList.toggle('expanded');
                showMoreBtn.textContent = expanded ? 'Mostrar menos ▲' : 'Mostrar mais ▼';
            });

            querySection.append(queryPre, showMoreBtn);

            const metaRow = document.createElement('div');
            metaRow.className = 'sql-meta-row';

            if (item.tags.length) {
                item.tags.forEach(tag => {
                    const chip = document.createElement('span');
                    chip.className = 'sql-tag';
                    chip.append(document.createTextNode(tag + ' '));

                    const rm = document.createElement('button');
                    rm.textContent = '×';
                    rm.title = 'Remover etiqueta';
                    rm.addEventListener('click', () => {
                        updateHistoryEntry(item.id, { tags: item.tags.filter(t => t !== tag) });
                    });
                    chip.appendChild(rm);
                    metaRow.appendChild(chip);
                });
            } else {
                const noTag = document.createElement('span');
                noTag.textContent = 'Sem etiquetas';
                noTag.style.color = '#6b7280';
                noTag.style.fontSize = '10px';
                metaRow.appendChild(noTag);
            }

            const addTagBtn = document.createElement('button');
            addTagBtn.className = 'sql-helper-btn secondary sql-add-tag-btn';
            setIconButtonContent(addTagBtn, 'Etiqueta', 'tag');
            addTagBtn.title = 'Adicionar/editar etiquetas';
            addTagBtn.addEventListener('click', () => {
                const currentTags = item.tags.join(', ');
                const input = prompt('Etiquetas separadas por vírgula:', currentTags);
                if (input === null) return;
                const newTags = [...new Set(input
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(Boolean))];
                updateHistoryEntry(item.id, { tags: newTags });
            });
            metaRow.appendChild(addTagBtn);

            const sep = document.createElement('span');
            sep.textContent = '•';
            sep.style.color = '#52525b';
            metaRow.appendChild(sep);

            const commentPreviewInline = document.createElement('span');
            commentPreviewInline.className = 'sql-comment-preview-inline';
            if (item.comment.trim()) {
                commentPreviewInline.textContent = item.comment.split('\n')[0];
                commentPreviewInline.title = 'Clique no lápis para editar';
            } else {
                commentPreviewInline.textContent = 'Sem comentário';
                commentPreviewInline.style.fontStyle = 'italic';
                commentPreviewInline.style.color = '#6b7280';
            }
            metaRow.appendChild(commentPreviewInline);

            const editBtn = document.createElement('button');
            editBtn.className = 'sql-helper-btn secondary';
            setIconButtonContent(editBtn, 'Editar', 'edit');
            editBtn.title = 'Editar comentário';
            editBtn.addEventListener('click', () => openCommentModal(item));
            metaRow.appendChild(editBtn);

            const expandBtn = document.createElement('button');
            expandBtn.className = 'sql-helper-btn secondary';
            setIconButtonContent(expandBtn, 'Comentário', 'expand');
            expandBtn.title = 'Mostrar/ocultar comentário completo';
            metaRow.appendChild(expandBtn);

            const commentExpanded = document.createElement('div');
            commentExpanded.className = 'sql-comment-expanded';
            commentExpanded.style.display = 'none';
            commentExpanded.innerHTML = item.comment.trim()
                ? renderMarkdown(item.comment)
                : '<p style="color:#6b7280;">Sem comentário.</p>';

            expandBtn.addEventListener('click', () => {
                const visible = commentExpanded.style.display !== 'none';
                commentExpanded.style.display = visible ? 'none' : 'block';
                setIconButtonContent(expandBtn, visible ? 'Comentário' : 'Ocultar', 'expand');
            });

            const actions = document.createElement('div');
            actions.className = 'sql-card-actions';

            const btnPaste = document.createElement('button');
            btnPaste.type = 'button';
            setIconButtonContent(btnPaste, 'Colar', 'paste');
            btnPaste.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const ok = setEditorValue(item.query);
                setIconButtonContent(btnPaste, ok ? 'Colado' : 'Falhou', 'paste');
                setTimeout(() => { setIconButtonContent(btnPaste, 'Colar', 'paste'); }, 1200);
            });

            const btnRun = document.createElement('button');
            btnRun.type = 'button';
            setIconButtonContent(btnRun, 'Colar e executar', 'run');
            btnRun.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (window.__SQL_EDITOR_QUERY_API__ && typeof window.__SQL_EDITOR_QUERY_API__.setValueAndExecute === 'function') {
                    try {
                        if (window.__SQL_EDITOR_QUERY_API__.setValueAndExecute(item.query)) return;
                    } catch (err) {
                        console.warn('[SQL Helper] Ponte do Editor de Query falhou ao colar/executar:', err);
                    }
                }
                if (setEditorValue(item.query)) {
                    setTimeout(triggerRun, 80);
                }
            });

            const btnCopy = document.createElement('button');
            btnCopy.type = 'button';
            setIconButtonContent(btnCopy, 'Copiar', 'copy');
            btnCopy.addEventListener('click', async e => {
                e.preventDefault();
                e.stopPropagation();
                const ok = await copyToClipboard(item.query);
                setIconButtonContent(btnCopy, ok ? 'Copiado!' : 'Falhou', 'copy');
                setTimeout(() => { setIconButtonContent(btnCopy, 'Copiar', 'copy'); }, 1200);
            });

            const btnDelete = document.createElement('button');
            btnDelete.type = 'button';
            btnDelete.className = 'danger';
            setIconButtonContent(btnDelete, 'Excluir', 'delete');
            btnDelete.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm('Excluir esta query do histórico?')) deleteHistoryEntry(item.id);
            });

            actions.append(btnPaste, btnRun, btnCopy, btnDelete);
            body.append(querySection, metaRow, commentExpanded, actions);
            card.append(header, body);
            state.listContainer.appendChild(card);
        });

        if (filtered.length > visibleItems.length) {
            const limitNote = document.createElement('div');
            limitNote.className = 'sql-helper-render-limit';
            limitNote.textContent = `Mostrando ${visibleItems.length} de ${filtered.length}. Use busca/filtros para refinar.`;
            state.listContainer.appendChild(limitNote);
        }

        if (state.footerInfo) {
            const filteredInfo = (rawSearch || onlyFavorites || selectedTag) ? ` • visíveis: ${filtered.length}` : '';
            state.footerInfo.textContent = `Itens no histórico: ${history.length}${filteredInfo}`;
        }

        requestAnimationFrame(() => {
            if (state.listContainer && savedScroll) {
                state.listContainer.scrollTop = savedScroll;
            }
        });
    }

    function createUI() {
        injectStyles();
        createCommentModal();
        createExportModal();
        createSettingsModal();
        createTagsManagerModal();

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'sql-helper-toggle-btn';
        setIconButtonContent(toggleBtn, 'Histórico SQL', 'history');
        toggleBtn.title = 'Abrir histórico de queries';
        toggleBtn.addEventListener('click', () => togglePanel());
        document.body.appendChild(toggleBtn);
        state.toggleBtnRef = toggleBtn;

        const panel = document.createElement('div');
        panel.id = 'sql-helper-panel';
        panel.classList.add('hidden');

        const header = document.createElement('div');
        header.id = 'sql-helper-header';

        const headerTop = document.createElement('div');
        headerTop.id = 'sql-helper-header-top';

        const title = document.createElement('div');
        title.id = 'sql-helper-header-title';
        title.textContent = 'Histórico de Queries';

        const settings = getSettings();
        const autosaveWrapper = document.createElement('div');
        autosaveWrapper.id = 'sql-helper-autosave-wrapper';

        const autosaveText = document.createElement('span');
        autosaveText.textContent = 'Captura de histórico:';

        const autosaveStatus = document.createElement('span');
        autosaveStatus.id = 'sql-helper-autosave-label-status';
        autosaveStatus.textContent = settings.capture.autoSaveEnabled ? 'ativada' : 'desativada';

        const autoSaveCheckbox = document.createElement('input');
        autoSaveCheckbox.type = 'checkbox';
        autoSaveCheckbox.id = 'sql-helper-autosave';
        autoSaveCheckbox.checked = settings.capture.autoSaveEnabled;
        autoSaveCheckbox.addEventListener('change', () => {
            const next = getSettings();
            next.capture.autoSaveEnabled = autoSaveCheckbox.checked;
            saveSettings(next);
            autosaveStatus.textContent = autoSaveCheckbox.checked ? 'ativada' : 'desativada';
        });

        autosaveWrapper.append(autosaveText, autosaveStatus, autoSaveCheckbox);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(closeBtn, 'Fechar', 'close');
        closeBtn.addEventListener('click', () => togglePanel(false));

        headerTop.append(title, autosaveWrapper, closeBtn);

        const searchWrapper = document.createElement('div');
        searchWrapper.id = 'sql-helper-search-wrapper';

        const searchInput = document.createElement('input');
        searchInput.id = 'sql-helper-search';
        searchInput.placeholder = 'Buscar... palavras múltiplas (AND) · FROM:tabela · 2025-03';
        searchInput.autocomplete = 'off';

        const searchClearBtn = document.createElement('button');
        searchClearBtn.id = 'sql-helper-search-clear';
        searchClearBtn.textContent = '×';
        searchClearBtn.title = 'Limpar busca';
        searchClearBtn.style.display = 'none';
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            if (state.searchSuggestionsBox) state.searchSuggestionsBox.style.display = 'none';
            searchInput.focus();
            renderHistoryList();
        });

        const suggestionsBox = document.createElement('div');
        suggestionsBox.id = 'sql-helper-search-suggestions';
        suggestionsBox.style.display = 'none';

        const debouncedRender = debounce(() => {
            renderHistoryList();
            const val = searchInput.value.trim();
            if (val.length >= 3) saveRecentSearch(val);
        }, 280);

        searchInput.addEventListener('input', () => {
            const val = searchInput.value;
            searchClearBtn.style.display = val ? 'block' : 'none';
            if (val.trim()) {
                renderSearchSuggestions(val);
            } else {
                renderSearchSuggestions('');
            }
            debouncedRender();
        });

        searchInput.addEventListener('focus', () => {
            renderSearchSuggestions(searchInput.value.trim() || '');
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (state.searchSuggestionsBox) state.searchSuggestionsBox.style.display = 'none';
            }, 150);
        });

        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                searchClearBtn.style.display = 'none';
                if (state.searchSuggestionsBox) state.searchSuggestionsBox.style.display = 'none';
                renderHistoryList();
            }
        });

        searchWrapper.append(searchInput, searchClearBtn, suggestionsBox);

        const controls = document.createElement('div');
        controls.id = 'sql-helper-controls';

        const filterRow = document.createElement('div');
        filterRow.className = 'sql-helper-control-row';

        const filterLabel = document.createElement('span');
        filterLabel.className = 'sql-helper-control-label';
        filterLabel.textContent = 'Filtrar:';

        const tagFilterSelect = document.createElement('select');
        tagFilterSelect.id = 'sql-helper-tag-filter';
        tagFilterSelect.addEventListener('change', renderHistoryList);

        const favoritesOnlyCheckbox = document.createElement('input');
        favoritesOnlyCheckbox.type = 'checkbox';
        favoritesOnlyCheckbox.id = 'sql-helper-fav-only';
        favoritesOnlyCheckbox.addEventListener('change', renderHistoryList);

        const favLabel = document.createElement('label');
        favLabel.htmlFor = 'sql-helper-fav-only';
        favLabel.className = 'sql-helper-fav-label';
        favLabel.textContent = 'Favoritos';

        filterRow.append(filterLabel, tagFilterSelect, favoritesOnlyCheckbox, favLabel);

        const sortRow = document.createElement('div');
        sortRow.className = 'sql-helper-control-row';

        const sortLabel = document.createElement('span');
        sortLabel.className = 'sql-helper-control-label';
        sortLabel.textContent = 'Ordenar:';

        const sortSelect = document.createElement('select');
        sortSelect.id = 'sql-helper-sort';
        sortSelect.addEventListener('change', renderHistoryList);

        const sortOptions = [
            { value: 'lastUsed_desc', label: 'Último uso: mais recente' },
            { value: 'lastUsed_asc',  label: 'Último uso: mais antigo' },
            { value: 'created_desc',  label: 'Criado: mais recente' },
            { value: 'created_asc',   label: 'Criado: mais antigo' },
            { value: 'tag_asc',       label: 'Etiqueta: A → Z' },
            { value: 'tag_desc',      label: 'Etiqueta: Z → A' },
            { value: 'runCount_desc', label: 'Mais executados' }
        ];
        sortOptions.forEach(({ value, label }) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            sortSelect.appendChild(opt);
        });

        sortRow.append(sortLabel, sortSelect);
        controls.append(filterRow, sortRow);

        const listContainer = document.createElement('div');
        listContainer.id = 'sql-helper-list';

        const footer = document.createElement('div');
        footer.id = 'sql-helper-footer';

        const footerLeft = document.createElement('div');
        footerLeft.id = 'sql-helper-footer-left';

        const footerInfo = document.createElement('div');
        footerInfo.id = 'sql-helper-footer-info';

        const footerActions = document.createElement('div');
        footerActions.id = 'sql-helper-footer-actions';

        const bindFooterAction = (button, action) => {
            const handler = e => {
                e.preventDefault();
                e.stopPropagation();
                action();
            };
            button.addEventListener('pointerdown', handler, true);
            button.addEventListener('mousedown', handler, true);
            button.addEventListener('click', handler, true);
        };

        const exportMainBtn = document.createElement('button');
        exportMainBtn.type = 'button';
        exportMainBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(exportMainBtn, 'Exportar/Importar', 'export');
        bindFooterAction(exportMainBtn, openExportModal);

        const tagsBtn = document.createElement('button');
        tagsBtn.type = 'button';
        tagsBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(tagsBtn, 'Etiquetas', 'tag');
        tagsBtn.title = 'Gerenciar etiquetas';
        bindFooterAction(tagsBtn, openTagsManager);

        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'sql-helper-btn secondary';
        setIconButtonContent(settingsBtn, 'Config', 'settings');
        settingsBtn.title = 'Configurações';
        bindFooterAction(settingsBtn, openSettingsModal);

        footerActions.append(exportMainBtn, tagsBtn, settingsBtn);
        footerLeft.append(footerInfo, footerActions);

//       const hintInfo = document.createElement('div');
//       hintInfo.textContent = 'Ctrl+Enter: executa e salva no histórico';

// footer.append(footerLeft, hintInfo);
        footer.append(footerLeft);
        header.append(headerTop, searchWrapper, controls);
        panel.append(header, listContainer, footer);
        document.body.appendChild(panel);

        state.panel = panel;
        state.listContainer = listContainer;
        state.searchInput = searchInput;
        state.searchClearBtn = searchClearBtn;
        state.searchSuggestionsBox = suggestionsBox;
        state.favoritesOnlyCheckbox = favoritesOnlyCheckbox;
        state.footerInfo = footerInfo;
        state.tagFilterSelect = tagFilterSelect;
        state.sortSelect = sortSelect;

        const debouncedScrollSave = debounce(() => {
            saveUiState({ scrollTop: listContainer.scrollTop });
        }, 300);
        listContainer.addEventListener('scroll', debouncedScrollSave);

        applySettingsToUI();
        renderHistoryList();
        togglePanel(loadUiState().panelOpen);
    }

    /********************************************************************
     * CAPTURA DE EXECUÇÃO
     ********************************************************************/

    function addHistoryEntryAuto(queryText, source) {
        const settings = getSettings();
        if (!settings.capture.autoSaveEnabled) return;

        if (source === 'runButton' && !settings.capture.captureOnRunButton) return;
        if (source === 'ctrlEnter' && !settings.capture.captureOnCtrlEnter) return;

        addHistoryEntry(queryText);
    }

    function setupKeyListener() {
        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey && e.key === 'Enter')) return;

            const target = e.target;
            const isTextArea = target?.tagName === 'TEXTAREA';
            const isCodeMirror = !!target?.closest?.('.CodeMirror');
            if (!isTextArea && !isCodeMirror) return;

            addHistoryEntryAuto(getEditorValue(), 'ctrlEnter');
        });
    }

    function hookRunButton(btn) {
        if (!btn || btn.dataset.sqlHelperHooked === 'true') return;
        btn.dataset.sqlHelperHooked = 'true';
        btn.addEventListener('click', () => addHistoryEntryAuto(getEditorValue(), 'runButton'));
        state.hookedRunButton = btn;
        console.log('[SQL Helper] Hook do botão Executar aplicado.');
    }

    function scheduleRunButtonHook() {
        clearTimeout(state.hookRunButtonTimer);
        state.hookRunButtonTimer = setTimeout(() => {
            const btn = findRunButton();
            if (btn && btn !== state.hookedRunButton) {
                hookRunButton(btn);
            }
        }, 120);
    }

    function isOwnUiMutation(mutations) {
        return Array.from(mutations || []).every(mutation => {
            const target = mutation && mutation.target;
            return !!(target && target.closest && target.closest('#sql-helper-panel, #sql-helper-comment-overlay, #sql-helper-export-overlay, #sql-helper-settings-overlay, #sql-helper-tags-overlay'));
        });
    }

    function setupRunButtonHook() {
        hookRunButton(findRunButton());

        state.mutationObserver = new MutationObserver(mutations => {
            if (isOwnUiMutation(mutations)) return;
            scheduleRunButtonHook();
        });

        state.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /********************************************************************
     * INIT
     ********************************************************************/

    function init() {
        createUI();
        setupKeyListener();
        setupRunButtonHook();
        console.log('[SQL Helper – Histórico v13] Inicializado.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();

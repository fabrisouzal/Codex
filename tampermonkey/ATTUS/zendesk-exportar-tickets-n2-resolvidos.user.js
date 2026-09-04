// ==UserScript==
// @name         Zendesk - Extrator de Tickets
// @namespace    https://attus-ai.zendesk.com/
// @version      2026.09.04.01
// @description  Exporta tickets e eventos de auditoria do Zendesk em PDF, Markdown ou ambos, com retomada e workers controlados.
// @author       ATTUS
// @match        https://attus-ai.zendesk.com/agent/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@3.0.1/dist/jspdf.umd.min.js#sha256=7ad0aa5df9942f843759f06fcb7f1ff41cf2e6b3feb9a51e048f4c56531f73a2
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const BASE = 'https://attus-ai.zendesk.com';
    const STATE_PREFIX = 'attus:zendesk:pdf-export:v3:';
    const LEGACY_QUERY_KEY = 'attus:zendesk:pdf-export:last-query:v1';
    const HANDLE_DB = 'attus-zendesk-pdf-export';
    const HANDLE_DB_VERSION = 2;
    const HANDLE_STORE = 'handles';
    const HANDLE_KEY = 'output-directory';
    const PROGRESS_STORE = 'progress';
    const EXPORT_PROFILE_VERSION = 6;
    const REQUEST_DELAY_MS = 120;
    const MAX_RETRIES = 5;
    const MIN_CONCURRENCY = 1;
    const MAX_CONCURRENCY = 8;
    const DEFAULT_CONCURRENCY = 4;
    const RATE_LIMIT_RESERVE = 10;

    const userCache = new Map();
    const userPendingCache = new Map();
    const groupCache = new Map();
    const groupPendingCache = new Map();
    const statusCache = new Map();
    const fieldCache = new Map();
    let cancelRequested = false;
    let running = false;
    let directoryHandle = null;
    let apiPauseUntil = 0;
    let progressWriteChain = Promise.resolve();

    GM_addStyle(`
        #attus-zdexp-open {
            position: fixed; right: 676px; top: 7px; z-index: 2147483646;
            border: 0; border-radius: 6px; padding: 9px 13px;
            background: #174ea6; color: #fff; font: 600 13px/1 Arial, sans-serif;
            box-shadow: 0 5px 18px rgba(0,0,0,.28); cursor: pointer;
        }
        #attus-zdexp-open:hover { background: #123d82; }
        #attus-zdexp-panel {
            position: fixed; right: 618px; top: 50px; z-index: 2147483647;
            width: 460px; height: min(650px, calc(100vh - 68px));
            min-width: 330px; min-height: 300px;
            max-width: calc(100vw - 36px); max-height: calc(100vh - 68px);
            overflow: auto; padding: 16px; border: 1px solid #cbd5e1; border-radius: 10px;
            background: #fff; color: #172b4d; font: 13px/1.45 Arial, sans-serif;
            box-shadow: 0 12px 36px rgba(0,0,0,.32); resize: both; box-sizing: border-box;
        }
        #attus-zdexp-panel[hidden] { display: none !important; }
        @media (max-width: 1120px) {
            #attus-zdexp-open { right: 16px; }
            #attus-zdexp-panel { right: 18px; }
        }
        #attus-zdexp-panel h2 { margin: 0 28px 6px 0; font-size: 17px; }
        #attus-zdexp-panel p { margin: 6px 0; }
        #attus-zdexp-close {
            position: absolute; top: 8px; right: 9px; border: 0; background: transparent;
            color: #52606d; font-size: 23px; cursor: pointer;
        }
        .attus-zdexp-grid { display: grid; grid-template-columns: 1fr; gap: 9px; margin: 10px 0; }
        .attus-zdexp-grid label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
        .attus-zdexp-grid input[type="number"], .attus-zdexp-grid select {
            width: 100%; padding: 7px; border: 1px solid #aebdca; border-radius: 5px;
            background: #fff; color: #172b4d; box-sizing: border-box;
        }
        .attus-zdexp-grid textarea {
            width: 100%; min-height: 86px; resize: vertical; padding: 7px;
            border: 1px solid #aebdca; border-radius: 5px;
            font: 11px/1.4 Consolas, monospace;
        }
        #attus-zdexp-ticket-list { min-height: 68px; }
        #attus-zdexp-file { width: 100%; font-size: 11px; font-weight: 400; }
        #attus-zdexp-folder { margin-top: 2px; color: #334e68; font-size: 11px; overflow-wrap: anywhere; }
        .attus-zdexp-check { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
        .attus-zdexp-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
        .attus-zdexp-actions button {
            border: 1px solid #aebdca; border-radius: 5px; padding: 8px 10px;
            background: #fff; color: #243b53; font-weight: 600; cursor: pointer;
        }
        .attus-zdexp-actions button.primary { border-color: #174ea6; background: #174ea6; color: #fff; }
        .attus-zdexp-actions button.danger { border-color: #c53030; color: #c53030; }
        .attus-zdexp-actions button:disabled { opacity: .5; cursor: not-allowed; }
        #attus-zdexp-status {
            min-height: 74px; max-height: 190px; overflow: auto; margin: 12px 0 0;
            padding: 9px; border-radius: 5px; background: #102a43; color: #e6f0f8;
            white-space: pre-wrap; font: 11px/1.45 Consolas, monospace;
        }
        .attus-zdexp-note { color: #52606d; font-size: 11px; }
    `);

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function safeFilename(value, maxLength = 125) {
        const clean = String(value || 'sem-assunto')
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, maxLength)
            .replace(/[. -]+$/g, '');
        return clean || 'sem-assunto';
    }

    function asNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatDate(value) {
        if (!value) return 'Não informado';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo'
        }).format(date);
    }

    function formatBytes(value) {
        let size = Number(value);
        if (!Number.isFinite(size)) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let index = 0;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index += 1;
        }
        return `${index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
    }

    function apiUrl(path, params = {}) {
        const url = new URL(path, BASE);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    function apiError(message, status, url) {
        const error = new Error(message);
        error.httpStatus = status;
        error.url = url;
        return error;
    }

    function isAuthenticationError(error) {
        return error?.httpStatus === 401 || error?.httpStatus === 403;
    }

    function validatedApiUrl(value) {
        const url = new URL(value, BASE);
        const baseUrl = new URL(BASE);
        if (url.origin !== baseUrl.origin || !url.pathname.startsWith('/api/v2/')) {
            throw new Error(`A API retornou uma URL de paginação inesperada: ${url}.`);
        }
        return url.toString();
    }

    function secondsFromHeader(value, fallback) {
        const numeric = value !== null && value !== '' ? Number(value) : Number.NaN;
        if (Number.isFinite(numeric)) return Math.max(1, Math.min(numeric, 600));
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) {
            return Math.max(1, Math.min(Math.ceil((timestamp - Date.now()) / 1000), 600));
        }
        return fallback;
    }

    function pauseApiRequests(seconds, reason) {
        const until = Date.now() + Math.max(1, seconds) * 1000;
        if (until <= apiPauseUntil) return;
        apiPauseUntil = until;
        log(`${reason}; fila da API pausada por ${Math.ceil(seconds)}s.`);
    }

    async function waitForApiWindow() {
        const remaining = apiPauseUntil - Date.now();
        if (remaining <= 0) {
            apiPauseUntil = 0;
            return;
        }
        await sleep(remaining);
    }

    function monitorRateLimit(response) {
        const remainingHeader =
            response.headers.get('ratelimit-remaining')
            ?? response.headers.get('x-rate-limit-remaining');
        const resetHeader = response.headers.get('ratelimit-reset');
        const remaining = remainingHeader !== null ? Number(remainingHeader) : Number.NaN;
        const reset = resetHeader !== null ? Number(resetHeader) : Number.NaN;
        if (Number.isFinite(remaining) && remaining <= RATE_LIMIT_RESERVE && Number.isFinite(reset)) {
            pauseApiRequests(reset + 1, `Limite global próximo do fim (${remaining} restante(s))`);
        }

        const endpointHeaders = [
            'zendesk-ratelimit-search-index',
            'zendesk-ratelimit-tickets-index',
            'zendesk-ratelimit-tickets-index-pagination'
        ];
        for (const headerName of endpointHeaders) {
            const header = response.headers.get(headerName);
            if (!header) continue;
            const endpointRemaining = Number(header.match(/remaining=(\d+)/i)?.[1]);
            const endpointReset = Number(header.match(/resets=(\d+)/i)?.[1]);
            if (Number.isFinite(endpointRemaining) && endpointRemaining <= RATE_LIMIT_RESERVE
                && Number.isFinite(endpointReset)) {
                pauseApiRequests(endpointReset + 1, `Limite do endpoint próximo do fim (${endpointRemaining} restante(s))`);
            }
        }
    }

    async function fetchJson(url) {
        const requestUrl = validatedApiUrl(url);
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
            await waitForApiWindow();
            let response;
            try {
                response = await fetch(requestUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: { Accept: 'application/json' }
                });
            } catch (error) {
                lastError = `Falha de rede: ${error.message}`;
                if (attempt < MAX_RETRIES) {
                    const seconds = Math.min(2 ** (attempt - 1), 20);
                    log(`Falha de rede; tentando novamente em ${seconds}s...`);
                    await sleep(seconds * 1000);
                    continue;
                }
                throw apiError(`A API não pôde ser acessada após ${MAX_RETRIES} tentativas. ${lastError}`, null, requestUrl);
            }
            monitorRateLimit(response);
            if (response.status === 401 || response.status === 403) {
                throw apiError(
                    `A sessão desta aba não tem acesso à API do Zendesk (HTTP ${response.status}).`,
                    response.status,
                    requestUrl
                );
            }
            if (!response.ok) {
                const text = await response.text();
                const retryable = response.status === 429 || response.status >= 500;
                lastError = `HTTP ${response.status}: ${text.slice(0, 350)}`;
                if (retryable && attempt < MAX_RETRIES) {
                    const seconds = secondsFromHeader(
                        response.headers.get('retry-after'),
                        Math.min(2 ** (attempt - 1), 20)
                    );
                    if (response.status === 429) {
                        pauseApiRequests(seconds, 'Zendesk respondeu HTTP 429');
                        await waitForApiWindow();
                    } else {
                        log(`Zendesk respondeu HTTP ${response.status}; tentando novamente em ${seconds}s...`);
                        await sleep(seconds * 1000);
                    }
                    continue;
                }
                throw apiError(`Falha na API: ${lastError} em ${requestUrl}.`, response.status, requestUrl);
            }
            return response.json();
        }
        throw new Error(`A API não respondeu após ${MAX_RETRIES} tentativas. ${lastError}`);
    }

    function parseSearchQuery(query) {
        const tokenValue = (name, fallback) => {
            const pattern = new RegExp(`(?:^|\\s)${name}:("[^"]*"|'[^']*'|\\S+)`, 'i');
            const match = query.match(pattern);
            return match ? match[1].replace(/^["']|["']$/g, '') : fallback;
        };
        const orderBy = tokenValue('order_by', 'updated_at');
        const requestedSort = tokenValue('sort', 'desc').toLowerCase();
        const sort = requestedSort === 'asc' ? 'asc' : 'desc';
        const requestedTypes = [...query.matchAll(/(?:^|\s)type:("[^"]*"|'[^']*'|\S+)/gi)]
            .map(match => match[1].replace(/^["']|["']$/g, '').toLowerCase());
        const invalidType = requestedTypes.find(type => !/^tickets?$/.test(type));
        if (invalidType) {
            throw new Error(`O Extrator aceita somente tickets; remova o filtro type:${invalidType}.`);
        }
        const filterQuery = normalizeQuery(
            query
                .replace(/(?:^|\s)type:(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
                .replace(/(?:^|\s)order_by:(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
                .replace(/(?:^|\s)sort:(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
        );
        if (!filterQuery) throw new Error('A query contém apenas opções de ordenação e não possui filtros.');
        return { filterQuery, orderBy, sort };
    }

    async function validateSession() {
        const payload = await fetchJson(apiUrl('/api/v2/users/me.json'));
        if (!payload.user?.id) {
            throw new Error('O Zendesk não confirmou o usuário autenticado nesta aba.');
        }
        log(`Sessão validada para ${payload.user.name || payload.user.email || `usuário ${payload.user.id}`}.`);
    }

    async function getSearchCount(filterQuery) {
        const payload = await fetchJson(apiUrl('/api/v2/search/count.json', {
            query: `type:ticket ${filterQuery}`
        }));
        return asNumber(payload.count);
    }

    async function collectTickets({ filterQuery, orderBy, sort }) {
        let url = apiUrl('/api/v2/search/export.json', {
            query: filterQuery,
            'filter[type]': 'ticket',
            'page[size]': 100
        });
        const byId = new Map();
        const seenPages = new Set();
        let page = 0;

        while (url) {
            if (cancelRequested) break;
            if (seenPages.has(url)) throw new Error('A paginação da busca retornou uma URL repetida.');
            seenPages.add(url);
            page += 1;
            const payload = await fetchJson(url);
            for (const item of payload.results || []) {
                const id = asNumber(item?.id);
                if (id) byId.set(id, item);
            }
            log(`Busca: página ${page}, ${byId.size} ticket(s) localizado(s).`);
            url = payload.meta?.has_more && payload.links?.next ? payload.links.next : null;
            await sleep(REQUEST_DELAY_MS);
        }

        const priorityOrder = { low: 1, normal: 2, high: 3, urgent: 4 };
        const statusOrder = { new: 1, open: 2, pending: 3, hold: 4, solved: 5, closed: 6 };
        const comparableValue = ticket => {
            const value = ticket?.[orderBy];
            if (orderBy === 'priority') return priorityOrder[value] ?? 0;
            if (orderBy === 'status') return statusOrder[value] ?? 0;
            if (typeof value === 'number') return value;
            if (/_at$/i.test(orderBy)) {
                const timestamp = Date.parse(value);
                if (Number.isFinite(timestamp)) return timestamp;
            }
            return String(value ?? '');
        };
        return [...byId.values()].sort((a, b) => {
            const direction = sort === 'asc' ? 1 : -1;
            const valueA = comparableValue(a);
            const valueB = comparableValue(b);
            const valueOrder = typeof valueA === 'number' && typeof valueB === 'number'
                ? valueA - valueB
                : String(valueA).localeCompare(String(valueB), 'pt-BR', { numeric: true });
            return valueOrder * direction || (Number(a.id || 0) - Number(b.id || 0)) * direction;
        });
    }

    async function loadTicket(ticketId) {
        const payload = await fetchJson(apiUrl(`/api/v2/tickets/${ticketId}.json`));
        if (!payload.ticket) throw new Error(`O Zendesk não retornou o ticket #${ticketId}.`);
        return payload.ticket;
    }

    async function collectComments(ticketId, includePrivate) {
        let url = apiUrl(`/api/v2/tickets/${ticketId}/comments.json`, {
            'page[size]': 100,
            sort: 'created_at',
            include_inline_images: 'true'
        });
        const comments = [];
        const seenPages = new Set();
        while (url) {
            if (seenPages.has(url)) throw new Error(`Paginação repetida nos comentários do ticket #${ticketId}.`);
            seenPages.add(url);
            const payload = await fetchJson(url);
            for (const comment of payload.comments || []) {
                if (includePrivate || comment.public) comments.push(comment);
            }
            url = payload.meta?.has_more && payload.links?.next ? payload.links.next : null;
            await sleep(REQUEST_DELAY_MS);
        }
        comments.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        return comments;
    }

    async function collectAudits(ticketId) {
        let url = apiUrl(`/api/v2/tickets/${ticketId}/audits.json`, {
            'page[size]': 100, sort_order: 'asc', include_boundary_indicators: true
        });
        const audits = new Map();
        const seenPages = new Set();
        while (url) {
            if (cancelRequested) throw new Error('Exportação cancelada durante a coleta de eventos.');
            url = validatedApiUrl(url);
            if (seenPages.has(url)) throw new Error(`Paginação repetida nos eventos do ticket #${ticketId}.`);
            seenPages.add(url);
            const payload = await fetchJson(url);
            if (!Array.isArray(payload.audits)) {
                throw new Error(`Resposta inválida de auditoria do ticket #${ticketId}.`);
            }
            for (const audit of payload.audits) {
                if (!audit || audit.id == null || !Array.isArray(audit.events)
                    || (audit.ticket_id != null && String(audit.ticket_id) !== String(ticketId))) {
                    throw new Error(`Registro de auditoria inválido do ticket #${ticketId}.`);
                }
                audits.set(String(audit.id), audit);
            }
            // Tickets arquivados podem retornar uma página única, sem metadados de cursor.
            if (payload.meta?.has_more === false) {
                url = null;
            } else {
                url = payload.links?.next || payload.next_page || null;
                if (payload.meta?.has_more === true && !url) {
                    throw new Error(`Paginação incompleta nos eventos do ticket #${ticketId}.`);
                }
            }
            if (url) await sleep(REQUEST_DELAY_MS);
        }
        return [...audits.values()].sort((a, b) =>
            String(a.created_at || '').localeCompare(String(b.created_at || ''))
            || String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
        );
    }

    async function loadTicketFields() {
        if (fieldCache.size) return;
        try {
            let url = apiUrl('/api/v2/ticket_fields.json', { 'page[size]': 100 });
            const seenPages = new Set();
            while (url) {
                if (cancelRequested) throw new Error('Coleta de campos cancelada.');
                url = validatedApiUrl(url);
                if (seenPages.has(url)) throw new Error('Paginação repetida no catálogo de campos.');
                seenPages.add(url);
                const payload = await fetchJson(url);
                for (const field of payload.ticket_fields || []) fieldCache.set(String(field.id), field);
                url = payload.meta?.has_more === false ? null : payload.links?.next || payload.next_page || null;
            }
        } catch (error) {
            // O catálogo é complementar: IDs originais continuam preservados nos eventos.
            log(`Aviso: nomes dos campos indisponíveis; os IDs serão mantidos. ${error.message}`);
        }
    }

    function prepareAudits(audits, comments, includePrivate) {
        const currentComments = new Map(comments
            .filter(comment => includePrivate || comment.public === true)
            .map(comment => [String(comment.id), comment]));
        let totalEvents = 0;
        let omittedEvents = 0;
        const safeFields = new Set([
            'status', 'custom_status_id', 'priority', 'type', 'group_id', 'assignee_id',
            'requester_id', 'submitter_id', 'organization_id', 'brand_id', 'ticket_form_id',
            'problem_id', 'tags', 'due_at', 'is_public'
        ]);
        const result = audits.map(audit => {
            const events = [];
            const seen = new Set();
            for (const event of audit.events) {
                if (!event || typeof event.type !== 'string') throw new Error('Evento de auditoria inválido.');
                const key = event.id == null ? null : String(event.id);
                if (key !== null && seen.has(key)) continue;
                if (key !== null) seen.add(key);
                totalEvents += 1;
                // Nunca reexportar corpos históricos: podem anteceder redações ou mudanças de privacidade.
                if (['Comment', 'VoiceComment', 'FacebookComment'].includes(event.type)) {
                    const comment = currentComments.get(String(event.comment_id ?? event.id));
                    if (!comment) {
                        omittedEvents += 1;
                        continue;
                    }
                    events.push({
                        id: event.id, type: event.type, comment_id: comment.id,
                        public: comment.public === true,
                        reference: 'Conteúdo atual disponível na seção Conversa; corpo histórico não reproduzido.'
                    });
                } else if (includePrivate) {
                    events.push(event);
                } else if (['Change', 'Create'].includes(event.type) && safeFields.has(event.field_name)) {
                    events.push({
                        id: event.id, type: event.type, field_name: event.field_name,
                        previous_value: event.previous_value, value: event.value
                    });
                } else {
                    // Notificações, campos livres e tipos futuros podem conter notas internas em campos arbitrários.
                    events.push({ id: event.id, type: event.type,
                        details_omitted: 'Detalhes omitidos porque a inclusão de notas internas está desativada.' });
                }
            }
            return {
                id: audit.id, created_at: audit.created_at, author_id: audit.author_id,
                via: includePrivate ? audit.via : { channel: audit.via?.channel },
                metadata: includePrivate ? audit.metadata : undefined,
                events
            };
        });
        return { audits: result, totalEvents, omittedEvents };
    }

    function auditValue(fieldName, value) {
        if (value === undefined) return 'Não informado';
        if (value === null || value === '') return '(vazio)';
        if (['assignee_id', 'requester_id', 'submitter_id'].includes(fieldName)) {
            return `${userLabel(value)} [ID ${value}]`;
        }
        if (fieldName === 'group_id') return `${groupCache.get(asNumber(value)) || 'Grupo'} [ID ${value}]`;
        if (fieldName === 'custom_status_id') return `${statusCache.get(asNumber(value)) || 'Status'} [ID ${value}]`;
        const field = fieldCache.get(String(fieldName));
        const label = item => {
            const option = field?.custom_field_options?.find(entry => String(entry.value) === String(item));
            return option ? `${option.name} [${item}]` : String(item);
        };
        if (Array.isArray(value)) return value.map(label).join(', ') || '(vazio)';
        if (typeof value === 'object') return JSON.stringify(value);
        return label(value);
    }

    function auditEventSummary(event) {
        if (event.details_omitted) return event.details_omitted;
        if (event.reference) return `Comentário ${event.comment_id} (${event.public ? 'Público' : 'Nota interna'}). ${event.reference}`;
        if (event.type === 'Change' || event.type === 'Create') {
            const field = fieldCache.get(String(event.field_name));
            const name = field?.title ? `${field.title} [${event.field_name}]` : event.field_name || 'Campo';
            const current = auditValue(event.field_name, event.value);
            return event.type === 'Create' ? `${name}: ${current}`
                : `${name}: ${auditValue(event.field_name, event.previous_value)} → ${current}`;
        }
        if (event.type === 'CommentPrivacyChange') return `Privacidade do comentário ${event.comment_id}: ${event.public ? 'Público' : 'Nota interna'}`;
        return event.macro_title || event.subject || event.message || event.type;
    }

    function auditEntries(documentData) {
        return (documentData.audits || []).flatMap(audit => audit.events.map(event => ({
            audit, event, summary: auditEventSummary(event),
            details: JSON.stringify({
                audit_id: audit.id, author_id: audit.author_id, created_at: audit.created_at,
                audit_via: audit.via, audit_metadata: audit.metadata, event
            }, null, 2)
        })));
    }

    function fencedJson(text) {
        // Conteúdo de terceiros não pode encerrar o bloco e criar headings/instruções no Markdown.
        const runs = String(text).match(/`+/g) || [];
        const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
        return `${fence}json\n${text}\n${fence}`;
    }

    async function populateUsers(ids) {
        const requested = [...new Set(ids.map(asNumber).filter(Boolean))];
        const fresh = requested.filter(id => !userCache.has(id) && !userPendingCache.has(id));
        for (let index = 0; index < fresh.length; index += 100) {
            const batch = fresh.slice(index, index + 100);
            const batchPromise = (async () => {
                try {
                    const payload = await fetchJson(apiUrl('/api/v2/users/show_many.json', {
                        ids: batch.join(',')
                    }));
                    batch.forEach(id => userCache.set(id, { id }));
                    for (const user of payload.users || []) {
                        const id = asNumber(user?.id);
                        if (id) userCache.set(id, user);
                    }
                } catch (error) {
                    if (isAuthenticationError(error)) throw error;
                    batch.forEach(id => userCache.set(id, { id }));
                    log(`Aviso: dados de ${batch.length} usuário(s) não puderam ser carregados: ${error.message}`);
                } finally {
                    batch.forEach(id => userPendingCache.delete(id));
                }
            })();
            batch.forEach(id => userPendingCache.set(id, batchPromise));
        }
        const pendingPromises = requested
            .map(id => userPendingCache.get(id))
            .filter(Boolean);
        await Promise.all([...new Set(pendingPromises)]);
    }

    async function groupName(groupId) {
        const id = asNumber(groupId);
        if (!id) return 'Não atribuído';
        if (groupCache.has(id)) return groupCache.get(id);
        if (!groupPendingCache.has(id)) {
            const pending = (async () => {
                try {
                    const payload = await fetchJson(apiUrl(`/api/v2/groups/${id}.json`));
                    groupCache.set(id, payload.group?.name || `Grupo ${id}`);
                } catch (error) {
                    if (isAuthenticationError(error)) throw error;
                    groupCache.set(id, `Grupo ${id}`);
                    log(`Aviso: o nome do grupo ${id} não pôde ser carregado: ${error.message}`);
                } finally {
                    groupPendingCache.delete(id);
                }
                return groupCache.get(id);
            })();
            groupPendingCache.set(id, pending);
        }
        return groupPendingCache.get(id);
    }

    async function loadCustomStatuses() {
        if (statusCache.size) return;
        try {
            // Este endpoint retorna a lista completa e não aceita paginação.
            const payload = await fetchJson(apiUrl('/api/v2/custom_statuses.json'));
            for (const item of payload.custom_statuses || []) {
                const id = asNumber(item?.id);
                if (id) {
                    statusCache.set(id, item.agent_label || item.end_user_label || item.name || `Status ${id}`);
                }
            }
        } catch (error) {
            if (isAuthenticationError(error)) throw error;
            log(`Aviso: nomes dos status não puderam ser carregados: ${error.message}`);
        }
    }

    function userLabel(userId) {
        const id = asNumber(userId);
        if (!id) return 'Não informado';
        const user = userCache.get(id) || {};
        const name = user.name || `Usuário ${id}`;
        return user.email ? `${name} (${user.email})` : name;
    }

    function sanitizeCommentHtml(rawHtml) {
        const root = document.createElement('div');
        root.innerHTML = String(rawHtml || '');
        root.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach(node => node.remove());

        const inlineImages = [];
        root.querySelectorAll('img').forEach((image, index) => {
            const rawSource = image.getAttribute('src') || '';
            let source = '';
            try {
                const resolved = new URL(rawSource, BASE);
                source = ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : '';
            } catch (_) {
                source = '';
            }
            if (source) inlineImages.push({ source, label: image.getAttribute('alt') || `Imagem ${index + 1}` });
            image.remove();
        });

        root.querySelectorAll('*').forEach(element => {
            for (const attribute of [...element.attributes]) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
                if (name === 'style' && /url\s*\(/i.test(attribute.value)) element.removeAttribute('style');
            }
        });

        root.querySelectorAll('a[href]').forEach(anchor => {
            try {
                const resolved = new URL(anchor.getAttribute('href'), BASE);
                if (!['http:', 'https:', 'mailto:'].includes(resolved.protocol)) throw new Error('Protocolo não permitido');
                const href = resolved.toString();
                anchor.href = href;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            } catch (_) {
                anchor.removeAttribute('href');
            }
        });

        return { html: root.innerHTML, inlineImages };
    }

    async function loadTicketDocument(searchTicket, includePrivate, includeEvents = false) {
        const ticketId = Number(searchTicket.id);
        const [ticket, comments, rawAudits] = await Promise.all([
            loadTicket(ticketId),
            collectComments(ticketId, includePrivate),
            includeEvents ? collectAudits(ticketId) : Promise.resolve([])
        ]);
        const auditData = prepareAudits(rawAudits, comments, includePrivate);
        const events = auditData.audits.flatMap(audit => audit.events);
        const changedUsers = events.filter(event =>
            ['assignee_id', 'requester_id', 'submitter_id'].includes(event.field_name)
        ).flatMap(event => [event.previous_value, event.value]);
        const usersPromise = populateUsers([
            ticket.requester_id,
            ticket.submitter_id,
            ticket.assignee_id,
            ...comments.map(comment => comment.author_id),
            ...auditData.audits.map(audit => audit.author_id),
            ...changedUsers
        ]);
        const [group] = await Promise.all([
            groupName(ticket.group_id),
            usersPromise
        ]);
        const statusId = asNumber(ticket.custom_status_id);
        const customStatus = statusCache.get(statusId) || (statusId ? `ID ${statusId}` : ticket.status || 'Não informado');
        const historicalGroups = new Set(events.filter(event => event.field_name === 'group_id')
            .flatMap(event => [event.previous_value, event.value]).filter(Boolean));
        for (const id of historicalGroups) await groupName(id);
        return { ticket, comments, group, customStatus, includeEvents, includePrivate, ...auditData };
    }

    function toPdfText(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\u2010-\u2015]/g, '-')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/\u2022/g, '-')
            .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/gu, character =>
                `[U+${character.codePointAt(0).toString(16).toUpperCase()}]`
            );
    }

    function htmlToNormalizedText(html, pdfSafe = false, markdownLinks = false) {
        const root = document.createElement('div');
        root.innerHTML = String(html || '');
        root.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href') || '';
            if (!href) return;
            if (markdownLinks) {
                const label = markdownInline(anchor.textContent || href);
                anchor.replaceWith(document.createTextNode(`[${label}](${markdownUrl(href)})`));
            } else if (!anchor.textContent.includes(href)) {
                anchor.append(document.createTextNode(` (${href})`));
            }
        });
        root.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        root.querySelectorAll('li').forEach(node => {
            node.prepend(document.createTextNode('- '));
            node.append(document.createTextNode('\n'));
        });
        root.querySelectorAll('th, td').forEach(node => {
            node.append(document.createTextNode('\t'));
        });
        root.querySelectorAll('p, div, pre, blockquote, h1, h2, h3, h4, tr').forEach(node => {
            node.append(document.createTextNode('\n'));
        });
        const text = String(root.textContent || '')
            .split(/\r?\n/)
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return pdfSafe ? toPdfText(text) : text;
    }

    function htmlToPlainText(html) {
        return htmlToNormalizedText(html, true);
    }

    async function renderPdfBlob(documentData, query) {
        const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
        if (typeof JsPdf !== 'function') {
            throw new Error('A biblioteca jsPDF não foi carregada.');
        }
        const { ticket, comments, group, customStatus } = documentData;
        const ticketId = Number(ticket.id);
        const subject = ticket.subject || `Ticket ${ticketId}`;
        const ticketUrl = `${BASE}/agent/tickets/${ticketId}`;
        const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        doc.setProperties({
            title: toPdfText(`Ticket #${ticketId} - ${subject}`),
            subject: toPdfText(`Exportação de ticket do Zendesk. Query: ${query}`),
            author: 'Zendesk - Exportador de Tickets'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = { top: 14, right: 14, bottom: 16, left: 14 };
        const contentWidth = pageWidth - margin.left - margin.right;
        let y = margin.top;

        const addPage = () => {
            doc.addPage();
            y = margin.top;
        };
        const ensureSpace = height => {
            if (y + height > pageHeight - margin.bottom) addPage();
        };
        const wrappedLines = (text, size, width = contentWidth) => {
            doc.setFontSize(size);
            return doc.splitTextToSize(toPdfText(text) || '-', width);
        };
        const writeWrapped = (text, {
            size = 10,
            style = 'normal',
            color = [23, 43, 77],
            indent = 0,
            after = 1.5,
            lineHeight = size * 0.43
        } = {}) => {
            doc.setFont('helvetica', style);
            doc.setFontSize(size);
            doc.setTextColor(...color);
            const lines = wrappedLines(text, size, contentWidth - indent);
            for (const line of lines) {
                ensureSpace(lineHeight);
                doc.text(line, margin.left + indent, y);
                y += lineHeight;
            }
            y += after;
        };

        doc.setTextColor(82, 96, 109);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`TICKET #${ticketId}`, margin.left, y);
        y += 7;
        writeWrapped(subject, { size: 18, style: 'bold', color: [16, 42, 67], after: 4, lineHeight: 7.8 });

        const summary = [
            `Status: ${customStatus}`,
            `Grupo: ${group}`,
            `Solicitante: ${userLabel(ticket.requester_id)}`,
            `Responsável: ${userLabel(ticket.assignee_id)}`,
            `Criado em: ${formatDate(ticket.created_at)}`,
            `Atualizado em: ${formatDate(ticket.updated_at)}`,
            `Prioridade: ${ticket.priority || 'Não informada'}`,
            `Tipo: ${ticket.type || 'Não informado'}`,
            `Tags: ${(ticket.tags || []).join(', ') || 'Nenhuma'}`,
            `Fonte: ${ticketUrl}`
        ];
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.2);
        const summaryLineHeight = 4.1;
        const summaryLines = summary.flatMap(item => wrappedLines(item, 9.2, contentWidth - 8));
        const summaryHeight = summaryLines.length * summaryLineHeight + 6;
        ensureSpace(summaryHeight);
        doc.setFillColor(245, 248, 251);
        doc.rect(margin.left, y, contentWidth, summaryHeight, 'F');
        doc.setFillColor(47, 111, 173);
        doc.rect(margin.left, y, 1.5, summaryHeight, 'F');
        y += 4.5;
        doc.setTextColor(23, 43, 77);
        for (const line of summaryLines) {
            doc.text(line, margin.left + 4, y);
            y += summaryLineHeight;
        }
        y += 5;

        writeWrapped(`Busca de origem: ${query}`, {
            size: 8.4,
            color: [82, 96, 109],
            after: 5,
            lineHeight: 3.7
        });
        writeWrapped(`Conversa (${comments.length} comentário(s))`, {
            size: 14,
            style: 'bold',
            color: [22, 50, 79],
            after: 3,
            lineHeight: 6.2
        });

        if (!comments.length) {
            writeWrapped('Nenhum comentário incluído.', { style: 'italic' });
        }

        comments.forEach((comment, index) => {
            const isPublic = Boolean(comment.public);
            const visibility = isPublic ? 'Público' : 'Nota interna';
            const sanitized = sanitizeCommentHtml(comment.html_body || comment.plain_body || comment.body || '');
            const body = htmlToPlainText(sanitized.html) || 'Comentário sem conteúdo textual.';
            const header = `#${index + 1} | ${visibility} | ${formatDate(comment.created_at)} | ${userLabel(comment.author_id)}`;
            const headerLines = wrappedLines(header, 9.1, contentWidth - 6);
            const headerHeight = headerLines.length * 4 + 4;
            ensureSpace(headerHeight + 8);
            doc.setFillColor(...(isPublic ? [238, 247, 242] : [255, 247, 223]));
            doc.rect(margin.left, y, contentWidth, headerHeight, 'F');
            doc.setFillColor(...(isPublic ? [47, 133, 90] : [183, 121, 31]));
            doc.rect(margin.left, y, 1.5, headerHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.1);
            doc.setTextColor(23, 43, 77);
            let headerY = y + 4.2;
            for (const line of headerLines) {
                doc.text(line, margin.left + 4, headerY);
                headerY += 4;
            }
            y += headerHeight + 2.5;
            writeWrapped(body, { size: 10, after: 2, lineHeight: 4.5 });

            if (sanitized.inlineImages.length) {
                writeWrapped('Imagens do comentário:', { size: 9, style: 'bold', after: 0.5 });
                for (const image of sanitized.inlineImages) {
                    writeWrapped(`- ${image.label}: ${image.source}`, {
                        size: 8.2, color: [18, 89, 167], indent: 2, after: 0.5, lineHeight: 3.6
                    });
                }
            }
            if (comment.attachments?.length) {
                writeWrapped('Anexos:', { size: 9, style: 'bold', after: 0.5 });
                for (const attachment of comment.attachments) {
                    const size = formatBytes(attachment.size);
                    const label = `- ${attachment.file_name || 'Anexo'}${size ? ` (${size})` : ''}`;
                    const url = attachment.content_url ? `: ${attachment.content_url}` : '';
                    writeWrapped(label + url, {
                        size: 8.2, color: [18, 89, 167], indent: 2, after: 0.5, lineHeight: 3.6
                    });
                }
            }
            ensureSpace(3);
            doc.setDrawColor(216, 224, 232);
            doc.line(margin.left, y, pageWidth - margin.right, y);
            y += 5;
        });

        if (documentData.includeEvents) {
            const entries = auditEntries(documentData);
            addPage();
            writeWrapped(`Eventos de auditoria (${entries.length}) - Uso interno`, {
                size: 14, style: 'bold', after: 4
            });
            writeWrapped(`${documentData.audits.length} auditoria(s); ${documentData.totalEvents} evento(s) recebido(s); `
                + `${documentData.omittedEvents} referência(s) de comentário omitida(s) por privacidade/indisponibilidade.`, { size: 9 });
            writeWrapped('Histórico administrativo: não é conteúdo público. Os corpos históricos dos comentários não são reproduzidos.', { size: 9 });
            if (!documentData.includePrivate) {
                writeWrapped('Notas internas desativadas: detalhes de notificações, campos livres e outros eventos foram omitidos.', { size: 9 });
            }
            if (!entries.length) writeWrapped('Nenhum evento incluído.', { style: 'italic' });
            entries.forEach(({ audit, event, summary, details }, index) => {
                ensureSpace(16);
                writeWrapped(`#${index + 1} | ${event.type} | ID ${event.id ?? 'não informado'} | ${formatDate(audit.created_at)}`, {
                    size: 10, style: 'bold', after: 1
                });
                writeWrapped(`Auditoria ${audit.id} | Autor: ${userLabel(audit.author_id)} | Canal: ${event.via?.channel || audit.via?.channel || 'Não informado'}`, { size: 9 });
                writeWrapped(summary, { size: 10 });
                writeWrapped(details, { size: 8, lineHeight: 3.5, after: 5 });
            });
        }

        const totalPages = doc.getNumberOfPages();
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            doc.setPage(pageNumber);
            doc.setDrawColor(216, 224, 232);
            doc.line(margin.left, pageHeight - 11, pageWidth - margin.right, pageHeight - 11);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(82, 96, 109);
            doc.text(`Ticket #${ticketId}`, margin.left, pageHeight - 6.5);
            doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth - margin.right, pageHeight - 6.5, { align: 'right' });
        }
        return doc.output('blob');
    }

    function formatsForSelection(value) {
        if (value === 'md') return ['md'];
        if (value === 'both') return ['pdf', 'md'];
        return ['pdf'];
    }

    function recordHasFormats(record, formats) {
        return Boolean(record) && !record.erro
            && formats.every(format => Boolean(record[`arquivo_${format}`]));
    }

    function yamlValue(value) {
        if (value === undefined || value === null || value === '') return 'null';
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return JSON.stringify(String(value));
    }

    function markdownInline(value) {
        return String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/([\\`*_[\]<>#])/g, '\\$1');
    }

    function markdownUrl(value) {
        return String(value || '')
            .replace(/\s/g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
    }

    function commentAuthorRole(comment, ticket) {
        const authorId = asNumber(comment?.author_id);
        if (authorId && authorId === asNumber(ticket?.requester_id)) return 'Solicitante';
        const role = String(userCache.get(authorId)?.role || '').toLowerCase();
        if (role === 'agent' || role === 'admin') return 'Atendimento';
        if (role === 'end-user') return 'Usuário final';
        return 'Participante';
    }

    function renderMarkdownText(documentData, sourceLabel, includePrivate) {
        const { ticket, comments, group, customStatus } = documentData;
        const ticketId = Number(ticket.id);
        const subject = ticket.subject || `Ticket ${ticketId}`;
        const ticketUrl = `${BASE}/agent/tickets/${ticketId}`;
        const tags = Array.isArray(ticket.tags) ? ticket.tags : [];
        const lines = [
            '---',
            'schema_version: 2',
            `document_id: ${yamlValue(`ZD-TICKET-${ticketId}`)}`,
            'source_type: "zendesk_ticket"',
            'idioma: "pt-BR"',
            `ticket_id: ${ticketId}`,
            `assunto: ${yamlValue(subject)}`,
            `status: ${yamlValue(ticket.status)}`,
            `status_personalizado: ${yamlValue(customStatus)}`,
            `custom_status_id: ${yamlValue(ticket.custom_status_id)}`,
            `grupo: ${yamlValue(group)}`,
            `group_id: ${yamlValue(ticket.group_id)}`,
            `solicitante: ${yamlValue(userLabel(ticket.requester_id))}`,
            `requester_id: ${yamlValue(ticket.requester_id)}`,
            `responsavel: ${yamlValue(userLabel(ticket.assignee_id))}`,
            `assignee_id: ${yamlValue(ticket.assignee_id)}`,
            `criado_em: ${yamlValue(ticket.created_at)}`,
            `atualizado_em: ${yamlValue(ticket.updated_at)}`,
            `prioridade: ${yamlValue(ticket.priority)}`,
            `tipo: ${yamlValue(ticket.type)}`,
            `inclui_notas_internas: ${Boolean(includePrivate)}`,
            `access_scope: ${yamlValue(includePrivate || documentData.includeEvents ? 'internal' : 'public')}`,
            `comentarios: ${comments.length}`,
            `inclui_eventos: ${Boolean(documentData.includeEvents)}`,
            `eventos_status: ${yamlValue(documentData.includeEvents ? 'complete' : 'not_requested')}`,
            `auditorias: ${documentData.audits?.length || 0}`,
            `eventos_recebidos: ${documentData.totalEvents || 0}`,
            `eventos_exportados: ${(documentData.totalEvents || 0) - (documentData.omittedEvents || 0)}`,
            `eventos_comentarios_omitidos: ${documentData.omittedEvents || 0}`,
            `eventos_detalhes_restritos: ${Boolean(documentData.includeEvents && !includePrivate)}`,
            `tags: [${tags.map(yamlValue).join(', ')}]`,
            `fonte: ${yamlValue(ticketUrl)}`,
            `coleta: ${yamlValue(sourceLabel)}`,
            `exportado_em: ${yamlValue(new Date().toISOString())}`,
            '---',
            '',
            `# Ticket #${ticketId} — ${markdownInline(subject)}`,
            '',
            '## Metadados',
            '',
            `- **Status:** ${markdownInline(customStatus)}`,
            `- **Grupo:** ${markdownInline(group)}`,
            `- **Solicitante:** ${markdownInline(userLabel(ticket.requester_id))}`,
            `- **Responsável:** ${markdownInline(userLabel(ticket.assignee_id))}`,
            `- **Criado em:** ${markdownInline(formatDate(ticket.created_at))}`,
            `- **Atualizado em:** ${markdownInline(formatDate(ticket.updated_at))}`,
            `- **Prioridade:** ${markdownInline(ticket.priority || 'Não informada')}`,
            `- **Tipo:** ${markdownInline(ticket.type || 'Não informado')}`,
            `- **Tags:** ${tags.length ? tags.map(tag => `\`${String(tag).replaceAll('`', '\\`')}\``).join(', ') : 'Nenhuma'}`,
            `- **Fonte:** <${markdownUrl(ticketUrl)}>`,
            '',
            `## Conversa (${comments.length} comentário(s))`,
            ''
        ];

        if (!comments.length) lines.push('_Nenhum comentário incluído._', '');

        comments.forEach((comment, index) => {
            const visibility = comment.public ? 'Público' : 'Nota interna';
            const role = commentAuthorRole(comment, ticket);
            const commentId = asNumber(comment.id);
            const createdAt = comment.created_at || 'data não informada';
            const sanitized = sanitizeCommentHtml(comment.html_body || comment.plain_body || comment.body || '');
            const body = htmlToNormalizedText(sanitized.html, false, true)
                || 'Comentário sem conteúdo textual.';
            lines.push(
                `### Comentário ${String(index + 1).padStart(4, '0')} | ID ${commentId || 'não informado'} | ${role} | ${visibility} | ${markdownInline(createdAt)}`,
                '',
                `- **ID do comentário:** ${commentId || 'Não informado'}`,
                `- **Data:** ${markdownInline(formatDate(comment.created_at))}`,
                `- **Autor:** ${markdownInline(userLabel(comment.author_id))}`,
                `- **Papel:** ${markdownInline(role)}`,
                `- **Visibilidade:** ${markdownInline(visibility)}`,
                '',
                body,
                ''
            );
            if (sanitized.inlineImages.length) {
                lines.push('#### Imagens', '');
                for (const image of sanitized.inlineImages) {
                    lines.push(`- [${markdownInline(image.label)}](${markdownUrl(image.source)})`);
                }
                lines.push('');
            }
            if (comment.attachments?.length) {
                lines.push('#### Anexos', '');
                for (const attachment of comment.attachments) {
                    const size = formatBytes(attachment.size);
                    const label = `${attachment.file_name || 'Anexo'}${size ? ` (${size})` : ''}`;
                    if (attachment.content_url) {
                        lines.push(`- [${markdownInline(label)}](${markdownUrl(attachment.content_url)})`);
                    } else {
                        lines.push(`- ${markdownInline(label)}`);
                    }
                }
                lines.push('');
            }
        });

        if (documentData.includeEvents) {
            const entries = auditEntries(documentData);
            lines.push('## Eventos de auditoria — Uso interno', '',
                '- **Visibilidade:** internal',
                `- **Auditorias:** ${documentData.audits.length}`,
                `- **Eventos recebidos:** ${documentData.totalEvents}`,
                `- **Eventos exportados:** ${entries.length}`,
                `- **Referências de comentários omitidas:** ${documentData.omittedEvents}`, '',
                'Histórico administrativo do ticket. Corpos históricos de comentários não são reproduzidos; consulte a versão atual na seção Conversa.', '');
            if (!includePrivate) lines.push('Notas internas desativadas: detalhes de notificações, campos livres e outros eventos foram omitidos.', '');
            if (!entries.length) lines.push('_Nenhum evento incluído._', '');
            entries.forEach(({ audit, event, summary, details }, index) => {
                lines.push(`### Evento ${String(index + 1).padStart(4, '0')} | ${markdownInline(event.type)} | ID ${markdownInline(event.id ?? 'não informado')} | Nota interna`, '',
                    `- **Auditoria ID:** ${audit.id}`,
                    `- **Data ISO:** ${markdownInline(audit.created_at || '')}`,
                    `- **Data:** ${markdownInline(formatDate(audit.created_at))}`,
                    `- **Autor:** ${markdownInline(userLabel(audit.author_id))}`,
                    `- **Autor ID:** ${audit.author_id ?? 'Não informado'}`,
                    `- **Canal:** ${markdownInline(event.via?.channel || audit.via?.channel || 'Não informado')}`,
                    '- **Visibilidade:** internal', '',
                    markdownInline(summary), '', '#### Dados estruturados do evento', '', fencedJson(details), '');
            });
        }

        return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
    }

    function renderMarkdownBlob(documentData, sourceLabel, includePrivate) {
        return new Blob(
            [renderMarkdownText(documentData, sourceLabel, includePrivate)],
            { type: 'text/markdown;charset=utf-8' }
        );
    }

    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    }

    function createManifestCsv(rows) {
        const headers = [
            'id', 'assunto', 'status_zendesk', 'custom_status_id', 'grupo',
            'criado_em', 'atualizado_em', 'comentarios', 'url', 'query_origem',
            'formatos_salvos', 'arquivo_pdf', 'arquivo_md', 'inclui_eventos',
            'auditorias', 'eventos_recebidos', 'eventos_exportados',
            'eventos_comentarios_omitidos', 'eventos_detalhes_restritos', 'eventos_status', 'erro'
        ];
        return '\uFEFF' + [
            headers.map(csvCell).join(';'),
            ...rows.map(row => headers.map(header => csvCell(row[header])).join(';'))
        ].join('\r\n');
    }

    function normalizeQuery(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function splitDelimitedLine(line, delimiter) {
        const cells = [];
        let value = '';
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (character === '"') {
                if (quoted && line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (character === delimiter && !quoted) {
                cells.push(value.trim());
                value = '';
            } else {
                value += character;
            }
        }
        cells.push(value.trim());
        return cells;
    }

    function ticketIdFromValue(value) {
        const text = String(value || '').trim();
        const urlMatch = text.match(/\/(?:agent\/)?tickets?\/(\d+)/i);
        const numeric = urlMatch?.[1] || text.replace(/^#/, '');
        if (!/^\d+$/.test(numeric)) return null;
        const id = Number(numeric);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    function parseTicketIds(value) {
        const text = String(value || '').replace(/^\uFEFF/, '').trim();
        if (!text) return [];
        const ids = new Set();
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const delimiters = [';', ',', '\t'];
        const delimiter = delimiters
            .map(item => ({ item, count: (lines[0]?.split(item).length || 1) - 1 }))
            .sort((a, b) => b.count - a.count)[0];
        const chosenDelimiter = delimiter?.count > 0 ? delimiter.item : null;
        let headerIndex = -1;

        if (chosenDelimiter && lines.length > 1) {
            const headerNames = splitDelimitedLine(lines[0], chosenDelimiter).map(cell =>
                cell.normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '')
            );
            const acceptedHeaders = new Set([
                'id', 'ticket', 'ticket_id', 'id_ticket', 'numero_ticket',
                'nro_ticket', 'chamado', 'id_chamado'
            ]);
            headerIndex = headerNames.findIndex(name => acceptedHeaders.has(name));
        }

        if (headerIndex >= 0) {
            for (const line of lines.slice(1)) {
                const id = ticketIdFromValue(splitDelimitedLine(line, chosenDelimiter)[headerIndex]);
                if (id) ids.add(id);
            }
        } else {
            for (const line of lines) {
                for (const match of line.matchAll(/\/(?:agent\/)?tickets?\/(\d+)/gi)) {
                    const id = ticketIdFromValue(match[1]);
                    if (id) ids.add(id);
                }
                for (const token of line.split(/[\s,;|\t]+/)) {
                    const id = ticketIdFromValue(token);
                    if (id) ids.add(id);
                }
            }
        }
        return [...ids];
    }

    function ticketListKey(ticketIds) {
        return `ticket-list:${ticketIds.join(',')}`;
    }

    function exportProfileKey(sourceKey, includePrivate, includeEvents = false) {
        const visibility = includePrivate ? 'public-and-private' : 'public-only';
        return `profile:${EXPORT_PROFILE_VERSION}:${visibility}:${includeEvents ? 'with-events' : 'no-events'}:${sourceKey}`;
    }

    function queryId(query) {
        let hash = 2166136261;
        for (const char of query) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function stateKey(query) {
        return `${STATE_PREFIX}${queryId(query)}`;
    }

    function emptyState(query) {
        return { query, records: {} };
    }

    async function loadState(query) {
        try {
            const db = await openHandleDatabase();
            const state = await new Promise((resolve, reject) => {
                const transaction = db.transaction(PROGRESS_STORE, 'readonly');
                const request = transaction.objectStore(PROGRESS_STORE).get(stateKey(query));
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
            db.close();
            if (!state || state.query !== query || !state.records
                || typeof state.records !== 'object' || Array.isArray(state.records)) {
                return emptyState(query);
            }
            return state;
        } catch (_) {
            return emptyState(query);
        }
    }

    async function saveState(query, state) {
        const db = await openHandleDatabase();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(PROGRESS_STORE, 'readwrite');
            transaction.objectStore(PROGRESS_STORE).put(state, stateKey(query));
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        db.close();
    }

    function enqueueStateSave(query, state) {
        const snapshot = JSON.parse(JSON.stringify(state));
        const operation = progressWriteChain
            .catch(() => undefined)
            .then(() => saveState(query, snapshot));
        progressWriteChain = operation;
        return operation;
    }

    async function clearState(query) {
        const db = await openHandleDatabase();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(PROGRESS_STORE, 'readwrite');
            transaction.objectStore(PROGRESS_STORE).delete(stateKey(query));
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        log('Progresso desta query apagado. A próxima execução começará do primeiro ticket.');
    }

    async function clearEverything(panel) {
        const keysToRemove = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(STATE_PREFIX)) keysToRemove.push(key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        localStorage.removeItem(LEGACY_QUERY_KEY);
        const db = await openHandleDatabase();
        const indexedProgressCount = await new Promise((resolve, reject) => {
            const transaction = db.transaction(PROGRESS_STORE, 'readwrite');
            const store = transaction.objectStore(PROGRESS_STORE);
            const countRequest = store.count();
            let count = 0;
            countRequest.onsuccess = () => {
                count = countRequest.result;
                store.clear();
            };
            transaction.oncomplete = () => resolve(count);
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        panel.querySelector('#attus-zdexp-query').value = '';
        panel.querySelector('#attus-zdexp-ticket-list').value = '';
        panel.querySelector('#attus-zdexp-file').value = '';
        panel.querySelector('#attus-zdexp-limit').value = '0';
        panel.querySelector('#attus-zdexp-format').value = 'pdf';
        panel.querySelector('#attus-zdexp-concurrency').value = String(DEFAULT_CONCURRENCY);
        panel.querySelector('#attus-zdexp-private').checked = true;
        panel.querySelector('#attus-zdexp-events').checked = true;
        panel.querySelector('#attus-zdexp-resume').checked = true;
        panel.querySelector('#attus-zdexp-status').textContent = '';
        log(`Tudo limpo: campos e ${keysToRemove.length + indexedProgressCount} progresso(s) salvo(s) foram removidos.`);
    }

    function openHandleDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HANDLE_DB, HANDLE_DB_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
                    request.result.createObjectStore(HANDLE_STORE);
                }
                if (!request.result.objectStoreNames.contains(PROGRESS_STORE)) {
                    request.result.createObjectStore(PROGRESS_STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function persistDirectoryHandle(handle) {
        const db = await openHandleDatabase();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(HANDLE_STORE, 'readwrite');
            transaction.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    }

    async function restoreDirectoryHandle() {
        try {
            const db = await openHandleDatabase();
            directoryHandle = await new Promise((resolve, reject) => {
                const transaction = db.transaction(HANDLE_STORE, 'readonly');
                const request = transaction.objectStore(HANDLE_STORE).get(HANDLE_KEY);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
            db.close();
        } catch (_) {
            directoryHandle = null;
        }
        updateFolderLabel();
    }

    function updateFolderLabel() {
        const label = document.querySelector('#attus-zdexp-folder');
        if (label) {
            label.textContent = directoryHandle
                ? `Pasta selecionada: ${directoryHandle.name}`
                : 'Nenhuma pasta selecionada.';
        }
    }

    async function selectOutputDirectory() {
        if (typeof window.showDirectoryPicker !== 'function') {
            throw new Error('Este Chrome não oferece gravação direta em pasta. Atualize o navegador.');
        }
        try {
            directoryHandle = await window.showDirectoryPicker({
                id: 'attus-zendesk-pdf-export',
                mode: 'readwrite',
                startIn: 'downloads'
            });
            await persistDirectoryHandle(directoryHandle);
            updateFolderLabel();
            log(`Pasta selecionada: ${directoryHandle.name}. Os arquivos serão gravados sem perguntas individuais.`);
            return directoryHandle;
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            throw error;
        }
    }

    async function ensureOutputDirectory() {
        if (directoryHandle) {
            const options = { mode: 'readwrite' };
            if (await directoryHandle.queryPermission(options) === 'granted') return directoryHandle;
            if (await directoryHandle.requestPermission(options) === 'granted') return directoryHandle;
        }
        return selectOutputDirectory();
    }

    async function saveBlobToDirectory(blob, filename) {
        if (!directoryHandle) throw new Error('Nenhuma pasta de saída foi selecionada.');
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(blob);
            await writable.close();
        } catch (error) {
            try { await writable.abort(); } catch (_) { /* arquivo temporário já encerrado */ }
            throw error;
        }
    }

    function updateSavedFormats(row) {
        const formats = [];
        if (row.arquivo_pdf) formats.push('PDF');
        if (row.arquivo_md) formats.push('Markdown');
        row.formatos_salvos = formats.join(' + ');
        return row;
    }

    function manifestRow(documentData, query, existing = {}) {
        const { ticket, comments, group } = documentData;
        return updateSavedFormats({
            id: ticket.id,
            assunto: ticket.subject || '',
            status_zendesk: ticket.status || '',
            custom_status_id: ticket.custom_status_id || '',
            grupo: group,
            criado_em: ticket.created_at || '',
            atualizado_em: ticket.updated_at || '',
            comentarios: comments.length,
            inclui_eventos: Boolean(documentData.includeEvents),
            auditorias: documentData.audits?.length || 0,
            eventos_recebidos: documentData.totalEvents || 0,
            eventos_exportados: (documentData.totalEvents || 0) - (documentData.omittedEvents || 0),
            eventos_comentarios_omitidos: documentData.omittedEvents || 0,
            eventos_detalhes_restritos: Boolean(documentData.includeEvents && !documentData.includePrivate),
            eventos_status: documentData.includeEvents ? 'complete' : 'not_requested',
            url: `${BASE}/agent/tickets/${ticket.id}`,
            query_origem: query,
            formatos_salvos: existing.formatos_salvos || '',
            arquivo_pdf: existing.arquivo_pdf || '',
            arquivo_md: existing.arquivo_md || '',
            erro: ''
        });
    }

    function errorManifestRow(searchTicket, sourceLabel, existing, error) {
        return updateSavedFormats({
            id: searchTicket.id,
            assunto: existing.assunto || searchTicket.subject || '',
            status_zendesk: existing.status_zendesk || searchTicket.status || '',
            custom_status_id: existing.custom_status_id || searchTicket.custom_status_id || '',
            grupo: existing.grupo || '',
            criado_em: existing.criado_em || searchTicket.created_at || '',
            atualizado_em: existing.atualizado_em || searchTicket.updated_at || '',
            comentarios: existing.comentarios ?? '',
            inclui_eventos: existing.inclui_eventos ?? '',
            auditorias: existing.auditorias ?? '',
            eventos_recebidos: existing.eventos_recebidos ?? '',
            eventos_exportados: existing.eventos_exportados ?? '',
            eventos_comentarios_omitidos: existing.eventos_comentarios_omitidos ?? '',
            eventos_detalhes_restritos: existing.eventos_detalhes_restritos ?? '',
            eventos_status: existing.eventos_status || 'error',
            url: `${BASE}/agent/tickets/${searchTicket.id}`,
            query_origem: sourceLabel,
            formatos_salvos: existing.formatos_salvos || '',
            arquivo_pdf: existing.arquivo_pdf || '',
            arquivo_md: existing.arquivo_md || '',
            erro: error.message
        });
    }

    async function exportTicket(
        searchTicket, index, total, includePrivate, requestedFormats,
        sourceLabel, progressKey, state, errorRows, includeEvents = false
    ) {
        log(`Preparando ticket #${searchTicket.id} (${index + 1}/${total})...`);
        const ticketKey = String(searchTicket.id);
        let row = { ...(state.records[ticketKey] || {}), inclui_eventos: includeEvents };
        let createdFiles = 0;
        try {
            const documentData = await loadTicketDocument(searchTicket, includePrivate, includeEvents);
            row = manifestRow(documentData, sourceLabel, row);
            const basename = `${documentData.ticket.id}-${safeFilename(documentData.ticket.subject)}${includeEvents ? '-com-eventos' : ''}`;

            for (const format of requestedFormats) {
                if (row[`arquivo_${format}`]) continue;
                const filename = `${basename}.${format}`;
                const blob = format === 'pdf'
                    ? await renderPdfBlob(documentData, sourceLabel)
                    : renderMarkdownBlob(documentData, sourceLabel, includePrivate);
                await saveBlobToDirectory(blob, filename);
                row[`arquivo_${format}`] = filename;
                row.erro = '';
                updateSavedFormats(row);
                state.records[ticketKey] = row;
                await enqueueStateSave(progressKey, state);
                createdFiles += 1;
                log(`${format === 'pdf' ? 'PDF' : 'Markdown'} salvo: ${filename} (${index + 1}/${total}).`);
            }

            state.records[ticketKey] = updateSavedFormats(row);
            await enqueueStateSave(progressKey, state);
            return { success: true, createdFiles };
        } catch (error) {
            if (isAuthenticationError(error)) throw error;
            const errorRow = errorManifestRow(searchTicket, sourceLabel, row, error);
            errorRows.push(errorRow);
            state.records[ticketKey] = errorRow;
            try {
                await enqueueStateSave(progressKey, state);
            } catch (stateError) {
                log(`Aviso: não foi possível registrar a falha do ticket #${searchTicket.id}: ${stateError.message}`);
            }
            log(`ERRO no ticket #${searchTicket.id}: ${error.message}`);
            return { success: false, createdFiles };
        }
    }

    async function runTicketPool(items, concurrency, worker) {
        let nextIndex = 0;
        let fatalError = null;
        let successfulTickets = 0;
        let createdFiles = 0;

        const runner = async () => {
            while (!cancelRequested && !fatalError) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= items.length) return;
                try {
                    const result = await worker(items[index], index);
                    if (result.success) successfulTickets += 1;
                    createdFiles += result.createdFiles;
                } catch (error) {
                    fatalError = error;
                }
            }
        };

        const workerCount = Math.min(concurrency, items.length);
        await Promise.all(Array.from({ length: workerCount }, () => runner()));
        return { fatalError, successfulTickets, createdFiles };
    }

    async function startExport() {
        if (running) return;
        const formatSelection = document.querySelector('#attus-zdexp-format').value;
        const requestedFormats = formatsForSelection(formatSelection);
        if (requestedFormats.includes('pdf')
            && typeof (window.jspdf?.jsPDF || window.jsPDF) !== 'function') {
            log('ERRO: a biblioteca de PDF não foi carregada. Recarregue a página e tente novamente.');
            return;
        }
        const query = normalizeQuery(document.querySelector('#attus-zdexp-query').value);
        const ticketListText = document.querySelector('#attus-zdexp-ticket-list').value.trim();
        const ticketIds = parseTicketIds(ticketListText);
        if (ticketListText && !ticketIds.length) {
            log('ERRO: a lista informada não contém IDs ou URLs de tickets válidos.');
            return;
        }
        if (!query && !ticketIds.length) {
            log('ERRO: informe uma query ou uma lista de tickets.');
            return;
        }
        const includePrivate = document.querySelector('#attus-zdexp-private').checked;
        const includeEvents = document.querySelector('#attus-zdexp-events').checked;
        const sourceKey = ticketIds.length ? ticketListKey(ticketIds) : query;
        const progressKey = exportProfileKey(sourceKey, includePrivate, includeEvents);
        const sourceLabel = ticketIds.length
            ? `Lista direta com ${ticketIds.length} ticket(s)`
            : query;

        running = true;
        cancelRequested = false;
        setRunningUi(true);
        const limit = Math.max(0, Number(document.querySelector('#attus-zdexp-limit').value || 0));
        const resume = document.querySelector('#attus-zdexp-resume').checked;
        const requestedConcurrency = Math.floor(Number(
            document.querySelector('#attus-zdexp-concurrency').value || DEFAULT_CONCURRENCY
        ));
        const concurrency = Number.isFinite(requestedConcurrency)
            ? Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, requestedConcurrency))
            : DEFAULT_CONCURRENCY;

        try {
            progressWriteChain = Promise.resolve();
            const outputDirectory = await ensureOutputDirectory();
            if (!outputDirectory) throw new Error('Seleção da pasta de saída cancelada.');
            log('Validando a sessão existente do Chrome...');
            await validateSession();
            await loadCustomStatuses();
            if (includeEvents) await loadTicketFields();
            let tickets;
            let expected = null;
            if (ticketIds.length) {
                tickets = ticketIds.map(id => ({ id }));
                expected = tickets.length;
                log(`Lista direta: ${tickets.length} ticket(s) único(s) informado(s). A query será ignorada nesta execução.`);
            } else {
                log(`Query: ${query}`);
                const search = parseSearchQuery(query);
                if (search.filterQuery !== query) {
                    log(`Filtro enviado à API: ${search.filterQuery}`);
                    log(`Ordenação local: ${search.orderBy} ${search.sort}.`);
                }
                expected = await getSearchCount(search.filterQuery);
                log(`Zendesk informou ${expected ?? '?'} ticket(s) para a busca.`);
                tickets = await collectTickets(search);
            }
            if (cancelRequested) throw new Error('Exportação cancelada durante a busca.');
            if (!ticketIds.length && expected !== null && expected !== tickets.length) {
                log(`Aviso: a contagem mudou durante a coleta (${expected} → ${tickets.length}).`);
            }
            if (limit > 0) tickets = tickets.slice(0, limit);

            const state = await loadState(progressKey);
            if (!resume) {
                state.records = {};
                await saveState(progressKey, state);
            }
            const pending = tickets.filter(ticket =>
                !recordHasFormats(state.records[String(ticket.id)], requestedFormats)
            );
            const skipped = tickets.length - pending.length;
            log(`${tickets.length} ticket(s) selecionado(s); ${skipped} já concluído(s); ${pending.length} pendente(s).`);
            const ticketOrder = new Map(tickets.map((ticket, index) => [String(ticket.id), index]));
            const manifestRows = () => Object.values(state.records).sort((a, b) =>
                (ticketOrder.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER)
                - (ticketOrder.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
            );

            if (!pending.length) {
                const allRows = manifestRows();
                if (allRows.length) {
                    await saveBlobToDirectory(
                        new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }),
                        `zendesk-tickets-manifesto-${queryId(progressKey)}.csv`
                    );
                }
                log('Nenhum ticket pendente. Exportação já concluída.');
                return;
            }

            const formatLabel = requestedFormats.length === 2
                ? 'PDF + Markdown'
                : requestedFormats[0] === 'pdf' ? 'PDF' : 'Markdown';
            log(
                `Iniciando ${pending.length} ticket(s) em ${formatLabel}, com `
                + `${concurrency} processo(s) simultâneo(s), na pasta "${outputDirectory.name}".`
            );
            log(`Eventos de auditoria: ${includeEvents ? 'incluídos (uso interno)' : 'não solicitados'}.`);

            const errorRows = [];
            const poolResult = await runTicketPool(
                pending,
                concurrency,
                (ticket, index) => exportTicket(
                    ticket, index, pending.length, includePrivate, requestedFormats,
                    sourceLabel, progressKey, state, errorRows, includeEvents
                )
            );
            await progressWriteChain.catch(() => undefined);

            const allRows = manifestRows();
            if (allRows.length) {
                await saveBlobToDirectory(
                    new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }),
                    `zendesk-tickets-manifesto-${queryId(progressKey)}.csv`
                );
            }
            if (poolResult.fatalError) throw poolResult.fatalError;
            if (cancelRequested) {
                log('Exportação interrompida. Os arquivos concluídos foram salvos e podem ser retomados.');
            } else if (errorRows.length) {
                log(
                    `Concluído com alertas: ${poolResult.successfulTickets} ticket(s), `
                    + `${poolResult.createdFiles} arquivo(s) novo(s) e ${errorRows.length} erro(s).`
                );
            } else {
                log(
                    `Concluído: ${poolResult.successfulTickets} ticket(s) e `
                    + `${poolResult.createdFiles} arquivo(s) novo(s) nesta execução.`
                );
            }
        } catch (error) {
            log(`ERRO: ${error.message}`);
            console.error('[Extrator de Tickets]', error);
        } finally {
            running = false;
            setRunningUi(false);
        }
    }

    function log(message) {
        const status = document.querySelector('#attus-zdexp-status');
        const timestamp = new Date().toLocaleTimeString('pt-BR');
        if (status) {
            status.textContent += `${status.textContent ? '\n' : ''}[${timestamp}] ${message}`;
            status.scrollTop = status.scrollHeight;
        }
        console.log('[Extrator de Tickets]', message);
    }

    function setRunningUi(isRunning) {
        document.querySelector('#attus-zdexp-start').disabled = isRunning;
        document.querySelector('#attus-zdexp-reset').disabled = isRunning;
        document.querySelector('#attus-zdexp-clear-all').disabled = isRunning;
        document.querySelector('#attus-zdexp-select-folder').disabled = isRunning;
        document.querySelector('#attus-zdexp-query').disabled = isRunning;
        document.querySelector('#attus-zdexp-ticket-list').disabled = isRunning;
        document.querySelector('#attus-zdexp-file').disabled = isRunning;
        document.querySelector('#attus-zdexp-format').disabled = isRunning;
        document.querySelector('#attus-zdexp-concurrency').disabled = isRunning;
        document.querySelector('#attus-zdexp-private').disabled = isRunning;
        document.querySelector('#attus-zdexp-events').disabled = isRunning;
        document.querySelector('#attus-zdexp-cancel').disabled = !isRunning;
    }

    function createUi() {
        if (document.querySelector('#attus-zdexp-open')) return;
        const openButton = document.createElement('button');
        openButton.id = 'attus-zdexp-open';
        openButton.type = 'button';
        openButton.textContent = 'Extrator de Tickets';

        const panel = document.createElement('section');
        panel.id = 'attus-zdexp-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <button id="attus-zdexp-close" type="button" title="Fechar">×</button>
            <h2>Extrator de Tickets</h2>
            <p>Gera arquivos PDF, Markdown ou ambos usando uma query ou uma lista direta de tickets.</p>
            <div class="attus-zdexp-grid">
                <label>Query da coleta (opcional quando houver lista)
                    <textarea id="attus-zdexp-query" spellcheck="false"></textarea>
                </label>
                <label>Tickets específicos (IDs ou URLs, um por linha)
                    <textarea id="attus-zdexp-ticket-list" spellcheck="false" placeholder="151088&#10;151089&#10;https://attus-ai.zendesk.com/agent/tickets/151090"></textarea>
                </label>
                <label>Importar lista TXT ou CSV
                    <input id="attus-zdexp-file" type="file" accept=".txt,.csv,text/plain,text/csv">
                </label>
                <label>Limite de teste
                    <input id="attus-zdexp-limit" type="number" min="0" step="1" placeholder="0 = todos" value="0">
                </label>
                <label>Formato de saída
                    <select id="attus-zdexp-format">
                        <option value="pdf">PDF</option>
                        <option value="md">Markdown</option>
                        <option value="both">PDF + Markdown</option>
                    </select>
                </label>
                <label>Processos simultâneos
                    <input id="attus-zdexp-concurrency" type="number" min="1" max="8" step="1" value="4">
                </label>
            </div>
            <label class="attus-zdexp-check"><input id="attus-zdexp-private" type="checkbox" checked> Incluir notas internas</label>
            <label class="attus-zdexp-check"><input id="attus-zdexp-events" type="checkbox" checked> Incluir eventos de auditoria (uso interno)</label>
            <label class="attus-zdexp-check"><input id="attus-zdexp-resume" type="checkbox" checked> Retomar e pular formatos já concluídos</label>
            <p id="attus-zdexp-folder">Nenhuma pasta selecionada.</p>
            <p class="attus-zdexp-note">Quando houver uma lista, ela terá prioridade. O progresso controla PDF e Markdown separadamente e respeita a inclusão de notas internas. A concorrência é pausada automaticamente ao se aproximar do limite da API.</p>
            <p class="attus-zdexp-note">Eventos incluem mudanças de campos, status, grupos, responsáveis, regras e demais ações registradas pela API. Arquivos com eventos recebem o sufixo -com-eventos e são de uso interno. Sem notas internas, detalhes potencialmente privados são omitidos. Falhas na auditoria impedem concluir o ticket; não geram um histórico parcial como se fosse completo.</p>
            <div class="attus-zdexp-actions">
                <button id="attus-zdexp-select-folder" type="button">Selecionar pasta</button>
                <button id="attus-zdexp-start" class="primary" type="button">Iniciar exportação</button>
                <button id="attus-zdexp-cancel" class="danger" type="button" disabled>Cancelar</button>
                <button id="attus-zdexp-reset" type="button">Apagar progresso desta coleta</button>
                <button id="attus-zdexp-clear-all" class="danger" type="button">Limpar tudo</button>
            </div>
            <pre id="attus-zdexp-status">Pronto. Recomenda-se testar primeiro com limite 1.</pre>
        `;

        document.body.append(openButton, panel);
        openButton.addEventListener('click', () => { panel.hidden = !panel.hidden; });
        panel.querySelector('#attus-zdexp-close').addEventListener('click', () => { panel.hidden = true; });
        panel.querySelector('#attus-zdexp-select-folder').addEventListener('click', async () => {
            try { await selectOutputDirectory(); } catch (error) { log(`ERRO: ${error.message}`); }
        });
        panel.querySelector('#attus-zdexp-file').addEventListener('change', async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const ticketIds = parseTicketIds(await file.text());
                if (!ticketIds.length) {
                    log(`ERRO: nenhum ID de ticket foi encontrado em ${file.name}.`);
                    return;
                }
                panel.querySelector('#attus-zdexp-ticket-list').value = ticketIds.join('\n');
                log(`${ticketIds.length} ticket(s) único(s) importado(s) de ${file.name}.`);
            } catch (error) {
                log(`ERRO ao ler ${file.name}: ${error.message}`);
            }
        });
        panel.querySelector('#attus-zdexp-start').addEventListener('click', startExport);
        panel.querySelector('#attus-zdexp-cancel').addEventListener('click', () => {
            cancelRequested = true;
            log('Cancelamento solicitado; finalizando a etapa atual...');
        });
        panel.querySelector('#attus-zdexp-reset').addEventListener('click', async () => {
            const query = normalizeQuery(panel.querySelector('#attus-zdexp-query').value);
            const ticketListText = panel.querySelector('#attus-zdexp-ticket-list').value.trim();
            const ticketIds = parseTicketIds(ticketListText);
            if (ticketListText && !ticketIds.length) {
                log('ERRO: a lista não contém tickets válidos.');
                return;
            }
            const sourceKey = ticketIds.length ? ticketListKey(ticketIds) : query;
            if (!sourceKey) {
                log('ERRO: informe a query ou lista cujo progresso deve ser apagado.');
                return;
            }
            const includePrivate = panel.querySelector('#attus-zdexp-private').checked;
            const includeEvents = panel.querySelector('#attus-zdexp-events').checked;
            const progressKey = exportProfileKey(sourceKey, includePrivate, includeEvents);
            if (window.confirm('Apagar o progresso salvo desta extração?')) {
                try {
                    await clearState(progressKey);
                } catch (error) {
                    log(`ERRO ao apagar o progresso: ${error.message}`);
                }
            }
        });
        panel.querySelector('#attus-zdexp-clear-all').addEventListener('click', async () => {
            if (!window.confirm('Limpar todos os campos e progressos salvos? A pasta autorizada será preservada.')) return;
            try {
                await clearEverything(panel);
            } catch (error) {
                log(`ERRO ao limpar os dados: ${error.message}`);
            }
        });
        restoreDirectoryHandle();
    }

    createUi();
})();

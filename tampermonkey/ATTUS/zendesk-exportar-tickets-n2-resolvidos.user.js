// ==UserScript==
// @name         Zendesk - Exportar Tickets N2 Resolvidos para PDF
// @namespace    https://attus-ai.zendesk.com/
// @version      2026.07.16.01
// @description  Exporta, usando a sessão já autenticada do Chrome, os tickets resolvidos do Suporte N2 | PGESP em lotes ZIP de PDFs.
// @author       ATTUS
// @match        https://attus-ai.zendesk.com/agent/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @require      https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.3/dist/html2pdf.bundle.min.js
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const BASE = 'https://attus-ai.zendesk.com';
    const SEARCH_QUERY = 'custom_status_id:27867450799003 group:"Suporte N2 | PGESP" order_by:updated_at sort:desc';
    const API_QUERY = 'custom_status_id:27867450799003 group:"Suporte N2 | PGESP"';
    const STATE_KEY = 'attus:zendesk:n2-pdf-export:v1';
    const REQUEST_DELAY_MS = 120;
    const DOWNLOAD_DELAY_MS = 1200;
    const MAX_RETRIES = 5;

    const userCache = new Map();
    const groupCache = new Map();
    const statusCache = new Map();
    let cancelRequested = false;
    let running = false;

    GM_addStyle(`
        #attus-zdexp-open {
            position: fixed; right: 18px; bottom: 20px; z-index: 2147483646;
            border: 0; border-radius: 999px; padding: 11px 16px;
            background: #174ea6; color: #fff; font: 600 13px/1 Arial, sans-serif;
            box-shadow: 0 5px 18px rgba(0,0,0,.28); cursor: pointer;
        }
        #attus-zdexp-open:hover { background: #123d82; }
        #attus-zdexp-panel {
            position: fixed; right: 18px; bottom: 68px; z-index: 2147483647;
            width: min(430px, calc(100vw - 36px)); max-height: calc(100vh - 90px);
            overflow: auto; padding: 16px; border: 1px solid #cbd5e1; border-radius: 10px;
            background: #fff; color: #172b4d; font: 13px/1.45 Arial, sans-serif;
            box-shadow: 0 12px 36px rgba(0,0,0,.32);
        }
        #attus-zdexp-panel[hidden] { display: none !important; }
        #attus-zdexp-panel h2 { margin: 0 28px 6px 0; font-size: 17px; }
        #attus-zdexp-panel p { margin: 6px 0; }
        #attus-zdexp-close {
            position: absolute; top: 8px; right: 9px; border: 0; background: transparent;
            color: #52606d; font-size: 23px; cursor: pointer;
        }
        .attus-zdexp-query {
            margin: 9px 0; padding: 8px; border: 1px solid #d8e0e8; border-radius: 5px;
            background: #f8fafc; font: 11px/1.35 Consolas, monospace; overflow-wrap: anywhere;
        }
        .attus-zdexp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 10px 0; }
        .attus-zdexp-grid label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
        .attus-zdexp-grid input[type="number"] {
            width: 100%; padding: 7px; border: 1px solid #aebdca; border-radius: 5px;
        }
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

        .attus-zdexp-document {
            position: absolute; left: -100000px; top: 0; width: 760px;
            padding: 0; background: #fff; color: #172b4d;
            font: 14px/1.5 Arial, Helvetica, sans-serif; overflow-wrap: anywhere;
        }
        .attus-zdexp-document * { box-sizing: border-box; }
        .attus-zdexp-document h1 { margin: 0 0 12px; color: #102a43; font-size: 27px; line-height: 1.2; }
        .attus-zdexp-document h2 { margin: 28px 0 12px; color: #16324f; font-size: 20px; }
        .attus-zdexp-document a { color: #1259a7; text-decoration: none; }
        .attus-zdexp-document pre { white-space: pre-wrap; background: #f4f6f8; padding: 10px; }
        .attus-zdexp-document blockquote { margin: 10px 0; padding-left: 12px; border-left: 4px solid #7aa7d9; }
        .attus-zdexp-ticket-number { margin-bottom: 6px; color: #52606d; font-size: 12px; }
        .attus-zdexp-summary {
            display: grid; grid-template-columns: 1fr 1fr; gap: 7px 18px;
            margin: 18px 0; padding: 13px; background: #f5f8fb;
            border-left: 5px solid #2f6fad; font-size: 12px; break-inside: avoid;
        }
        .attus-zdexp-wide { grid-column: 1 / -1; }
        .attus-zdexp-source-query {
            margin: 12px 0 22px; padding: 9px; background: #f8fafc;
            border: 1px solid #d8e0e8; font: 10px/1.4 Consolas, monospace;
        }
        .attus-zdexp-comment {
            margin: 0 0 16px; border: 1px solid #d8e0e8;
            border-left-width: 5px; border-radius: 4px; break-inside: auto;
        }
        .attus-zdexp-comment.public { border-left-color: #2f855a; }
        .attus-zdexp-comment.private { border-left-color: #b7791f; background: #fffdf5; }
        .attus-zdexp-comment-head {
            display: flex; justify-content: space-between; gap: 12px;
            padding: 9px 11px; background: #f4f7fa; border-bottom: 1px solid #d8e0e8;
            font-size: 11px; break-after: avoid; break-inside: avoid;
        }
        .attus-zdexp-comment.private .attus-zdexp-comment-head { background: #fff7df; }
        .attus-zdexp-meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; color: #52606d; }
        .attus-zdexp-badge { padding: 1px 6px; border-radius: 10px; background: #e2e8f0; }
        .attus-zdexp-comment.public .attus-zdexp-badge { background: #dcfce7; color: #166534; }
        .attus-zdexp-comment.private .attus-zdexp-badge { background: #fef3c7; color: #92400e; }
        .attus-zdexp-comment-body { padding: 11px; }
        .attus-zdexp-comment-body > :first-child { margin-top: 0; }
        .attus-zdexp-comment-body > :last-child { margin-bottom: 0; }
        .attus-zdexp-attachments, .attus-zdexp-inline-images {
            margin: 0 11px 11px; padding: 8px; background: #eef3f8; font-size: 11px;
        }
        .attus-zdexp-attachments ul, .attus-zdexp-inline-images ul { margin: 4px 0 0; padding-left: 19px; }
    `);

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
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

    async function fetchJson(url) {
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            if (response.status === 401 || response.status === 403) {
                throw new Error(`A sessão desta aba não tem acesso à API do Zendesk (HTTP ${response.status}).`);
            }
            if (response.status === 429 || response.status >= 500) {
                const text = await response.text();
                lastError = `HTTP ${response.status}: ${text.slice(0, 250)}`;
                if (attempt < MAX_RETRIES) {
                    const retryHeader = Number(response.headers.get('retry-after'));
                    const seconds = Number.isFinite(retryHeader)
                        ? Math.max(1, Math.min(retryHeader, 60))
                        : Math.min(2 ** (attempt - 1), 20);
                    log(`Zendesk respondeu HTTP ${response.status}; tentando novamente em ${seconds}s...`);
                    await sleep(seconds * 1000);
                    continue;
                }
            }
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Falha na API: HTTP ${response.status} em ${url}. ${text.slice(0, 350)}`);
            }
            return response.json();
        }
        throw new Error(`A API não respondeu após ${MAX_RETRIES} tentativas. ${lastError}`);
    }

    async function getSearchCount() {
        const payload = await fetchJson(apiUrl('/api/v2/search/count.json', {
            query: `type:ticket ${API_QUERY}`
        }));
        return asNumber(payload.count);
    }

    async function collectTickets() {
        let url = apiUrl('/api/v2/search/export.json', {
            query: API_QUERY,
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

        return [...byId.values()].sort((a, b) => {
            const dateOrder = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
            return dateOrder || Number(b.id || 0) - Number(a.id || 0);
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

    async function populateUsers(ids) {
        const pending = [...new Set(ids.map(asNumber).filter(Boolean))]
            .filter(id => !userCache.has(id));
        for (let index = 0; index < pending.length; index += 100) {
            const batch = pending.slice(index, index + 100);
            const payload = await fetchJson(apiUrl('/api/v2/users/show_many.json', {
                ids: batch.join(',')
            }));
            for (const user of payload.users || []) {
                const id = asNumber(user?.id);
                if (id) userCache.set(id, user);
            }
            await sleep(REQUEST_DELAY_MS);
        }
    }

    async function groupName(groupId) {
        const id = asNumber(groupId);
        if (!id) return 'Não atribuído';
        if (!groupCache.has(id)) {
            const payload = await fetchJson(apiUrl(`/api/v2/groups/${id}.json`));
            groupCache.set(id, payload.group?.name || `Grupo ${id}`);
        }
        return groupCache.get(id);
    }

    async function loadCustomStatuses() {
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
        const template = document.createElement('template');
        template.innerHTML = String(rawHtml || '');
        template.content.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach(node => node.remove());

        const inlineImages = [];
        template.content.querySelectorAll('img').forEach((image, index) => {
            const rawSource = image.getAttribute('src') || '';
            let source = '';
            try { source = new URL(rawSource, BASE).toString(); } catch (_) { source = ''; }
            if (source) inlineImages.push({ source, label: image.getAttribute('alt') || `Imagem ${index + 1}` });
            image.remove();
        });

        template.content.querySelectorAll('*').forEach(element => {
            for (const attribute of [...element.attributes]) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
                if (name === 'style' && /url\s*\(/i.test(attribute.value)) element.removeAttribute('style');
            }
        });

        template.content.querySelectorAll('a[href]').forEach(anchor => {
            try {
                anchor.href = new URL(anchor.getAttribute('href'), BASE).toString();
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            } catch (_) {
                anchor.removeAttribute('href');
            }
        });

        const wrapper = document.createElement('div');
        wrapper.appendChild(template.content.cloneNode(true));
        return { html: wrapper.innerHTML, inlineImages };
    }

    function attachmentBlock(attachments) {
        if (!attachments?.length) return '';
        const items = attachments.map(item => {
            const url = escapeHtml(item.content_url || '');
            const name = escapeHtml(item.file_name || 'Anexo');
            const size = formatBytes(item.size);
            return `<li>${url ? `<a href="${url}">${name}</a>` : name}${size ? ` (${escapeHtml(size)})` : ''}</li>`;
        }).join('');
        return `<div class="attus-zdexp-attachments"><strong>Anexos:</strong><ul>${items}</ul></div>`;
    }

    function inlineImageBlock(images) {
        if (!images.length) return '';
        const items = images.map(item =>
            `<li><a href="${escapeHtml(item.source)}">${escapeHtml(item.label)}</a></li>`
        ).join('');
        return `<div class="attus-zdexp-inline-images"><strong>Imagens do comentário:</strong><ul>${items}</ul></div>`;
    }

    async function loadTicketDocument(searchTicket, includePrivate) {
        const ticketId = Number(searchTicket.id);
        const ticket = await loadTicket(ticketId);
        const comments = await collectComments(ticketId, includePrivate);
        await populateUsers([
            ticket.requester_id,
            ticket.submitter_id,
            ticket.assignee_id,
            ...comments.map(comment => comment.author_id)
        ]);
        const group = await groupName(ticket.group_id);
        const statusId = asNumber(ticket.custom_status_id);
        const customStatus = statusCache.get(statusId) || (statusId ? `ID ${statusId}` : ticket.status || 'Não informado');
        return { ticket, comments, group, customStatus };
    }

    function buildDocumentElement(documentData) {
        const { ticket, comments, group, customStatus } = documentData;
        const ticketId = Number(ticket.id);
        const subject = ticket.subject || `Ticket ${ticketId}`;
        const ticketUrl = `${BASE}/agent/tickets/${ticketId}`;
        const tags = (ticket.tags || []).join(', ') || 'Nenhuma';

        const commentsHtml = comments.map((comment, index) => {
            const isPublic = Boolean(comment.public);
            const visibility = isPublic ? 'Público' : 'Nota interna';
            const sanitized = sanitizeCommentHtml(comment.html_body || comment.plain_body || comment.body || '');
            return `<section class="attus-zdexp-comment ${isPublic ? 'public' : 'private'}">
                <div class="attus-zdexp-comment-head">
                    <div><strong>${escapeHtml(userLabel(comment.author_id))}</strong></div>
                    <div class="attus-zdexp-meta">
                        <span>${escapeHtml(formatDate(comment.created_at))}</span>
                        <span class="attus-zdexp-badge">${visibility}</span>
                        <span>#${index + 1}</span>
                    </div>
                </div>
                <div class="attus-zdexp-comment-body">${sanitized.html || '<em>Comentário sem conteúdo textual.</em>'}</div>
                ${inlineImageBlock(sanitized.inlineImages)}
                ${attachmentBlock(comment.attachments || [])}
            </section>`;
        }).join('');

        const root = document.createElement('article');
        root.className = 'attus-zdexp-document';
        root.innerHTML = `
            <div class="attus-zdexp-ticket-number">TICKET #${ticketId}</div>
            <h1>${escapeHtml(subject)}</h1>
            <div class="attus-zdexp-summary">
                <div><strong>Status:</strong> ${escapeHtml(customStatus)}</div>
                <div><strong>Grupo:</strong> ${escapeHtml(group)}</div>
                <div><strong>Solicitante:</strong> ${escapeHtml(userLabel(ticket.requester_id))}</div>
                <div><strong>Responsável:</strong> ${escapeHtml(userLabel(ticket.assignee_id))}</div>
                <div><strong>Criado em:</strong> ${escapeHtml(formatDate(ticket.created_at))}</div>
                <div><strong>Atualizado em:</strong> ${escapeHtml(formatDate(ticket.updated_at))}</div>
                <div><strong>Prioridade:</strong> ${escapeHtml(ticket.priority || 'Não informada')}</div>
                <div><strong>Tipo:</strong> ${escapeHtml(ticket.type || 'Não informado')}</div>
                <div class="attus-zdexp-wide"><strong>Tags:</strong> ${escapeHtml(tags)}</div>
                <div class="attus-zdexp-wide"><strong>Fonte:</strong> <a href="${ticketUrl}">${ticketUrl}</a></div>
            </div>
            <div class="attus-zdexp-source-query"><strong>Busca de origem:</strong> ${escapeHtml(SEARCH_QUERY)}</div>
            <h2>Conversa (${comments.length} comentário(s))</h2>
            ${commentsHtml || '<p><em>Nenhum comentário incluído.</em></p>'}
        `;
        document.body.appendChild(root);
        return root;
    }

    async function renderPdfBlob(documentData) {
        const root = buildDocumentElement(documentData);
        try {
            const options = {
                margin: [8, 8, 10, 8],
                image: { type: 'jpeg', quality: 0.94 },
                html2canvas: {
                    scale: 1.45,
                    useCORS: true,
                    allowTaint: false,
                    logging: false,
                    backgroundColor: '#ffffff',
                    windowWidth: 900
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
                pagebreak: {
                    mode: ['css', 'legacy'],
                    avoid: ['.attus-zdexp-summary', '.attus-zdexp-comment-head', '.attus-zdexp-attachments']
                }
            };
            const pdf = await html2pdf().set(options).from(root).toPdf().get('pdf');
            return pdf.output('blob');
        } finally {
            root.remove();
        }
    }

    function csvCell(value) {
        return `"${String(value ?? '').replaceAll('"', '""')}"`;
    }

    function createManifestCsv(rows) {
        const headers = [
            'id', 'assunto', 'status_zendesk', 'custom_status_id', 'grupo',
            'criado_em', 'atualizado_em', 'comentarios', 'url', 'arquivo', 'erro'
        ];
        return '\uFEFF' + [
            headers.map(csvCell).join(';'),
            ...rows.map(row => headers.map(header => csvCell(row[header])).join(';'))
        ].join('\r\n');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function loadState() {
        try {
            const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
            if (state.query !== API_QUERY || typeof state.completed !== 'object') {
                return { query: API_QUERY, completed: {} };
            }
            return state;
        } catch (_) {
            return { query: API_QUERY, completed: {} };
        }
    }

    function saveState(state) {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function clearState() {
        localStorage.removeItem(STATE_KEY);
        log('Progresso anterior apagado. A próxima execução começará do primeiro ticket.');
    }

    function manifestRow(documentData, filename, error = '') {
        const { ticket, comments, group } = documentData;
        return {
            id: ticket.id,
            assunto: ticket.subject || '',
            status_zendesk: ticket.status || '',
            custom_status_id: ticket.custom_status_id || '',
            grupo: group,
            criado_em: ticket.created_at || '',
            atualizado_em: ticket.updated_at || '',
            comentarios: comments.length,
            url: `${BASE}/agent/tickets/${ticket.id}`,
            arquivo: filename,
            erro: error
        };
    }

    async function exportBatch(batch, batchIndex, totalBatches, includePrivate, state) {
        const zip = new JSZip();
        const rows = [];
        const completedThisBatch = [];

        for (let index = 0; index < batch.length; index += 1) {
            if (cancelRequested) break;
            const searchTicket = batch[index];
            const position = batchIndex * batch.length + index + 1;
            log(`Lote ${batchIndex + 1}/${totalBatches}: preparando ticket #${searchTicket.id}...`);
            try {
                const documentData = await loadTicketDocument(searchTicket, includePrivate);
                const filename = `${documentData.ticket.id}-${safeFilename(documentData.ticket.subject)}.pdf`;
                const pdfBlob = await renderPdfBlob(documentData);
                zip.file(filename, pdfBlob);
                const row = manifestRow(documentData, filename);
                rows.push(row);
                completedThisBatch.push({ id: String(documentData.ticket.id), row });
                log(`PDF pronto: #${documentData.ticket.id} (${position}).`);
            } catch (error) {
                rows.push({
                    id: searchTicket.id,
                    assunto: searchTicket.subject || '',
                    status_zendesk: searchTicket.status || '',
                    custom_status_id: searchTicket.custom_status_id || '',
                    grupo: '',
                    criado_em: searchTicket.created_at || '',
                    atualizado_em: searchTicket.updated_at || '',
                    comentarios: '',
                    url: `${BASE}/agent/tickets/${searchTicket.id}`,
                    arquivo: '',
                    erro: error.message
                });
                log(`ERRO no ticket #${searchTicket.id}: ${error.message}`);
            }
            await sleep(REQUEST_DELAY_MS);
        }

        if (!completedThisBatch.length && !rows.length) return;
        zip.file('manifesto.csv', createManifestCsv(rows));
        log(`Compactando lote ${batchIndex + 1}/${totalBatches}...`);
        const zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            metadata => log(`Compactando lote ${batchIndex + 1}: ${metadata.percent.toFixed(0)}%.`)
        );
        const zipName = `zendesk-n2-resolvidos-lote-${String(batchIndex + 1).padStart(3, '0')}-de-${String(totalBatches).padStart(3, '0')}.zip`;
        downloadBlob(zipBlob, zipName);

        for (const item of completedThisBatch) state.completed[item.id] = item.row;
        saveState(state);
        log(`Download iniciado: ${zipName}`);
        await sleep(DOWNLOAD_DELAY_MS);
    }

    async function startExport() {
        if (running) return;
        if (typeof html2pdf !== 'function' || typeof JSZip !== 'function') {
            log('ERRO: as bibliotecas de PDF/ZIP não foram carregadas. Recarregue a página e tente novamente.');
            return;
        }

        running = true;
        cancelRequested = false;
        setRunningUi(true);
        const limit = Math.max(0, Number(document.querySelector('#attus-zdexp-limit').value || 0));
        const batchSize = Math.max(1, Math.min(30, Number(document.querySelector('#attus-zdexp-batch').value || 10)));
        const includePrivate = document.querySelector('#attus-zdexp-private').checked;
        const resume = document.querySelector('#attus-zdexp-resume').checked;

        try {
            log('Validando a sessão existente do Chrome...');
            const expected = await getSearchCount();
            log(`Zendesk informou ${expected ?? '?'} ticket(s) para a busca.`);
            await loadCustomStatuses();
            let tickets = await collectTickets();
            if (cancelRequested) throw new Error('Exportação cancelada durante a busca.');
            if (expected !== null && expected !== tickets.length) {
                log(`Aviso: a contagem mudou durante a coleta (${expected} → ${tickets.length}).`);
            }
            if (limit > 0) tickets = tickets.slice(0, limit);

            const state = loadState();
            if (!resume) state.completed = {};
            const pending = tickets.filter(ticket => !state.completed[String(ticket.id)]);
            const skipped = tickets.length - pending.length;
            log(`${tickets.length} ticket(s) selecionado(s); ${skipped} já concluído(s); ${pending.length} pendente(s).`);

            if (!pending.length) {
                const allRows = Object.values(state.completed);
                if (allRows.length) {
                    downloadBlob(new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }), 'zendesk-n2-resolvidos-manifesto-geral.csv');
                }
                log('Nenhum ticket pendente. Exportação já concluída.');
                return;
            }

            const totalBatches = Math.ceil(pending.length / batchSize);
            const confirmed = window.confirm(
                `Serão exportados ${pending.length} ticket(s) em ${totalBatches} arquivo(s) ZIP.\n\n` +
                'Mantenha esta aba aberta. Se o Chrome perguntar, permita downloads múltiplos para o Zendesk.'
            );
            if (!confirmed) {
                log('Exportação não iniciada pelo usuário.');
                return;
            }

            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
                if (cancelRequested) break;
                const start = batchIndex * batchSize;
                const batch = pending.slice(start, start + batchSize);
                await exportBatch(batch, batchIndex, totalBatches, includePrivate, state);
            }

            const allRows = Object.values(state.completed);
            if (allRows.length) {
                downloadBlob(
                    new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }),
                    'zendesk-n2-resolvidos-manifesto-geral.csv'
                );
            }
            log(cancelRequested
                ? 'Exportação interrompida. Os lotes concluídos foram salvos e podem ser retomados.'
                : `Concluído: ${allRows.length} ticket(s) registrados no progresso.`);
        } catch (error) {
            log(`ERRO: ${error.message}`);
            console.error('[Zendesk N2 PDF]', error);
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
        console.log('[Zendesk N2 PDF]', message);
    }

    function setRunningUi(isRunning) {
        document.querySelector('#attus-zdexp-start').disabled = isRunning;
        document.querySelector('#attus-zdexp-reset').disabled = isRunning;
        document.querySelector('#attus-zdexp-cancel').disabled = !isRunning;
    }

    function createUi() {
        if (document.querySelector('#attus-zdexp-open')) return;
        const openButton = document.createElement('button');
        openButton.id = 'attus-zdexp-open';
        openButton.type = 'button';
        openButton.textContent = 'PDF N2';

        const panel = document.createElement('section');
        panel.id = 'attus-zdexp-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <button id="attus-zdexp-close" type="button" title="Fechar">×</button>
            <h2>Exportar tickets N2</h2>
            <p>Usa a sessão autenticada desta aba do Chrome e gera PDFs em lotes ZIP.</p>
            <div class="attus-zdexp-query">${escapeHtml(SEARCH_QUERY)}</div>
            <div class="attus-zdexp-grid">
                <label>Limite de teste
                    <input id="attus-zdexp-limit" type="number" min="0" step="1" placeholder="0 = todos" value="0">
                </label>
                <label>PDFs por ZIP
                    <input id="attus-zdexp-batch" type="number" min="1" max="30" step="1" value="10">
                </label>
            </div>
            <label class="attus-zdexp-check"><input id="attus-zdexp-private" type="checkbox" checked> Incluir notas internas</label>
            <label class="attus-zdexp-check"><input id="attus-zdexp-resume" type="checkbox" checked> Retomar e pular lotes já concluídos</label>
            <p class="attus-zdexp-note">Para testar, use limite 1. Durante a exportação, mantenha esta aba aberta.</p>
            <div class="attus-zdexp-actions">
                <button id="attus-zdexp-start" class="primary" type="button">Iniciar exportação</button>
                <button id="attus-zdexp-cancel" class="danger" type="button" disabled>Cancelar</button>
                <button id="attus-zdexp-reset" type="button">Apagar progresso</button>
            </div>
            <pre id="attus-zdexp-status">Pronto. Recomenda-se testar primeiro com limite 1.</pre>
        `;

        document.body.append(openButton, panel);
        openButton.addEventListener('click', () => { panel.hidden = !panel.hidden; });
        panel.querySelector('#attus-zdexp-close').addEventListener('click', () => { panel.hidden = true; });
        panel.querySelector('#attus-zdexp-start').addEventListener('click', startExport);
        panel.querySelector('#attus-zdexp-cancel').addEventListener('click', () => {
            cancelRequested = true;
            log('Cancelamento solicitado; finalizando a etapa atual...');
        });
        panel.querySelector('#attus-zdexp-reset').addEventListener('click', () => {
            if (window.confirm('Apagar o progresso salvo desta exportação?')) clearState();
        });
    }

    createUi();
})();

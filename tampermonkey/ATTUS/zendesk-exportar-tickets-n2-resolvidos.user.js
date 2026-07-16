// ==UserScript==
// @name         Zendesk - Extrator de Tickets
// @namespace    https://attus-ai.zendesk.com/
// @version      2026.07.16.07
// @description  Exporta tickets de uma busca editável do Zendesk em PDFs pesquisáveis, gravados diretamente em uma pasta escolhida.
// @author       ATTUS
// @match        https://attus-ai.zendesk.com/agent/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-tickets-n2-resolvidos.user.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@3.0.1/dist/jspdf.umd.min.js
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
    const HANDLE_STORE = 'handles';
    const HANDLE_KEY = 'output-directory';
    const REQUEST_DELAY_MS = 120;
    const DOWNLOAD_DELAY_MS = 1200;
    const MAX_RETRIES = 5;

    const userCache = new Map();
    const groupCache = new Map();
    const statusCache = new Map();
    let cancelRequested = false;
    let running = false;
    let directoryHandle = null;

    GM_addStyle(`
        #attus-zdexp-open {
            position: fixed; right: 476px; top: 7px; z-index: 2147483646;
            border: 0; border-radius: 6px; padding: 9px 13px;
            background: #174ea6; color: #fff; font: 600 13px/1 Arial, sans-serif;
            box-shadow: 0 5px 18px rgba(0,0,0,.28); cursor: pointer;
        }
        #attus-zdexp-open:hover { background: #123d82; }
        #attus-zdexp-panel {
            position: fixed; right: 418px; top: 50px; z-index: 2147483647;
            width: 460px; height: min(650px, calc(100vh - 68px));
            min-width: 330px; min-height: 300px;
            max-width: calc(100vw - 36px); max-height: calc(100vh - 68px);
            overflow: auto; padding: 16px; border: 1px solid #cbd5e1; border-radius: 10px;
            background: #fff; color: #172b4d; font: 13px/1.45 Arial, sans-serif;
            box-shadow: 0 12px 36px rgba(0,0,0,.32); resize: both; box-sizing: border-box;
        }
        #attus-zdexp-panel[hidden] { display: none !important; }
        #attus-zdexp-panel h2 { margin: 0 28px 6px 0; font-size: 17px; }
        #attus-zdexp-panel p { margin: 6px 0; }
        #attus-zdexp-close {
            position: absolute; top: 8px; right: 9px; border: 0; background: transparent;
            color: #52606d; font-size: 23px; cursor: pointer;
        }
        .attus-zdexp-grid { display: grid; grid-template-columns: 1fr; gap: 9px; margin: 10px 0; }
        .attus-zdexp-grid label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
        .attus-zdexp-grid input[type="number"] {
            width: 100%; padding: 7px; border: 1px solid #aebdca; border-radius: 5px;
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

    function parseSearchQuery(query) {
        const tokenValue = (name, fallback) => {
            const pattern = new RegExp(`(?:^|\\s)${name}:("[^"]*"|'[^']*'|\\S+)`, 'i');
            const match = query.match(pattern);
            return match ? match[1].replace(/^["']|["']$/g, '') : fallback;
        };
        const orderBy = tokenValue('order_by', 'updated_at');
        const requestedSort = tokenValue('sort', 'desc').toLowerCase();
        const sort = requestedSort === 'asc' ? 'asc' : 'desc';
        const filterQuery = normalizeQuery(
            query
                .replace(/(?:^|\s)order_by:(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
                .replace(/(?:^|\s)sort:(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
        );
        if (!filterQuery) throw new Error('A query contém apenas opções de ordenação e não possui filtros.');
        return { filterQuery, orderBy, sort };
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

        return [...byId.values()].sort((a, b) => {
            const direction = sort === 'asc' ? 1 : -1;
            const valueOrder = String(a?.[orderBy] ?? '').localeCompare(String(b?.[orderBy] ?? ''));
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

    function toPdfText(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\u2010-\u2015]/g, '-')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/\u2022/g, '-')
            .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
    }

    function htmlToPlainText(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        template.content.querySelectorAll('li').forEach(node => {
            node.prepend(document.createTextNode('- '));
            node.append(document.createTextNode('\n'));
        });
        template.content.querySelectorAll('p, div, pre, blockquote, h1, h2, h3, h4, tr').forEach(node => {
            node.append(document.createTextNode('\n'));
        });
        return toPdfText(template.content.textContent || '')
            .split(/\r?\n/)
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
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

    function csvCell(value) {
        return `"${String(value ?? '').replaceAll('"', '""')}"`;
    }

    function createManifestCsv(rows) {
        const headers = [
            'id', 'assunto', 'status_zendesk', 'custom_status_id', 'grupo',
            'criado_em', 'atualizado_em', 'comentarios', 'url', 'query_origem', 'arquivo', 'erro'
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

    function loadState(query) {
        try {
            const state = JSON.parse(localStorage.getItem(stateKey(query)) || '{}');
            if (state.query !== query || typeof state.completed !== 'object') {
                return { query, completed: {} };
            }
            return state;
        } catch (_) {
            return { query, completed: {} };
        }
    }

    function saveState(query, state) {
        localStorage.setItem(stateKey(query), JSON.stringify(state));
    }

    function clearState(query) {
        localStorage.removeItem(stateKey(query));
        log('Progresso desta query apagado. A próxima execução começará do primeiro ticket.');
    }

    function clearEverything(panel) {
        const keysToRemove = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(STATE_PREFIX)) keysToRemove.push(key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        localStorage.removeItem(LEGACY_QUERY_KEY);
        panel.querySelector('#attus-zdexp-query').value = '';
        panel.querySelector('#attus-zdexp-ticket-list').value = '';
        panel.querySelector('#attus-zdexp-file').value = '';
        panel.querySelector('#attus-zdexp-limit').value = '0';
        panel.querySelector('#attus-zdexp-private').checked = true;
        panel.querySelector('#attus-zdexp-resume').checked = true;
        panel.querySelector('#attus-zdexp-status').textContent = '';
        log(`Tudo limpo: campos e ${keysToRemove.length} progresso(s) salvo(s) foram removidos.`);
    }

    function openHandleDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HANDLE_DB, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
                    request.result.createObjectStore(HANDLE_STORE);
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
        } finally {
            await writable.close();
        }
    }

    function manifestRow(documentData, filename, query, error = '') {
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
            query_origem: query,
            arquivo: filename,
            erro: error
        };
    }

    async function exportTicket(searchTicket, index, total, includePrivate, sourceLabel, progressKey, state, errorRows) {
        log(`Preparando ticket #${searchTicket.id} (${index + 1}/${total})...`);
        try {
            const documentData = await loadTicketDocument(searchTicket, includePrivate);
            const filename = `${documentData.ticket.id}-${safeFilename(documentData.ticket.subject)}.pdf`;
            const pdfBlob = await renderPdfBlob(documentData, sourceLabel);
            const row = manifestRow(documentData, filename, sourceLabel);

            await saveBlobToDirectory(pdfBlob, filename);
            state.completed[String(documentData.ticket.id)] = row;
            saveState(progressKey, state);
            log(`PDF salvo: ${filename} (${index + 1}/${total}).`);
        } catch (error) {
            errorRows.push({
                id: searchTicket.id,
                assunto: searchTicket.subject || '',
                status_zendesk: searchTicket.status || '',
                custom_status_id: searchTicket.custom_status_id || '',
                grupo: '',
                criado_em: searchTicket.created_at || '',
                atualizado_em: searchTicket.updated_at || '',
                comentarios: '',
                url: `${BASE}/agent/tickets/${searchTicket.id}`,
                query_origem: sourceLabel,
                arquivo: '',
                erro: error.message
            });
            log(`ERRO no ticket #${searchTicket.id}: ${error.message}`);
        }
        await sleep(DOWNLOAD_DELAY_MS);
    }

    async function startExport() {
        if (running) return;
        if (typeof (window.jspdf?.jsPDF || window.jsPDF) !== 'function') {
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
        const progressKey = ticketIds.length ? ticketListKey(ticketIds) : query;
        const sourceLabel = ticketIds.length
            ? `Lista direta com ${ticketIds.length} ticket(s)`
            : query;

        running = true;
        cancelRequested = false;
        setRunningUi(true);
        const limit = Math.max(0, Number(document.querySelector('#attus-zdexp-limit').value || 0));
        const includePrivate = document.querySelector('#attus-zdexp-private').checked;
        const resume = document.querySelector('#attus-zdexp-resume').checked;

        try {
            const outputDirectory = await ensureOutputDirectory();
            if (!outputDirectory) throw new Error('Seleção da pasta de saída cancelada.');
            log('Validando a sessão existente do Chrome...');
            await loadCustomStatuses();
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

            const state = loadState(progressKey);
            if (!resume) state.completed = {};
            const pending = tickets.filter(ticket => !state.completed[String(ticket.id)]);
            const skipped = tickets.length - pending.length;
            log(`${tickets.length} ticket(s) selecionado(s); ${skipped} já concluído(s); ${pending.length} pendente(s).`);

            if (!pending.length) {
                const allRows = Object.values(state.completed);
                if (allRows.length) {
                    await saveBlobToDirectory(
                        new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }),
                        `zendesk-tickets-manifesto-${queryId(progressKey)}.csv`
                    );
                }
                log('Nenhum ticket pendente. Exportação já concluída.');
                return;
            }

            log(`Iniciando a gravação de ${pending.length} PDF(s) em "${outputDirectory.name}" sem perguntas por arquivo.`);

            const errorRows = [];
            for (let index = 0; index < pending.length; index += 1) {
                if (cancelRequested) break;
                await exportTicket(
                    pending[index], index, pending.length, includePrivate,
                    sourceLabel, progressKey, state, errorRows
                );
            }

            const allRows = [...Object.values(state.completed), ...errorRows];
            if (allRows.length) {
                await saveBlobToDirectory(
                    new Blob([createManifestCsv(allRows)], { type: 'text/csv;charset=utf-8' }),
                    `zendesk-tickets-manifesto-${queryId(progressKey)}.csv`
                );
            }
            log(cancelRequested
                ? 'Exportação interrompida. Os PDFs concluídos foram salvos e podem ser retomados.'
                : `Concluído: ${allRows.length} ticket(s) registrados no progresso.`);
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
            <p>Gera PDFs pesquisáveis usando uma query ou uma lista direta de tickets.</p>
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
            </div>
            <label class="attus-zdexp-check"><input id="attus-zdexp-private" type="checkbox" checked> Incluir notas internas</label>
            <label class="attus-zdexp-check"><input id="attus-zdexp-resume" type="checkbox" checked> Retomar e pular PDFs já concluídos</label>
            <p id="attus-zdexp-folder">Nenhuma pasta selecionada.</p>
            <p class="attus-zdexp-note">Quando houver uma lista, ela terá prioridade e a query será ignorada. Arraste a borda inferior direita para redimensionar esta janela.</p>
            <div class="attus-zdexp-actions">
                <button id="attus-zdexp-select-folder" type="button">Selecionar pasta</button>
                <button id="attus-zdexp-start" class="primary" type="button">Iniciar exportação</button>
                <button id="attus-zdexp-cancel" class="danger" type="button" disabled>Cancelar</button>
                <button id="attus-zdexp-reset" type="button">Apagar progresso desta query</button>
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
        panel.querySelector('#attus-zdexp-reset').addEventListener('click', () => {
            const query = normalizeQuery(panel.querySelector('#attus-zdexp-query').value);
            const ticketListText = panel.querySelector('#attus-zdexp-ticket-list').value.trim();
            const ticketIds = parseTicketIds(ticketListText);
            if (ticketListText && !ticketIds.length) {
                log('ERRO: a lista não contém tickets válidos.');
                return;
            }
            const progressKey = ticketIds.length ? ticketListKey(ticketIds) : query;
            if (!progressKey) {
                log('ERRO: informe a query ou lista cujo progresso deve ser apagado.');
                return;
            }
            if (window.confirm('Apagar o progresso salvo desta extração?')) clearState(progressKey);
        });
        panel.querySelector('#attus-zdexp-clear-all').addEventListener('click', () => {
            clearEverything(panel);
        });
        restoreDirectoryHandle();
    }

    createUi();
})();

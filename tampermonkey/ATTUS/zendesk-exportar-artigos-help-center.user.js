// ==UserScript==
// @name         Zendesk - Exportar Artigos do Help Center
// @namespace    https://attus-ai.zendesk.com/
// @version      2026.07.30.01
// @description  Exporta todos os artigos visíveis do Zendesk Help Center para PDFs pesquisáveis, organizados por categoria e seção.
// @author       ATTUS
// @match        https://attus-ai.zendesk.com/agent/*
// @match        https://attus-ai.zendesk.com/hc/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-artigos-help-center.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/zendesk-exportar-artigos-help-center.user.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@3.0.1/dist/jspdf.umd.min.js#sha256=7ad0aa5df9942f843759f06fcb7f1ff41cf2e6b3feb9a51e048f4c56531f73a2
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const BASE = 'https://attus-ai.zendesk.com';
    const DEFAULT_LOCALE = 'pt-br';
    const REQUEST_DELAY_MS = 180;
    const MAX_RETRIES = 5;
    const RATE_LIMIT_RESERVE = 10;
    const HANDLE_DB = 'attus-zendesk-help-center-export';
    const HANDLE_DB_VERSION = 1;
    const HANDLE_STORE = 'handles';
    const HANDLE_KEY = 'output-directory';

    let running = false;
    let cancelRequested = false;
    let directoryHandle = null;
    let apiPauseUntil = 0;

    GM_addStyle(`
        #attus-zdhc-open {
            position: fixed; right: 500px; top: 7px; z-index: 2147483646;
            border: 0; border-radius: 6px; padding: 9px 13px;
            background: #176b52; color: #fff; font: 600 13px/1 Arial, sans-serif;
            box-shadow: 0 5px 18px rgba(0,0,0,.28); cursor: pointer;
        }
        #attus-zdhc-open:hover { background: #105440; }
        #attus-zdhc-panel {
            position: fixed; right: 450px; top: 50px; z-index: 2147483647;
            width: 450px; height: min(610px, calc(100vh - 68px));
            min-width: 330px; min-height: 300px;
            max-width: calc(100vw - 36px); max-height: calc(100vh - 68px);
            overflow: auto; padding: 16px; border: 1px solid #cbd5e1; border-radius: 10px;
            background: #fff; color: #172b4d; font: 13px/1.45 Arial, sans-serif;
            box-shadow: 0 12px 36px rgba(0,0,0,.32); resize: both; box-sizing: border-box;
        }
        #attus-zdhc-panel[hidden] { display: none !important; }
        @media (max-width: 1120px) {
            #attus-zdhc-open { right: 180px; }
            #attus-zdhc-panel { right: 18px; }
        }
        #attus-zdhc-panel h2 { margin: 0 28px 6px 0; font-size: 17px; }
        #attus-zdhc-panel p { margin: 6px 0; }
        #attus-zdhc-close {
            position: absolute; top: 8px; right: 9px; border: 0; background: transparent;
            color: #52606d; font-size: 23px; cursor: pointer;
        }
        .attus-zdhc-grid { display: grid; grid-template-columns: 1fr; gap: 9px; margin: 10px 0; }
        .attus-zdhc-grid label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
        .attus-zdhc-grid input, .attus-zdhc-grid select {
            width: 100%; padding: 7px; border: 1px solid #aebdca; border-radius: 5px;
            background: #fff; color: #172b4d; box-sizing: border-box;
        }
        .attus-zdhc-check { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
        .attus-zdhc-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
        .attus-zdhc-actions button {
            border: 1px solid #aebdca; border-radius: 5px; padding: 8px 10px;
            background: #fff; color: #243b53; font-weight: 600; cursor: pointer;
        }
        .attus-zdhc-actions button.primary { border-color: #176b52; background: #176b52; color: #fff; }
        .attus-zdhc-actions button.danger { border-color: #c53030; color: #c53030; }
        .attus-zdhc-actions button:disabled { opacity: .5; cursor: not-allowed; }
        #attus-zdhc-folder { margin-top: 2px; color: #334e68; font-size: 11px; overflow-wrap: anywhere; }
        #attus-zdhc-status {
            min-height: 90px; max-height: 205px; overflow: auto; margin: 12px 0 0;
            padding: 9px; border-radius: 5px; background: #102a43; color: #e6f0f8;
            white-space: pre-wrap; font: 11px/1.45 Consolas, monospace;
        }
        .attus-zdhc-note { color: #52606d; font-size: 11px; }
    `);

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function checkCancelled() {
        if (cancelRequested) throw new Error('EXPORT_CANCELLED');
    }

    function safeFilename(value, maxLength = 125) {
        const clean = String(value || 'sem-titulo')
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, maxLength)
            .replace(/[. -]+$/g, '');
        const result = clean || 'sem-titulo';
        return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result) ? `_${result}` : result;
    }

    function formatDate(value) {
        if (!value) return 'Não informado';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'America/Sao_Paulo'
        }).format(date);
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

    function apiUrl(path, params = {}) {
        const url = new URL(path, BASE);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    function validatedApiUrl(value) {
        const url = new URL(value, BASE);
        if (url.origin !== BASE || !url.pathname.startsWith('/api/v2/help_center/')) {
            throw new Error(`A API retornou uma URL de paginação inesperada: ${url}.`);
        }
        return url.toString();
    }

    function apiError(message, status, url) {
        const error = new Error(message);
        error.httpStatus = status;
        error.url = url;
        return error;
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
        if (remaining > 0) await sleep(remaining);
        apiPauseUntil = 0;
    }

    function monitorRateLimit(response) {
        const remainingHeader = response.headers.get('ratelimit-remaining')
            ?? response.headers.get('x-rate-limit-remaining');
        const resetHeader = response.headers.get('ratelimit-reset');
        const remaining = remainingHeader !== null ? Number(remainingHeader) : Number.NaN;
        const reset = resetHeader !== null ? Number(resetHeader) : Number.NaN;
        if (Number.isFinite(remaining) && remaining <= RATE_LIMIT_RESERVE && Number.isFinite(reset)) {
            pauseApiRequests(reset + 1, `Limite da API próximo do fim (${remaining} restante(s))`);
        }
    }

    async function fetchJson(url) {
        const requestUrl = validatedApiUrl(url);
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
            checkCancelled();
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
                    log(`${lastError}; nova tentativa em ${seconds}s.`);
                    await sleep(seconds * 1000);
                    continue;
                }
                throw apiError(`A API não pôde ser acessada após ${MAX_RETRIES} tentativas.`, null, requestUrl);
            }

            monitorRateLimit(response);
            if (response.status === 401 || response.status === 403) {
                throw apiError(
                    `A sessão desta aba não tem acesso ao Help Center (HTTP ${response.status}). `
                    + `Abra ${BASE}/hc/${DEFAULT_LOCALE}, conclua o login e tente novamente.`,
                    response.status,
                    requestUrl
                );
            }
            if (!response.ok) {
                const responseText = await response.text();
                const retryable = response.status === 429 || response.status >= 500;
                lastError = `HTTP ${response.status}: ${responseText.slice(0, 350)}`;
                if (retryable && attempt < MAX_RETRIES) {
                    const seconds = secondsFromHeader(
                        response.headers.get('retry-after'),
                        Math.min(2 ** (attempt - 1), 20)
                    );
                    if (response.status === 429) pauseApiRequests(seconds, 'Zendesk respondeu HTTP 429');
                    else await sleep(seconds * 1000);
                    continue;
                }
                throw apiError(`Falha na API do Zendesk. ${lastError}`, response.status, requestUrl);
            }

            const payload = await response.json();
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw apiError('A API retornou um conteúdo inesperado.', response.status, requestUrl);
            }
            return payload;
        }
        throw apiError(`Falha na API do Zendesk. ${lastError}`, null, requestUrl);
    }

    async function validateSession(locale) {
        await fetchJson(apiUrl(`/api/v2/help_center/${locale}/articles.json`, { per_page: 1 }));
    }

    async function fetchFullArticle(locale, articleId) {
        const payload = await fetchJson(
            apiUrl(`/api/v2/help_center/${locale}/articles/${articleId}.json`)
        );
        return payload.article || {};
    }

    async function collectArticles(locale) {
        let url = apiUrl(`/api/v2/help_center/${locale}/articles.json`, {
            per_page: 100,
            sort_by: 'title',
            sort_order: 'asc',
            include: 'sections,categories'
        });
        const articles = [];
        const sections = new Map();
        const categories = new Map();
        const seenPages = new Set();
        const seenIds = new Set();

        while (url) {
            checkCancelled();
            if (seenPages.has(url)) throw new Error(`A paginação repetiu a URL ${url}.`);
            seenPages.add(url);
            const payload = await fetchJson(url);

            for (const section of payload.sections || []) {
                if (section?.id !== undefined) sections.set(Number(section.id), section);
            }
            for (const category of payload.categories || []) {
                if (category?.id !== undefined) categories.set(Number(category.id), category);
            }
            for (const article of payload.articles || []) {
                const id = Number(article?.id);
                if (!Number.isFinite(id) || seenIds.has(id)) continue;
                seenIds.add(id);
                articles.push(article);
            }

            log(`${articles.length} artigo(s) visível(is) localizado(s)...`);
            const nextPage = payload.next_page || payload.links?.next;
            url = nextPage ? validatedApiUrl(nextPage) : '';
        }

        const normalized = [];
        for (let index = 0; index < articles.length; index += 1) {
            checkCancelled();
            let article = articles[index];
            if (!article.body) {
                log(`Carregando conteúdo completo ${index + 1}/${articles.length}: ${article.id}.`);
                article = { ...article, ...await fetchFullArticle(locale, article.id) };
                await sleep(REQUEST_DELAY_MS);
            }
            const section = sections.get(Number(article.section_id)) || {};
            const category = categories.get(Number(section.category_id)) || {};
            normalized.push({
                id: Number(article.id),
                title: String(article.title || `Artigo ${article.id}`).trim(),
                htmlUrl: String(article.html_url || `${BASE}/hc/${locale}/articles/${article.id}`),
                body: String(article.body || ''),
                updatedAt: String(article.updated_at || ''),
                category: String(category.name || 'Sem categoria'),
                section: String(section.name || 'Sem seção')
            });
        }

        normalized.sort((left, right) =>
            left.category.localeCompare(right.category, 'pt-BR')
            || left.section.localeCompare(right.section, 'pt-BR')
            || left.title.localeCompare(right.title, 'pt-BR')
        );
        return normalized;
    }

    function safeHttpUrl(value, base = BASE) {
        try {
            const url = new URL(value, base);
            return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
        } catch (_) {
            return '';
        }
    }

    function normalizedElementText(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach(node => node.remove());
        clone.querySelectorAll('a[href]').forEach(anchor => {
            const href = safeHttpUrl(anchor.getAttribute('href'));
            if (href && !String(anchor.textContent || '').includes(href)) {
                anchor.append(document.createTextNode(` (${href})`));
            }
        });
        clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        return String(clone.textContent || '')
            .replace(/\u00a0/g, ' ')
            .split(/\r?\n/)
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    function articleBlocks(body) {
        const root = document.createElement('div');
        root.innerHTML = String(body || '');
        root.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach(node => node.remove());
        const selector = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr,img';
        const elements = [...root.querySelectorAll(selector)];
        const blocks = [];

        for (const element of elements) {
            if (element.tagName === 'IMG') {
                const source = safeHttpUrl(element.getAttribute('src'));
                if (source) {
                    blocks.push({
                        type: 'image',
                        source,
                        alt: String(element.getAttribute('alt') || 'Imagem do artigo').trim()
                    });
                }
                continue;
            }

            const selectedParent = element.parentElement?.closest(selector);
            if (selectedParent && selectedParent !== element && selectedParent.tagName !== 'IMG') continue;
            const text = normalizedElementText(element);
            if (!text) continue;
            const tag = element.tagName.toLowerCase();
            if (/^h[1-6]$/.test(tag)) {
                blocks.push({ type: 'heading', level: Number(tag.slice(1)), text });
            } else if (tag === 'li') {
                blocks.push({ type: 'list', text });
            } else if (tag === 'pre') {
                blocks.push({ type: 'pre', text });
            } else if (tag === 'blockquote') {
                blocks.push({ type: 'quote', text });
            } else if (tag === 'tr') {
                const cells = [...element.querySelectorAll(':scope > th, :scope > td')]
                    .map(cell => normalizedElementText(cell))
                    .filter(Boolean);
                if (cells.length) blocks.push({ type: 'table', text: cells.join(' | ') });
            } else {
                blocks.push({ type: 'paragraph', text });
            }
        }

        if (!blocks.some(block => block.type !== 'image')) {
            const fallback = normalizedElementText(root);
            if (fallback) blocks.unshift({ type: 'paragraph', text: fallback });
        }
        return blocks;
    }

    function imageBlobToAsset(blob) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
                try {
                    const maxPixels = 1800;
                    const scale = Math.min(1, maxPixels / Math.max(image.naturalWidth, image.naturalHeight));
                    const width = Math.max(1, Math.round(image.naturalWidth * scale));
                    const height = Math.max(1, Math.round(image.naturalHeight * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext('2d', { alpha: false });
                    context.fillStyle = '#ffffff';
                    context.fillRect(0, 0, width, height);
                    context.drawImage(image, 0, 0, width, height);
                    resolve({
                        dataUrl: canvas.toDataURL('image/jpeg', 0.88),
                        width,
                        height
                    });
                } catch (error) {
                    reject(error);
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Formato de imagem não suportado.'));
            };
            image.src = objectUrl;
        });
    }

    async function fetchImageAsset(source) {
        const url = safeHttpUrl(source);
        if (!url) throw new Error('URL de imagem inválida.');
        const response = await fetch(url, {
            method: 'GET',
            credentials: new URL(url).origin === BASE ? 'include' : 'omit'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}.`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`Tipo ${blob.type || 'desconhecido'}.`);
        return imageBlobToAsset(blob);
    }

    async function renderArticlePdf(article) {
        const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
        if (typeof JsPdf !== 'function') throw new Error('A biblioteca jsPDF não foi carregada.');

        const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        doc.setProperties({
            title: toPdfText(article.title),
            subject: toPdfText(`Artigo ${article.id} do Zendesk Help Center`),
            author: 'Zendesk - Exportador de Artigos do Help Center'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = { top: 15, right: 15, bottom: 17, left: 15 };
        const contentWidth = pageWidth - margin.left - margin.right;
        let y = margin.top;
        let embeddedImages = 0;
        let failedImages = 0;

        const addPage = () => {
            doc.addPage();
            y = margin.top;
        };
        const ensureSpace = height => {
            if (y + height > pageHeight - margin.bottom) addPage();
        };
        const writeWrapped = (text, options = {}) => {
            const size = options.size || 10.5;
            const lineHeight = options.lineHeight || size * 0.43;
            const indent = options.indent || 0;
            const after = options.after ?? 2.4;
            const width = contentWidth - indent;
            doc.setFont('helvetica', options.style || 'normal');
            doc.setFontSize(size);
            doc.setTextColor(...(options.color || [23, 43, 77]));
            const paragraphs = toPdfText(text).split(/\n+/).filter(Boolean);
            for (const paragraph of paragraphs) {
                const lines = doc.splitTextToSize(paragraph, width);
                for (const line of lines) {
                    ensureSpace(lineHeight + 1);
                    doc.text(line, margin.left + indent, y);
                    y += lineHeight;
                }
            }
            y += after;
        };

        writeWrapped(article.title, {
            size: 20,
            style: 'bold',
            color: [16, 42, 67],
            lineHeight: 8,
            after: 5
        });

        ensureSpace(28);
        doc.setFillColor(244, 247, 250);
        doc.setDrawColor(47, 111, 173);
        doc.rect(margin.left, y, contentWidth, 25, 'FD');
        const metaY = y;
        y += 5;
        writeWrapped(`Categoria: ${article.category} > Seção: ${article.section}`, {
            size: 8.5, style: 'bold', indent: 3, lineHeight: 3.8, after: 1
        });
        writeWrapped(`Atualizado em: ${formatDate(article.updatedAt)}`, {
            size: 8.2, indent: 3, lineHeight: 3.6, after: 1
        });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(18, 89, 167);
        doc.textWithLink('Abrir artigo original no Zendesk', margin.left + 3, Math.min(y, metaY + 21), {
            url: article.htmlUrl
        });
        y = metaY + 31;

        const blocks = articleBlocks(article.body);
        for (const block of blocks) {
            checkCancelled();
            if (block.type === 'image') {
                try {
                    const asset = await fetchImageAsset(block.source);
                    const ratio = asset.height / asset.width;
                    let imageWidth = Math.min(contentWidth, 165);
                    let imageHeight = imageWidth * ratio;
                    if (imageHeight > 115) {
                        imageHeight = 115;
                        imageWidth = imageHeight / ratio;
                    }
                    ensureSpace(imageHeight + 9);
                    doc.addImage(asset.dataUrl, 'JPEG', margin.left, y, imageWidth, imageHeight, undefined, 'FAST');
                    y += imageHeight + 2;
                    if (block.alt) writeWrapped(block.alt, {
                        size: 7.5, color: [82, 96, 109], after: 2
                    });
                    embeddedImages += 1;
                } catch (error) {
                    failedImages += 1;
                    writeWrapped(`[Imagem não incorporada: ${block.alt}] ${block.source}`, {
                        size: 8,
                        color: [145, 55, 55],
                        after: 2
                    });
                }
                continue;
            }
            if (block.type === 'heading') {
                const level = Math.min(6, Math.max(1, block.level));
                writeWrapped(block.text, {
                    size: Math.max(11, 17 - level),
                    style: 'bold',
                    color: [22, 50, 79],
                    lineHeight: Math.max(5, 7.1 - level * 0.35),
                    after: 2.6
                });
            } else if (block.type === 'list') {
                writeWrapped(`- ${block.text}`, { indent: 4, after: 1.2 });
            } else if (block.type === 'pre') {
                writeWrapped(block.text, {
                    size: 8.5,
                    color: [42, 53, 66],
                    indent: 3,
                    lineHeight: 3.8,
                    after: 2.5
                });
            } else if (block.type === 'quote') {
                writeWrapped(block.text, {
                    style: 'italic',
                    color: [65, 81, 98],
                    indent: 5,
                    after: 2.5
                });
            } else if (block.type === 'table') {
                writeWrapped(block.text, {
                    size: 8.5,
                    color: [35, 57, 79],
                    lineHeight: 3.8,
                    after: 1.2
                });
            } else {
                writeWrapped(block.text);
            }
        }

        const totalPages = doc.getNumberOfPages();
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            doc.setPage(pageNumber);
            doc.setDrawColor(216, 224, 232);
            doc.line(margin.left, pageHeight - 11, pageWidth - margin.right, pageHeight - 11);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(82, 96, 109);
            doc.text(toPdfText(`Artigo ${article.id}`), margin.left, pageHeight - 6.5);
            doc.text(
                `Página ${pageNumber} de ${totalPages}`,
                pageWidth - margin.right,
                pageHeight - 6.5,
                { align: 'right' }
            );
        }

        return {
            blob: doc.output('blob'),
            imagesTotal: blocks.filter(block => block.type === 'image').length,
            imagesEmbedded: embeddedImages,
            imagesFailed: failedImages
        };
    }

    function openHandleDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HANDLE_DB, HANDLE_DB_VERSION);
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
        const label = document.querySelector('#attus-zdhc-folder');
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
                id: 'attus-zendesk-help-center-export',
                mode: 'readwrite',
                startIn: 'downloads'
            });
            try {
                await persistDirectoryHandle(directoryHandle);
            } catch (error) {
                log(`Aviso: a pasta será usada nesta execução, mas não pôde ser lembrada pelo navegador: ${error.message}`);
            }
            updateFolderLabel();
            log(`Pasta selecionada: ${directoryHandle.name}.`);
            return directoryHandle;
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            throw error;
        }
    }

    async function ensureOutputDirectory() {
        if (directoryHandle) {
            const permission = { mode: 'readwrite' };
            if (await directoryHandle.queryPermission(permission) === 'granted') return directoryHandle;
            if (await directoryHandle.requestPermission(permission) === 'granted') return directoryHandle;
        }
        return selectOutputDirectory();
    }

    async function getSubdirectory(parent, name) {
        return parent.getDirectoryHandle(safeFilename(name, 100), { create: true });
    }

    async function fileExists(directory, filename) {
        try {
            await directory.getFileHandle(filename, { create: false });
            return true;
        } catch (error) {
            if (error?.name === 'NotFoundError') return false;
            throw error;
        }
    }

    async function writeFile(directory, filename, content) {
        const fileHandle = await directory.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(content);
            await writable.close();
        } catch (error) {
            try { await writable.abort(); } catch (_) { /* gravação já encerrada */ }
            throw error;
        }
    }

    function csvCell(value) {
        const text = String(value ?? '');
        return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function createManifestCsv(rows) {
        const fields = [
            'id', 'titulo', 'categoria', 'secao', 'url', 'atualizado_em',
            'status', 'arquivo', 'imagens_total', 'imagens_incorporadas', 'erro'
        ];
        return `\uFEFF${[
            fields.join(';'),
            ...rows.map(row => fields.map(field => csvCell(row[field])).join(';'))
        ].join('\r\n')}\r\n`;
    }

    function articleFilename(article) {
        return `${article.id}-${safeFilename(article.title)}.pdf`;
    }

    async function startExport() {
        if (running) return;
        if (typeof (window.jspdf?.jsPDF || window.jsPDF) !== 'function') {
            log('ERRO: a biblioteca de PDF não foi carregada. Recarregue a página e tente novamente.');
            return;
        }

        const locale = String(document.querySelector('#attus-zdhc-locale').value || DEFAULT_LOCALE)
            .trim()
            .toLowerCase();
        if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(locale)) {
            log('ERRO: informe um idioma válido, por exemplo pt-br.');
            return;
        }
        const limit = Math.max(0, Math.floor(Number(document.querySelector('#attus-zdhc-limit').value || 0)));
        const overwrite = document.querySelector('#attus-zdhc-overwrite').checked;

        running = true;
        cancelRequested = false;
        setRunningUi(true);
        try {
            const selectedDirectory = await ensureOutputDirectory();
            if (!selectedDirectory) throw new Error('Seleção da pasta de saída cancelada.');

            log('Validando a sessão existente do Chrome no Zendesk...');
            await validateSession(locale);
            log(`Sessão válida. Coletando todos os artigos visíveis em ${locale}...`);
            let articles = await collectArticles(locale);
            if (limit > 0) articles = articles.slice(0, limit);
            if (!articles.length) throw new Error('Nenhum artigo visível foi retornado pela API.');

            const outputRoot = await getSubdirectory(selectedDirectory, `Zendesk-Help-Center-${locale}-PDF`);
            const manifestRows = [];
            let exported = 0;
            let skipped = 0;
            let failed = 0;
            let imageWarnings = 0;

            log(`${articles.length} artigo(s) selecionado(s). Iniciando os PDFs...`);
            for (let index = 0; index < articles.length; index += 1) {
                checkCancelled();
                const article = articles[index];
                const categoryDirectory = await getSubdirectory(outputRoot, article.category);
                const sectionDirectory = await getSubdirectory(categoryDirectory, article.section);
                const filename = articleFilename(article);
                const relativePath = `${safeFilename(article.category, 100)}/${safeFilename(article.section, 100)}/${filename}`;
                const row = {
                    id: article.id,
                    titulo: article.title,
                    categoria: article.category,
                    secao: article.section,
                    url: article.htmlUrl,
                    atualizado_em: article.updatedAt,
                    status: '',
                    arquivo: relativePath,
                    imagens_total: 0,
                    imagens_incorporadas: 0,
                    erro: ''
                };

                try {
                    if (!overwrite && await fileExists(sectionDirectory, filename)) {
                        skipped += 1;
                        row.status = 'PULADO_JA_EXISTE';
                        log(`[PULADO] ${index + 1}/${articles.length} - ${article.title}`);
                    } else {
                        const rendered = await renderArticlePdf(article);
                        await writeFile(sectionDirectory, filename, rendered.blob);
                        exported += 1;
                        imageWarnings += rendered.imagesFailed;
                        row.status = rendered.imagesFailed ? 'OK_COM_AVISO_DE_IMAGEM' : 'OK';
                        row.imagens_total = rendered.imagesTotal;
                        row.imagens_incorporadas = rendered.imagesEmbedded;
                        log(
                            `[OK] ${index + 1}/${articles.length} - ${article.title}`
                            + (rendered.imagesFailed ? ` (${rendered.imagesFailed} imagem(ns) não incorporada(s))` : '')
                        );
                    }
                } catch (error) {
                    if (error?.message === 'EXPORT_CANCELLED') throw error;
                    failed += 1;
                    row.status = 'ERRO';
                    row.erro = String(error?.message || error);
                    log(`[ERRO] ${index + 1}/${articles.length} - ${article.title}: ${row.erro}`);
                }

                manifestRows.push(row);
                await writeFile(
                    outputRoot,
                    'manifesto.csv',
                    new Blob([createManifestCsv(manifestRows)], { type: 'text/csv;charset=utf-8' })
                );
                await sleep(REQUEST_DELAY_MS);
            }

            log(
                `Concluído: ${exported} PDF(s) gerado(s), ${skipped} já existente(s), `
                + `${failed} erro(s) e ${imageWarnings} aviso(s) de imagem.`
            );
            log(`Manifesto salvo em Zendesk-Help-Center-${locale}-PDF/manifesto.csv.`);
        } catch (error) {
            if (error?.message === 'EXPORT_CANCELLED') {
                log('Exportação cancelada. Os PDFs concluídos e o manifesto parcial foram mantidos.');
            } else {
                log(`ERRO: ${error?.message || error}`);
                console.error('[Zendesk Help Center Export]', error);
            }
        } finally {
            running = false;
            setRunningUi(false);
        }
    }

    function log(message) {
        const status = document.querySelector('#attus-zdhc-status');
        const timestamp = new Date().toLocaleTimeString('pt-BR');
        if (status) {
            status.textContent += `${status.textContent ? '\n' : ''}[${timestamp}] ${message}`;
            status.scrollTop = status.scrollHeight;
        }
        console.log('[Zendesk Help Center Export]', message);
    }

    function setRunningUi(isRunning) {
        document.querySelector('#attus-zdhc-start').disabled = isRunning;
        document.querySelector('#attus-zdhc-select-folder').disabled = isRunning;
        document.querySelector('#attus-zdhc-locale').disabled = isRunning;
        document.querySelector('#attus-zdhc-limit').disabled = isRunning;
        document.querySelector('#attus-zdhc-overwrite').disabled = isRunning;
        document.querySelector('#attus-zdhc-cancel').disabled = !isRunning;
    }

    function createUi() {
        if (document.querySelector('#attus-zdhc-open')) return;
        const openButton = document.createElement('button');
        openButton.id = 'attus-zdhc-open';
        openButton.type = 'button';
        openButton.textContent = 'Exportar Artigos';

        const panel = document.createElement('section');
        panel.id = 'attus-zdhc-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <button id="attus-zdhc-close" type="button" title="Fechar">×</button>
            <h2>Exportar artigos do Help Center</h2>
            <p>Gera um PDF pesquisável para cada artigo visível na sessão atual do Zendesk.</p>
            <div class="attus-zdhc-grid">
                <label>Idioma do Help Center
                    <input id="attus-zdhc-locale" type="text" value="${DEFAULT_LOCALE}" maxlength="12" spellcheck="false">
                </label>
                <label>Limite de teste
                    <input id="attus-zdhc-limit" type="number" min="0" step="1" value="0" placeholder="0 = todos">
                </label>
            </div>
            <label class="attus-zdhc-check">
                <input id="attus-zdhc-overwrite" type="checkbox">
                Sobrescrever PDFs que já existem
            </label>
            <p id="attus-zdhc-folder">Nenhuma pasta selecionada.</p>
            <p class="attus-zdhc-note">
                A saída será organizada em categoria/seção e terá um manifesto CSV.
                PDFs já existentes são pulados por padrão, permitindo retomar a exportação.
                Recomenda-se testar primeiro com limite 1.
            </p>
            <div class="attus-zdhc-actions">
                <button id="attus-zdhc-select-folder" type="button">Selecionar pasta</button>
                <button id="attus-zdhc-start" class="primary" type="button">Iniciar exportação</button>
                <button id="attus-zdhc-cancel" class="danger" type="button" disabled>Cancelar</button>
            </div>
            <pre id="attus-zdhc-status">Pronto. O script usará a autenticação desta aba do Zendesk.</pre>
        `;

        document.body.append(openButton, panel);
        openButton.addEventListener('click', () => { panel.hidden = !panel.hidden; });
        panel.querySelector('#attus-zdhc-close').addEventListener('click', () => { panel.hidden = true; });
        panel.querySelector('#attus-zdhc-select-folder').addEventListener('click', async () => {
            try { await selectOutputDirectory(); } catch (error) { log(`ERRO: ${error.message}`); }
        });
        panel.querySelector('#attus-zdhc-start').addEventListener('click', startExport);
        panel.querySelector('#attus-zdhc-cancel').addEventListener('click', () => {
            cancelRequested = true;
            log('Cancelamento solicitado; finalizando a etapa atual...');
        });
        restoreDirectoryHandle();
    }

    createUi();
})();

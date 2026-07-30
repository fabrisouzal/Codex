// ==UserScript==
// @name         YouTrack ATT - Exportar Artigos
// @namespace    https://youtrack.attus.ai/
// @version      2026.07.29.02
// @description  Exporta todos os artigos acessiveis de um projeto do YouTrack para arquivos Markdown ou PDF e baixa seus anexos.
// @author       ATTUS
// @match        https://youtrack.attus.ai/articles/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/youtrack-exportar-artigos-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/youtrack-exportar-artigos-markdown.user.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@3.0.1/dist/jspdf.umd.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_PROJECT = 'ATT';
    const DEFAULT_WORKERS = 4;
    const MAX_WORKERS = 8;
    const PAGE_SIZE = 100;
    const REQUEST_DELAY_MS = 80;
    const MAX_REQUEST_RETRIES = 4;
    const MAX_ARTICLES = 20000;

    let running = false;
    let cancelRequested = false;
    let activeToken = '';

    GM_addStyle(`
        #attus-ytmd-open {
            position: fixed; right: 18px; top: 58px; z-index: 2147483646;
            border: 0; border-radius: 6px; padding: 9px 13px;
            background: #174ea6; color: #fff; font: 600 13px/1 Arial, sans-serif;
            box-shadow: 0 5px 18px rgba(0,0,0,.25); cursor: pointer;
        }
        #attus-ytmd-open:hover { background: #123d82; }
        #attus-ytmd-panel {
            position: fixed; right: 18px; top: 102px; z-index: 2147483647;
            width: 440px; max-width: calc(100vw - 36px); max-height: calc(100vh - 120px);
            overflow: auto; padding: 16px; border: 1px solid #cbd5e1; border-radius: 10px;
            background: #fff; color: #172b4d; font: 13px/1.45 Arial, sans-serif;
            box-shadow: 0 12px 36px rgba(0,0,0,.32); box-sizing: border-box;
        }
        #attus-ytmd-panel[hidden] { display: none !important; }
        #attus-ytmd-panel h2 { margin: 0 28px 5px 0; font-size: 17px; }
        #attus-ytmd-panel p { margin: 5px 0; }
        #attus-ytmd-close {
            position: absolute; top: 7px; right: 9px; border: 0; background: transparent;
            color: #52606d; font-size: 23px; cursor: pointer;
        }
        #attus-ytmd-panel label.field {
            display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-weight: 600;
        }
        #attus-ytmd-project, #attus-ytmd-token, #attus-ytmd-format, #attus-ytmd-workers {
            padding: 8px; border: 1px solid #aebdca; border-radius: 5px; font: inherit;
            background: #fff; color: #172b4d;
        }
        #attus-ytmd-project {
            text-transform: uppercase;
        }
        .attus-ytmd-check { display: flex; align-items: center; gap: 7px; margin: 10px 0; }
        .attus-ytmd-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
        .attus-ytmd-actions button {
            border: 1px solid #aebdca; border-radius: 5px; padding: 8px 10px;
            background: #fff; color: #243b53; font-weight: 600; cursor: pointer;
        }
        .attus-ytmd-actions button.primary { border-color: #174ea6; background: #174ea6; color: #fff; }
        .attus-ytmd-actions button.danger { border-color: #c53030; color: #c53030; }
        .attus-ytmd-actions button:disabled { opacity: .5; cursor: not-allowed; }
        #attus-ytmd-status {
            min-height: 84px; max-height: 230px; overflow: auto; margin: 12px 0 0;
            padding: 9px; border-radius: 5px; background: #102a43; color: #e6f0f8;
            white-space: pre-wrap; font: 11px/1.45 Consolas, monospace;
        }
        .attus-ytmd-note { color: #52606d; font-size: 11px; }
    `);

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function log(message) {
        const status = document.getElementById('attus-ytmd-status');
        if (!status) return;
        const time = new Date().toLocaleTimeString('pt-BR');
        status.textContent += `[${time}] ${message}\n`;
        status.scrollTop = status.scrollHeight;
    }

    function checkCancelled() {
        if (cancelRequested) throw new Error('EXPORT_CANCELLED');
    }

    function normalizeProject(value) {
        return String(value || '').trim().toUpperCase();
    }

    function normalizeToken(value) {
        return String(value || '').trim().replace(/^Bearer\s+/i, '');
    }

    function normalizeWorkerCount(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return DEFAULT_WORKERS;
        return Math.max(1, Math.min(MAX_WORKERS, parsed));
    }

    async function runWorkerPool(items, workerCount, handler) {
        if (!items.length) return;
        let nextIndex = 0;
        let firstError = null;

        const workerLoop = async () => {
            while (!firstError) {
                let index;
                try {
                    checkCancelled();
                    index = nextIndex;
                    nextIndex += 1;
                    if (index >= items.length) return;
                    await handler(items[index], index);
                } catch (error) {
                    if (!firstError) firstError = error;
                    return;
                }
            }
        };

        const activeWorkers = Math.min(normalizeWorkerCount(workerCount), items.length);
        await Promise.all(Array.from({ length: activeWorkers }, () => workerLoop()));
        if (firstError) throw firstError;
        checkCancelled();
    }

    async function fetchWithRetry(url, options, label) {
        for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
            checkCancelled();
            try {
                const response = await fetch(url, options);
                const retryable = response.status === 429 || response.status >= 500;
                if (!retryable || attempt === MAX_REQUEST_RETRIES) return response;

                const retryAfterSeconds = Number(response.headers.get('Retry-After'));
                const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                    ? retryAfterSeconds * 1000
                    : Math.min(8000, 500 * (2 ** attempt));
                log(`${label}: HTTP ${response.status}; nova tentativa em ${Math.ceil(delay / 1000)}s.`);
                await sleep(delay);
            } catch (error) {
                if (attempt === MAX_REQUEST_RETRIES) throw error;
                const delay = Math.min(8000, 500 * (2 ** attempt));
                log(`${label}: falha de rede; nova tentativa em ${Math.ceil(delay / 1000)}s.`);
                await sleep(delay);
            }
        }
        throw new Error(`${label}: numero maximo de tentativas excedido.`);
    }

    function sanitizeName(value, maxLength = 120) {
        let name = String(value || '')
            .normalize('NFKC')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
            .replace(/[. ]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!name) name = 'sem-titulo';
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) name = `_${name}`;
        return name.slice(0, maxLength).replace(/[. ]+$/g, '') || 'sem-titulo';
    }

    function escapeYaml(value) {
        return JSON.stringify(value == null ? '' : String(value));
    }

    function isoDate(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }

    function articleUrl(article) {
        return `${location.origin}/articles/${encodeURIComponent(article.idReadable)}`;
    }

    function markdownHref(path) {
        return encodeURI(path).replace(/#/g, '%23');
    }

    function attachmentFileName(article, attachment) {
        return sanitizeName(`${article.idReadable}_${attachment.name || attachment.id}`, 160);
    }

    async function apiGet(path, params = {}) {
        checkCancelled();
        const url = new URL(path, location.origin);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }

        const response = await fetchWithRetry(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${activeToken}`,
            },
        }, `API ${url.pathname}`);

        if (response.status === 401) {
            throw new Error('Token recusado pela API (401). Gere um token permanente com o escopo YouTrack e tente novamente.');
        }
        if (response.status === 403) {
            throw new Error('A API recusou a operacao (403). Confirme que o token possui o escopo YouTrack e que sua conta pode ler os artigos.');
        }
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            throw new Error(`Falha na API ${response.status}: ${detail || response.statusText}`);
        }
        return response.json();
    }

    async function fetchAllArticles(projectShortName) {
        const fields = [
            'id', 'idReadable', 'summary', 'content', 'created', 'updated', 'ordinal',
            'hasChildren', 'project(id,shortName)', 'parentArticle(id,idReadable)',
        ].join(',');
        const all = [];
        const seenIds = new Set();
        let skip = 0;

        log('Lendo a lista completa de artigos acessiveis...');
        while (all.length < MAX_ARTICLES) {
            checkCancelled();
            const page = await apiGet('/api/articles', {
                fields,
                '$top': PAGE_SIZE,
                '$skip': skip,
            });
            if (!Array.isArray(page)) throw new Error('A API retornou uma lista de artigos em formato inesperado.');
            if (page.length === 0) break;

            let newItems = 0;
            for (const article of page) {
                if (!article?.id || seenIds.has(article.id)) continue;
                seenIds.add(article.id);
                all.push(article);
                newItems += 1;
            }
            if (newItems === 0) throw new Error('A paginacao da API repetiu a mesma pagina e foi interrompida por seguranca.');

            skip += page.length;
            log(`${all.length} artigos acessiveis examinados...`);
            await sleep(REQUEST_DELAY_MS);
        }

        if (all.length >= MAX_ARTICLES) {
            throw new Error(`O limite de seguranca de ${MAX_ARTICLES} artigos foi atingido.`);
        }

        const filtered = all.filter((article) => normalizeProject(article.project?.shortName) === projectShortName);
        log(`${filtered.length} artigos encontrados no projeto ${projectShortName}.`);
        return filtered;
    }

    async function fetchAttachments(article) {
        const fields = 'id,name,url,mimeType,size,removed';
        const attachments = [];
        let skip = 0;

        while (true) {
            checkCancelled();
            const page = await apiGet(`/api/articles/${encodeURIComponent(article.idReadable)}/attachments`, {
                fields,
                '$top': PAGE_SIZE,
                '$skip': skip,
            });
            if (!Array.isArray(page) || page.length === 0) break;
            attachments.push(...page.filter((item) => !item.removed));
            skip += page.length;
            await sleep(REQUEST_DELAY_MS);
        }
        return attachments;
    }

    async function writeFile(directoryHandle, name, data) {
        const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(data);
        } finally {
            await writable.close();
        }
    }

    async function getSubdirectory(directoryHandle, name) {
        return directoryHandle.getDirectoryHandle(sanitizeName(name, 100), { create: true });
    }

    function replaceAttachmentUrls(content, attachments, article, articleAssetPath) {
        let output = String(content || '');
        for (const attachment of attachments) {
            if (!attachment.url) continue;
            const localUrl = markdownHref(`${articleAssetPath}/${attachmentFileName(article, attachment)}`);
            const absoluteUrl = new URL(attachment.url, location.origin).href;
            output = output.split(absoluteUrl).join(localUrl);
            output = output.split(attachment.url).join(localUrl);
            if (attachment.name) {
                output = output.split(`(${attachment.name})`).join(`(${localUrl})`);
                output = output.split(`(${encodeURI(attachment.name)})`).join(`(${localUrl})`);
            }
        }
        return output;
    }

    function buildArticleMarkdown(article, attachments, fileNameById, downloadAttachments) {
        const parent = article.parentArticle;
        const parentFile = parent?.id ? fileNameById.get(parent.id) : null;
        const assetPath = `../assets/${sanitizeName(article.idReadable, 60)}`;
        const content = downloadAttachments
            ? replaceAttachmentUrls(article.content, attachments, article, assetPath)
            : String(article.content || '');

        const lines = [
            '---',
            `id: ${escapeYaml(article.idReadable)}`,
            `titulo: ${escapeYaml(article.summary || 'Sem titulo')}`,
            `projeto: ${escapeYaml(article.project?.shortName || '')}`,
            `origem: ${escapeYaml(articleUrl(article))}`,
            `criado_em: ${escapeYaml(isoDate(article.created))}`,
            `atualizado_em: ${escapeYaml(isoDate(article.updated))}`,
            `artigo_pai: ${escapeYaml(parent?.idReadable || '')}`,
            '---',
            '',
            `# ${article.summary || article.idReadable}`,
            '',
            `[Abrir no YouTrack](${articleUrl(article)})`,
        ];

        if (parentFile) lines.push('', `Artigo pai: [${parent.idReadable}](${markdownHref(parentFile)})`);
        lines.push('', content.trim(), '');

        if (attachments.length) {
            lines.push('## Anexos', '');
            for (const attachment of attachments) {
                const href = downloadAttachments
                    ? `${assetPath}/${attachmentFileName(article, attachment)}`
                    : new URL(attachment.url, location.origin).href;
                const size = attachment.size ? ` (${Math.ceil(attachment.size / 1024)} KB)` : '';
                lines.push(`- [${attachment.name || attachment.id}](${markdownHref(href)})${size}`);
            }
            lines.push('');
        }

        return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
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

    function markdownInlineToText(value) {
        return toPdfText(String(value || '')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => `Imagem: ${alt || 'sem descricao'} (${url})`)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => `${label} (${url})`)
            .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/?[^>]+>/g, '')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/(\*\*|__)(.*?)\1/g, '$2')
            .replace(/(\*|_)(.*?)\1/g, '$2')
            .replace(/~~(.*?)~~/g, '$1')
            .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1'));
    }

    function renderArticlePdfBlob(article, attachments, downloadAttachments) {
        const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
        if (typeof JsPdf !== 'function') {
            throw new Error('A biblioteca jsPDF nao foi carregada. Recarregue a pagina e tente novamente.');
        }

        const title = article.summary || article.idReadable;
        const sourceUrl = articleUrl(article);
        const assetPath = `../assets/${sanitizeName(article.idReadable, 60)}`;
        const content = downloadAttachments
            ? replaceAttachmentUrls(article.content, attachments, article, assetPath)
            : String(article.content || '');
        const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        doc.setProperties({
            title: toPdfText(`${article.idReadable} - ${title}`),
            subject: toPdfText('Artigo exportado da base de conhecimento do YouTrack'),
            author: 'YouTrack ATT - Exportador de Artigos',
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = { top: 14, right: 14, bottom: 17, left: 14 };
        const contentWidth = pageWidth - margin.left - margin.right;
        let y = margin.top;

        const addPage = () => {
            doc.addPage();
            y = margin.top;
        };
        const ensureSpace = (height) => {
            if (y + height > pageHeight - margin.bottom) addPage();
        };
        const wrappedLines = (text, size, width = contentWidth) => {
            doc.setFontSize(size);
            return doc.splitTextToSize(toPdfText(text) || '-', width);
        };
        const writeWrapped = (text, {
            size = 10,
            style = 'normal',
            font = 'helvetica',
            color = [23, 43, 77],
            indent = 0,
            after = 1.5,
            lineHeight = size * 0.43,
        } = {}) => {
            doc.setFont(font, style);
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

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(82, 96, 109);
        doc.text(toPdfText(article.idReadable), margin.left, y);
        y += 7;
        writeWrapped(title, {
            size: 18,
            style: 'bold',
            color: [16, 42, 67],
            after: 4,
            lineHeight: 7.8,
        });

        const metadata = [
            `Projeto: ${article.project?.shortName || ''}`,
            `Criado em: ${isoDate(article.created) || 'Nao informado'}`,
            `Atualizado em: ${isoDate(article.updated) || 'Nao informado'}`,
            `Artigo pai: ${article.parentArticle?.idReadable || 'Nenhum'}`,
            `Fonte: ${sourceUrl}`,
        ];
        const metadataLines = metadata.flatMap((item) => wrappedLines(item, 9.2, contentWidth - 8));
        const metadataHeight = metadataLines.length * 4.1 + 6;
        ensureSpace(metadataHeight);
        doc.setFillColor(245, 248, 251);
        doc.rect(margin.left, y, contentWidth, metadataHeight, 'F');
        doc.setFillColor(47, 111, 173);
        doc.rect(margin.left, y, 1.5, metadataHeight, 'F');
        y += 4.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.2);
        doc.setTextColor(23, 43, 77);
        for (const line of metadataLines) {
            doc.text(line, margin.left + 4, y);
            y += 4.1;
        }
        y += 5;

        writeWrapped('Conteudo', {
            size: 14,
            style: 'bold',
            color: [22, 50, 79],
            after: 3,
            lineHeight: 6.2,
        });

        let inCodeBlock = false;
        for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
            const trimmed = rawLine.trim();
            const fence = trimmed.match(/^```(.*)$/);
            if (fence) {
                inCodeBlock = !inCodeBlock;
                if (inCodeBlock && fence[1].trim()) {
                    writeWrapped(`Codigo: ${fence[1].trim()}`, {
                        size: 8.2, style: 'bold', font: 'courier', color: [82, 96, 109], after: 1,
                    });
                }
                continue;
            }
            if (!trimmed) {
                y += 2;
                continue;
            }
            if (inCodeBlock) {
                writeWrapped(rawLine || ' ', {
                    size: 8.4, font: 'courier', color: [38, 50, 56], indent: 2, after: 0.6, lineHeight: 3.7,
                });
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                const level = heading[1].length;
                const sizes = [16, 14, 12.5, 11.5, 10.5, 10];
                writeWrapped(markdownInlineToText(heading[2]), {
                    size: sizes[level - 1],
                    style: 'bold',
                    color: [22, 50, 79],
                    after: 2,
                    lineHeight: sizes[level - 1] * 0.46,
                });
                continue;
            }
            if (/^([-*_])(?:\s*\1){2,}$/.test(trimmed)) {
                ensureSpace(4);
                doc.setDrawColor(216, 224, 232);
                doc.line(margin.left, y, pageWidth - margin.right, y);
                y += 4;
                continue;
            }

            const checkbox = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
            const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
            const numbered = trimmed.match(/^(\d+[.)])\s+(.+)$/);
            const quote = trimmed.match(/^>\s?(.*)$/);
            if (checkbox) {
                writeWrapped(`[${checkbox[1].trim() ? 'x' : ' '}] ${markdownInlineToText(checkbox[2])}`, {
                    indent: 4, after: 0.8, lineHeight: 4.3,
                });
            } else if (bullet) {
                writeWrapped(`- ${markdownInlineToText(bullet[1])}`, {
                    indent: 4, after: 0.8, lineHeight: 4.3,
                });
            } else if (numbered) {
                writeWrapped(`${numbered[1]} ${markdownInlineToText(numbered[2])}`, {
                    indent: 4, after: 0.8, lineHeight: 4.3,
                });
            } else if (quote) {
                writeWrapped(markdownInlineToText(quote[1]), {
                    style: 'italic', color: [82, 96, 109], indent: 5, after: 1.2, lineHeight: 4.3,
                });
            } else {
                writeWrapped(markdownInlineToText(trimmed), {
                    after: 1.2, lineHeight: 4.4,
                });
            }
        }

        if (attachments.length) {
            y += 3;
            writeWrapped('Anexos', {
                size: 13,
                style: 'bold',
                color: [22, 50, 79],
                after: 2,
                lineHeight: 5.8,
            });
            for (const attachment of attachments) {
                const href = downloadAttachments
                    ? `${assetPath}/${attachmentFileName(article, attachment)}`
                    : new URL(attachment.url, location.origin).href;
                const size = attachment.size ? ` (${Math.ceil(attachment.size / 1024)} KB)` : '';
                writeWrapped(`- ${attachment.name || attachment.id}${size}: ${href}`, {
                    size: 8.5, color: [18, 89, 167], indent: 2, after: 0.7, lineHeight: 3.8,
                });
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
            doc.text(toPdfText(article.idReadable), margin.left, pageHeight - 6.5);
            doc.text(`Pagina ${pageNumber} de ${totalPages}`, pageWidth - margin.right, pageHeight - 6.5, { align: 'right' });
        }
        return doc.output('blob');
    }

    function sortArticles(a, b) {
        const ordinalA = Number.isFinite(a.ordinal) ? a.ordinal : Number.MAX_SAFE_INTEGER;
        const ordinalB = Number.isFinite(b.ordinal) ? b.ordinal : Number.MAX_SAFE_INTEGER;
        return ordinalA - ordinalB
            || String(a.summary || '').localeCompare(String(b.summary || ''), 'pt-BR')
            || String(a.idReadable || '').localeCompare(String(b.idReadable || ''), 'pt-BR');
    }

    function buildIndex(projectShortName, articles, fileNameById, formatLabel) {
        const articleById = new Map(articles.map((article) => [article.id, article]));
        const children = new Map();
        const roots = [];

        for (const article of articles) {
            const parentId = article.parentArticle?.id;
            if (parentId && articleById.has(parentId)) {
                if (!children.has(parentId)) children.set(parentId, []);
                children.get(parentId).push(article);
            } else {
                roots.push(article);
            }
        }

        const lines = [
            `# Artigos do YouTrack - ${projectShortName}`,
            '',
            `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
            '',
            `Formato dos artigos: ${formatLabel}`,
            '',
            `Total de artigos: ${articles.length}`,
            '',
            '## Indice',
            '',
        ];
        const visited = new Set();

        function appendArticle(article, depth) {
            if (visited.has(article.id)) return;
            visited.add(article.id);
            const fileName = fileNameById.get(article.id);
            lines.push(`${'  '.repeat(depth)}- [${article.idReadable} - ${article.summary || 'Sem titulo'}](${markdownHref(`articles/${fileName}`)})`);
            for (const child of (children.get(article.id) || []).sort(sortArticles)) appendArticle(child, depth + 1);
        }

        for (const root of roots.sort(sortArticles)) appendArticle(root, 0);
        for (const article of [...articles].sort(sortArticles)) appendArticle(article, 0);
        lines.push('');
        return `${lines.join('\n')}\n`;
    }

    async function downloadAttachment(article, attachment, destinationDirectory) {
        const url = new URL(attachment.url, location.origin);
        const response = await fetchWithRetry(url, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${activeToken}` },
        }, `Anexo ${attachment.name || attachment.id}`);
        if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${attachment.name}`);
        await writeFile(destinationDirectory, attachmentFileName(article, attachment), await response.blob());
    }

    async function runExport() {
        if (running) return;
        if (typeof window.showDirectoryPicker !== 'function') {
            alert('Este navegador nao oferece a selecao segura de pastas. Abra o YouTrack no Chrome ou Edge atualizado.');
            return;
        }

        const project = normalizeProject(document.getElementById('attus-ytmd-project').value);
        const token = normalizeToken(document.getElementById('attus-ytmd-token').value);
        const exportFormat = document.getElementById('attus-ytmd-format').value === 'pdf' ? 'pdf' : 'md';
        const formatLabel = exportFormat === 'pdf' ? 'PDF' : 'Markdown';
        const workerCount = normalizeWorkerCount(document.getElementById('attus-ytmd-workers').value);
        document.getElementById('attus-ytmd-workers').value = String(workerCount);
        const includeAttachments = document.getElementById('attus-ytmd-attachments').checked;
        if (!project) {
            alert('Informe a sigla do projeto, por exemplo ATT.');
            return;
        }
        if (!token) {
            alert('Informe um token permanente do YouTrack com o escopo YouTrack.\n\nAbra seu Perfil > Seguranca da conta > Tokens > Novo token.');
            return;
        }
        if (exportFormat === 'pdf' && typeof (window.jspdf?.jsPDF || window.jsPDF) !== 'function') {
            alert('A biblioteca de PDF nao foi carregada. Recarregue a pagina do YouTrack e tente novamente.');
            return;
        }

        let selectedDirectory;
        try {
            selectedDirectory = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (error) {
            if (error?.name !== 'AbortError') alert(`Nao foi possivel selecionar a pasta: ${error.message}`);
            return;
        }

        running = true;
        cancelRequested = false;
        activeToken = token;
        setRunningUi(true);
        document.getElementById('attus-ytmd-status').textContent = '';

        try {
            log(`Exportacao do projeto ${project} em ${formatLabel} iniciada com ${workerCount} trabalhador(es).`);
            const articles = await fetchAllArticles(project);
            if (articles.length === 0) {
                throw new Error(`Nenhum artigo acessivel foi encontrado no projeto ${project}.`);
            }

            const outputFolderName = `YouTrack-${project}-${formatLabel}`;
            const exportRoot = await getSubdirectory(selectedDirectory, outputFolderName);
            const articlesDirectory = await getSubdirectory(exportRoot, 'articles');
            const assetsDirectory = includeAttachments ? await getSubdirectory(exportRoot, 'assets') : null;
            const fileNameById = new Map();
            for (const article of articles) {
                fileNameById.set(
                    article.id,
                    `${sanitizeName(`${article.idReadable} - ${article.summary || 'Sem titulo'}`, 150)}.${exportFormat}`,
                );
            }

            const sortedArticles = [...articles].sort(sortArticles);
            const manifest = new Array(sortedArticles.length);
            let completed = 0;
            let failedAttachments = 0;

            await runWorkerPool(sortedArticles, workerCount, async (article, articleIndex) => {
                checkCancelled();
                const attachments = await fetchAttachments(article);
                const fileName = fileNameById.get(article.id);
                const articleFile = exportFormat === 'pdf'
                    ? renderArticlePdfBlob(article, attachments, includeAttachments)
                    : buildArticleMarkdown(article, attachments, fileNameById, includeAttachments);
                await writeFile(articlesDirectory, fileName, articleFile);

                if (includeAttachments && attachments.length) {
                    const articleAssets = await getSubdirectory(assetsDirectory, article.idReadable);
                    for (const attachment of attachments) {
                        checkCancelled();
                        try {
                            await downloadAttachment(article, attachment, articleAssets);
                        } catch (error) {
                            failedAttachments += 1;
                            log(`Aviso: ${article.idReadable} / ${attachment.name}: ${error.message}`);
                        }
                        await sleep(REQUEST_DELAY_MS);
                    }
                }

                manifest[articleIndex] = {
                    id: article.idReadable,
                    title: article.summary || '',
                    source: articleUrl(article),
                    parent: article.parentArticle?.idReadable || null,
                    file: `articles/${fileName}`,
                    format: exportFormat,
                    attachments: attachments.length,
                    updated: isoDate(article.updated),
                };
                completed += 1;
                log(`${completed}/${articles.length} - ${article.idReadable} salvo.`);
                await sleep(REQUEST_DELAY_MS);
            });

            await writeFile(exportRoot, 'README.md', buildIndex(project, articles, fileNameById, formatLabel));
            await writeFile(exportRoot, 'manifest.json', JSON.stringify({
                project,
                format: exportFormat,
                exportedAt: new Date().toISOString(),
                source: `${location.origin}/articles/${encodeURIComponent(project)}`,
                articleCount: articles.length,
                workers: workerCount,
                articles: manifest.filter(Boolean),
            }, null, 2));

            log(`Concluido: ${completed} artigos em ${formatLabel} salvos.`);
            if (failedAttachments) log(`${failedAttachments} anexos falharam; os avisos acima indicam quais.`);
            alert(`Exportacao concluida.\n\n${completed} artigos em ${formatLabel} salvos em ${outputFolderName}.`);
        } catch (error) {
            if (error?.message === 'EXPORT_CANCELLED') {
                log('Exportacao cancelada pelo usuario. Os arquivos ja gravados foram mantidos.');
            } else {
                console.error('[YouTrack Markdown Export]', error);
                log(`ERRO: ${error?.message || error}`);
                alert(`A exportacao falhou:\n\n${error?.message || error}`);
            }
        } finally {
            activeToken = '';
            document.getElementById('attus-ytmd-token').value = '';
            running = false;
            setRunningUi(false);
        }
    }

    function setRunningUi(isRunning) {
        document.getElementById('attus-ytmd-start').disabled = isRunning;
        document.getElementById('attus-ytmd-project').disabled = isRunning;
        document.getElementById('attus-ytmd-token').disabled = isRunning;
        document.getElementById('attus-ytmd-format').disabled = isRunning;
        document.getElementById('attus-ytmd-workers').disabled = isRunning;
        document.getElementById('attus-ytmd-attachments').disabled = isRunning;
        document.getElementById('attus-ytmd-cancel').disabled = !isRunning;
    }

    function createUi() {
        if (document.getElementById('attus-ytmd-open')) return;

        const openButton = document.createElement('button');
        openButton.id = 'attus-ytmd-open';
        openButton.type = 'button';
        openButton.textContent = 'Exportar artigos';

        const panel = document.createElement('section');
        panel.id = 'attus-ytmd-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <button id="attus-ytmd-close" type="button" title="Fechar">&times;</button>
            <h2>Exportar artigos do YouTrack</h2>
            <p>Salva todos os artigos acessiveis do projeto em Markdown ou PDF, com indice e manifesto.</p>
            <label class="field">
                Sigla do projeto
                <input id="attus-ytmd-project" type="text" value="${DEFAULT_PROJECT}" maxlength="30" autocomplete="off">
            </label>
            <label class="field">
                Formato dos artigos
                <select id="attus-ytmd-format">
                    <option value="md" selected>Markdown (.md)</option>
                    <option value="pdf">PDF pesquisavel (.pdf)</option>
                </select>
            </label>
            <label class="field">
                Trabalhadores simultaneos
                <input id="attus-ytmd-workers" type="number" min="1" max="${MAX_WORKERS}" step="1" value="${DEFAULT_WORKERS}">
            </label>
            <label class="field">
                Token permanente do YouTrack
                <input id="attus-ytmd-token" type="password" placeholder="perm:..." autocomplete="new-password" spellcheck="false">
            </label>
            <label class="attus-ytmd-check">
                <input id="attus-ytmd-attachments" type="checkbox" checked>
                Baixar anexos e ajustar as referencias
            </label>
            <p class="attus-ytmd-note">Use 4 trabalhadores como padrao. Valores maiores aceleram rede e anexos, mas podem sofrer limitacao do servidor. O PDF mantem texto pesquisavel, titulos, listas, links e blocos de codigo. O token nao e salvo e e removido da memoria ao terminar.</p>
            <div class="attus-ytmd-actions">
                <button id="attus-ytmd-start" class="primary" type="button">Escolher pasta e exportar</button>
                <button id="attus-ytmd-cancel" class="danger" type="button" disabled>Cancelar</button>
            </div>
            <pre id="attus-ytmd-status">Pronto para iniciar.</pre>
        `;

        document.body.append(openButton, panel);
        openButton.addEventListener('click', () => { panel.hidden = !panel.hidden; });
        panel.querySelector('#attus-ytmd-close').addEventListener('click', () => { panel.hidden = true; });
        panel.querySelector('#attus-ytmd-start').addEventListener('click', runExport);
        panel.querySelector('#attus-ytmd-cancel').addEventListener('click', () => {
            cancelRequested = true;
            log('Cancelamento solicitado; finalizando a operacao atual...');
        });
    }

    createUi();
})();

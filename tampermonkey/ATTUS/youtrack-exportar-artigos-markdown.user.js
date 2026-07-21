// ==UserScript==
// @name         YouTrack ATT - Exportar Artigos em Markdown
// @namespace    https://youtrack.attus.ai/
// @version      2026.07.21.01
// @description  Exporta todos os artigos acessiveis de um projeto do YouTrack para arquivos Markdown e baixa seus anexos.
// @author       ATTUS
// @match        https://youtrack.attus.ai/articles/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/youtrack-exportar-artigos-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/ATTUS/youtrack-exportar-artigos-markdown.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_PROJECT = 'ATT';
    const PAGE_SIZE = 100;
    const REQUEST_DELAY_MS = 80;
    const MAX_ARTICLES = 20000;

    let running = false;
    let cancelRequested = false;

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
        #attus-ytmd-project {
            padding: 8px; border: 1px solid #aebdca; border-radius: 5px; font: inherit;
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

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });

        if (response.status === 401 || response.status === 403) {
            throw new Error(`Acesso negado pela API (${response.status}). Confirme que voce esta conectado ao YouTrack e possui permissao de leitura.`);
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

        log(`Lendo os artigos do projeto ${projectShortName}...`);
        while (all.length < MAX_ARTICLES) {
            checkCancelled();
            const page = await apiGet(`/api/admin/projects/${encodeURIComponent(projectShortName)}/articles`, {
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
            log(`${all.length} artigos do projeto recebidos...`);
            await sleep(REQUEST_DELAY_MS);
        }

        if (all.length >= MAX_ARTICLES) {
            throw new Error(`O limite de seguranca de ${MAX_ARTICLES} artigos foi atingido.`);
        }

        const filtered = all.filter((article) => !article.project?.shortName
            || normalizeProject(article.project.shortName) === projectShortName);
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

    function sortArticles(a, b) {
        const ordinalA = Number.isFinite(a.ordinal) ? a.ordinal : Number.MAX_SAFE_INTEGER;
        const ordinalB = Number.isFinite(b.ordinal) ? b.ordinal : Number.MAX_SAFE_INTEGER;
        return ordinalA - ordinalB
            || String(a.summary || '').localeCompare(String(b.summary || ''), 'pt-BR')
            || String(a.idReadable || '').localeCompare(String(b.idReadable || ''), 'pt-BR');
    }

    function buildIndex(projectShortName, articles, fileNameById) {
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
        const response = await fetch(url, { credentials: 'include' });
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
        const includeAttachments = document.getElementById('attus-ytmd-attachments').checked;
        if (!project) {
            alert('Informe a sigla do projeto, por exemplo ATT.');
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
        setRunningUi(true);
        document.getElementById('attus-ytmd-status').textContent = '';

        try {
            log(`Exportacao do projeto ${project} iniciada.`);
            const articles = await fetchAllArticles(project);
            if (articles.length === 0) {
                throw new Error(`Nenhum artigo acessivel foi encontrado no projeto ${project}.`);
            }

            const exportRoot = await getSubdirectory(selectedDirectory, `YouTrack-${project}-Markdown`);
            const articlesDirectory = await getSubdirectory(exportRoot, 'articles');
            const assetsDirectory = includeAttachments ? await getSubdirectory(exportRoot, 'assets') : null;
            const fileNameById = new Map();
            for (const article of articles) {
                fileNameById.set(article.id, `${sanitizeName(`${article.idReadable} - ${article.summary || 'Sem titulo'}`, 150)}.md`);
            }

            const manifest = [];
            let completed = 0;
            let failedAttachments = 0;

            for (const article of [...articles].sort(sortArticles)) {
                checkCancelled();
                const attachments = await fetchAttachments(article);
                const fileName = fileNameById.get(article.id);
                const markdown = buildArticleMarkdown(article, attachments, fileNameById, includeAttachments);
                await writeFile(articlesDirectory, fileName, markdown);

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

                manifest.push({
                    id: article.idReadable,
                    title: article.summary || '',
                    source: articleUrl(article),
                    parent: article.parentArticle?.idReadable || null,
                    file: `articles/${fileName}`,
                    attachments: attachments.length,
                    updated: isoDate(article.updated),
                });
                completed += 1;
                log(`${completed}/${articles.length} - ${article.idReadable} salvo.`);
                await sleep(REQUEST_DELAY_MS);
            }

            await writeFile(exportRoot, 'README.md', buildIndex(project, articles, fileNameById));
            await writeFile(exportRoot, 'manifest.json', JSON.stringify({
                project,
                exportedAt: new Date().toISOString(),
                source: `${location.origin}/articles/${encodeURIComponent(project)}`,
                articleCount: articles.length,
                articles: manifest,
            }, null, 2));

            log(`Concluido: ${completed} artigos Markdown salvos.`);
            if (failedAttachments) log(`${failedAttachments} anexos falharam; os avisos acima indicam quais.`);
            alert(`Exportacao concluida.\n\n${completed} artigos salvos em YouTrack-${project}-Markdown.`);
        } catch (error) {
            if (error?.message === 'EXPORT_CANCELLED') {
                log('Exportacao cancelada pelo usuario. Os arquivos ja gravados foram mantidos.');
            } else {
                console.error('[YouTrack Markdown Export]', error);
                log(`ERRO: ${error?.message || error}`);
                alert(`A exportacao falhou:\n\n${error?.message || error}`);
            }
        } finally {
            running = false;
            setRunningUi(false);
        }
    }

    function setRunningUi(isRunning) {
        document.getElementById('attus-ytmd-start').disabled = isRunning;
        document.getElementById('attus-ytmd-project').disabled = isRunning;
        document.getElementById('attus-ytmd-attachments').disabled = isRunning;
        document.getElementById('attus-ytmd-cancel').disabled = !isRunning;
    }

    function createUi() {
        if (document.getElementById('attus-ytmd-open')) return;

        const openButton = document.createElement('button');
        openButton.id = 'attus-ytmd-open';
        openButton.type = 'button';
        openButton.textContent = 'Exportar Markdown';

        const panel = document.createElement('section');
        panel.id = 'attus-ytmd-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <button id="attus-ytmd-close" type="button" title="Fechar">&times;</button>
            <h2>Exportar artigos do YouTrack</h2>
            <p>Salva todos os artigos acessiveis do projeto em Markdown, com indice e manifesto.</p>
            <label class="field">
                Sigla do projeto
                <input id="attus-ytmd-project" type="text" value="${DEFAULT_PROJECT}" maxlength="30" autocomplete="off">
            </label>
            <label class="attus-ytmd-check">
                <input id="attus-ytmd-attachments" type="checkbox" checked>
                Baixar anexos e ajustar os links no Markdown
            </label>
            <p class="attus-ytmd-note">A exportacao usa a sessao desta aba. Somente artigos que a sua conta consegue ler serao salvos.</p>
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

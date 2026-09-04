'use strict';

// npm install --no-save jsdom@26.1.0
// node --test tests/zendesk-ticket-events.test.cjs (from the ATTUS directory)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const scriptPath = process.env.ZENDESK_SCRIPT || [
    path.join(__dirname, '..', 'Zendesk - Exportar Tickets N2 Resolvidos.user.js'),
    path.join(__dirname, '..', 'zendesk-exportar-tickets-n2-resolvidos.user.js')
].find(file => fs.existsSync(file));
const source = fs.readFileSync(scriptPath, 'utf8');

function harness() {
    const dom = new JSDOM('<body></body>', { url: 'https://attus-ai.zendesk.com/agent/tickets/42' });
    const pdfs = [];
    class Pdf {
        constructor() {
            this.pages = 1;
            this.texts = [];
            this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
            pdfs.push(this);
        }
        setProperties() {} setFontSize() {} setFont() {} setTextColor() {}
        setFillColor() {} setDrawColor() {} rect() {} line() {} setPage() {}
        addPage() { this.pages++; }
        getNumberOfPages() { return this.pages; }
        splitTextToSize(text) { return String(text).split('\n').flatMap(line => line.match(/.{1,75}/g) || ['']); }
        text(text, x, y) { assert.ok(y <= 297 && y >= 0); this.texts.push(String(text)); }
        output() { return new Blob([this.texts.join('\n')], { type: 'application/pdf' }); }
    }
    dom.window.jspdf = { jsPDF: Pdf };
    const context = vm.createContext({
        window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
        localStorage: dom.window.localStorage, URL, Blob, Intl, console, setTimeout, clearTimeout,
        GM_addStyle: () => {}, fetch: async () => { throw new Error('Unexpected fetch'); }
    });
    vm.runInContext(source.replace(/    createUi\(\);\s*\}\)\(\);\s*$/, `
        sleep = async () => {};
        restoreDirectoryHandle = async () => {};
        globalThis.api = {
            collectAudits, prepareAudits, auditEntries, auditValue, renderMarkdownText,
            renderPdfBlob, exportProfileKey, exportTicket, manifestRow, createManifestCsv,
            loadTicketDocument, loadTicketFields, runTicketPool, createUi, setRunningUi,
            userCache, groupCache, statusCache, fieldCache,
            setFetchJson(fn) { fetchJson = fn; },
            setCancel(value) { cancelRequested = value; },
            setPersistence(save, stateSave) { saveBlobToDirectory = save; enqueueStateSave = stateSave; }
        };
    })();`), context);
    return { api: context.api, context, pdfs, dom };
}

const comments = [
    { id: 100, public: true, author_id: 1, created_at: '2026-09-01T10:00:00Z', body: 'CURRENT_BODY' },
    { id: 101, public: false, author_id: 2, created_at: '2026-09-01T11:00:00Z', body: 'PRIVATE_CURRENT' }
];
const audits = [
    { id: 10, ticket_id: 42, author_id: 2, created_at: '2026-09-01T10:00:00Z',
        via: { channel: 'web', source: { secret: 'VIA_PRIVATE' } }, metadata: { secret: 'META_PRIVATE' }, events: [
            { id: 100, type: 'Comment', public: true, body: 'OLD_REDACTED_BODY' },
            { id: 102, type: 'Change', field_name: 'group_id', previous_value: '1', value: '2' },
            { id: 103, type: 'Change', field_name: '900', previous_value: 'old', value: 'new' },
            { id: 104, type: 'Notification', body: 'NOTIFICATION_PRIVATE', via: { channel: 'rule' } }
        ] },
    { id: 11, ticket_id: 42, author_id: 2, created_at: '2026-09-01T11:00:00Z', via: { channel: 'api' }, events: [
        { id: 101, type: 'Comment', public: true, body: 'BECAME_PRIVATE' },
        { id: 105, type: 'Comment', public: true, body: 'DELETED_COMMENT' },
        { id: 106, type: 'FutureEvent', data: { body: 'FUTURE_PRIVATE', weird: '```\n# forged' } }
    ] }
];
const ticket = { id: 42, subject: 'Teste de eventos', requester_id: 1, assignee_id: 2, group_id: 2, status: 'solved', tags: ['test'] };

function data(api, includePrivate = true) {
    const selected = comments.filter(c => includePrivate || c.public);
    return { ticket, comments: selected, group: 'Suporte', customStatus: 'Resolvido',
        includePrivate, includeEvents: true, ...api.prepareAudits(audits, selected, includePrivate) };
}

test('header, version and worker defaults remain valid', () => {
    assert.ok(source.startsWith('// ==UserScript=='));
    assert.match(source, /@version\s+2026\.09\.04\.01/);
    assert.match(source, /MAX_CONCURRENCY = 8/);
    assert.match(source, /DEFAULT_CONCURRENCY = 4/);
});

test('cursor pagination deduplicates audits and sorts chronologically', async () => {
    const { api } = harness();
    const calls = [];
    api.setFetchJson(async url => {
        calls.push(url);
        return calls.length === 1 ? { audits: [audits[1]], meta: { has_more: true }, links: { next: '/api/v2/tickets/42/audits.json?page[after]=x' } }
            : { audits: [audits[0], audits[1]], meta: { has_more: false }, links: { next: '/ignored' } };
    });
    const result = await api.collectAudits(42);
    assert.deepEqual(Array.from(result, a => a.id), [10, 11]);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /page%5Bsize%5D=100/);
});

test('offset and archived single-page responses are supported', async () => {
    const { api } = harness();
    let calls = 0;
    api.setFetchJson(async () => ++calls === 1 ? { audits: [audits[0]], next_page: '/api/v2/tickets/42/audits.json?page=2' } : { audits: [audits[1]], next_page: null });
    assert.equal((await api.collectAudits(42)).length, 2);
    api.setFetchJson(async () => ({ audits: [audits[0]] }));
    assert.equal((await api.collectAudits(42)).length, 1);
});

test('invalid, incomplete, repeated and foreign pagination fails closed', async () => {
    for (const response of [
        {}, { audits: [{ ...audits[0], ticket_id: 43 }] },
        { audits: [], meta: { has_more: true } },
        { audits: [], next_page: 'https://evil.example/api/v2/tickets/42/audits.json' },
        { audits: [], next_page: '/api/v2/tickets/42/audits.json?loop=1' }
    ]) {
        const { api } = harness();
        api.setFetchJson(async () => response);
        await assert.rejects(api.collectAudits(42));
    }
});

test('cancellation stops before fetching another audit page', async () => {
    const { api } = harness();
    let calls = 0;
    api.setFetchJson(async () => { calls++; api.setCancel(true); return { audits: [], next_page: '/api/v2/tickets/42/audits.json?page=2' }; });
    await assert.rejects(api.collectAudits(42), /cancelada/);
    assert.equal(calls, 1);
});

test('audit HTTP authentication errors preserve status and authenticated GET', async () => {
    for (const status of [401, 403]) {
        const { api, context } = harness();
        context.fetch = async (url, options) => {
            assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include');
            return { status, ok: false, headers: { get: () => null } };
        };
        await assert.rejects(api.collectAudits(42), error => error.httpStatus === status);
    }
});

test('audit transient server failures reuse bounded retries', async () => {
    const { api, context } = harness(); let calls = 0;
    context.fetch = async () => ++calls === 1
        ? { status: 503, ok: false, headers: { get: () => null }, text: async () => 'Unavailable' }
        : { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ audits }) };
    assert.equal((await api.collectAudits(42)).length, 2);
    assert.equal(calls, 2);
});

test('optional field catalog supports pagination and permission fallback', async () => {
    const { api } = harness(); let calls = 0;
    api.setFetchJson(async () => ++calls === 1
        ? { ticket_fields: [{ id: 900, title: 'Módulo' }], next_page: '/api/v2/ticket_fields.json?page=2' }
        : { ticket_fields: [{ id: 901, title: 'Versão' }], next_page: null });
    await api.loadTicketFields();
    assert.equal(api.fieldCache.size, 2);
    api.fieldCache.clear();
    api.setFetchJson(async () => { throw new Error('HTTP 403'); });
    await api.loadTicketFields();
    assert.equal(api.fieldCache.size, 0);
});

test('comment events reference current content, never historical/deleted bodies', () => {
    const { api } = harness();
    const result = data(api);
    assert.equal(result.totalEvents, 7);
    assert.equal(result.omittedEvents, 1);
    const md = api.renderMarkdownText(result, 'Teste', true);
    assert.match(md, /CURRENT_BODY/);
    assert.match(md, /PRIVATE_CURRENT/);
    assert.match(md, /NOTIFICATION_PRIVATE/);
    assert.doesNotMatch(md, /OLD_REDACTED_BODY|BECAME_PRIVATE|DELETED_COMMENT/);
    assert.match(md, /eventos_exportados: 6/);
    assert.match(md, /access_scope: "internal"/);
    assert.match(md, /````json/);
});

test('public-comment mode removes notification, custom-field and unknown payloads', () => {
    const { api } = harness();
    const result = data(api, false);
    const md = api.renderMarkdownText(result, 'Teste', false);
    assert.doesNotMatch(md, /PRIVATE_CURRENT|BECAME_PRIVATE|DELETED_COMMENT|NOTIFICATION_PRIVATE|FUTURE_PRIVATE|META_PRIVATE|VIA_PRIVATE/);
    assert.match(md, /group_id/);
    assert.match(md, /eventos_comentarios_omitidos: 2/);
    assert.match(md, /eventos_detalhes_restritos: true/);
    assert.match(md, /access_scope: "internal"/);
});

test('field values retain labels and original IDs', () => {
    const { api } = harness();
    api.groupCache.set(1, 'N1'); api.groupCache.set(2, 'N2');
    api.fieldCache.set('900', { title: 'Módulo', custom_field_options: [{ value: 'new', name: 'Documentos' }] });
    const md = api.renderMarkdownText(data(api), 'Teste', true);
    assert.match(md, /N1/); assert.match(md, /N2/); assert.match(md, /Documentos/); assert.match(md, /Módulo/);
    assert.match(md, /"field_name": "900"/);
});

test('PDF renderer includes paginated audit text and respects privacy', async () => {
    const { api, pdfs } = harness();
    await api.renderPdfBlob(data(api, false), 'Teste');
    const text = pdfs[0].texts.join('\n');
    assert.match(text, /Eventos de auditoria/);
    assert.match(text, /group_id/);
    assert.doesNotMatch(text, /NOTIFICATION_PRIVATE|OLD_REDACTED_BODY|PRIVATE_CURRENT|FUTURE_PRIVATE/);
    assert.ok(pdfs[0].pages >= 2);
});

test('no-events output and resume profiles remain distinct', () => {
    const { api } = harness();
    const md = api.renderMarkdownText({ ticket, comments: [], group: '', customStatus: '' }, 'Teste', false);
    assert.match(md, /inclui_eventos: false/);
    assert.match(md, /access_scope: "public"/);
    assert.doesNotMatch(md, /## Eventos/);
    assert.notEqual(api.exportProfileKey('q', true, true), api.exportProfileKey('q', true, false));
    assert.notEqual(api.exportProfileKey('q', true, true), api.exportProfileKey('q', false, true));
});

function fixtureApi(api, failAudits = false) {
    api.userCache.set(1, { id: 1, name: 'Cliente' }); api.userCache.set(2, { id: 2, name: 'Agente' });
    api.groupCache.set(1, 'N1'); api.groupCache.set(2, 'N2');
    api.setFetchJson(async url => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/audits.json')) {
            if (failAudits) throw new Error('Audit API failure');
            return { audits };
        }
        if (parsed.pathname.endsWith('/comments.json')) return { comments };
        if (parsed.pathname.endsWith('/42.json')) return { ticket };
        throw new Error(`Unexpected URL: ${url}`);
    });
}

test('full ticket export saves both formats and can resume without rewriting', async () => {
    const { api } = harness(); fixtureApi(api);
    const files = [];
    api.setPersistence(async (blob, filename) => files.push({ filename, text: await blob.text() }), async () => {});
    const state = { records: {} }; const errors = [];
    const run = () => api.exportTicket({ id: 42 }, 0, 1, true, ['pdf', 'md'], 'Teste', 'profile', state, errors, true);
    assert.equal((await run()).createdFiles, 2);
    assert.ok(files.every(file => file.filename.includes('-com-eventos.')));
    assert.match(files.find(file => file.filename.endsWith('.md')).text, /Eventos de auditoria/);
    assert.equal(state.records['42'].eventos_status, 'complete');
    assert.equal((await run()).createdFiles, 0);
    assert.equal(files.length, 2);
    assert.match(api.createManifestCsv(Object.values(state.records)), /eventos_exportados/);
});

test('audit failure saves no files and records retryable error', async () => {
    const { api } = harness(); fixtureApi(api, true);
    let writes = 0; const state = { records: {} }; const errors = [];
    api.setPersistence(async () => writes++, async () => {});
    const result = await api.exportTicket({ id: 42 }, 0, 1, true, ['md'], 'Teste', 'p', state, errors, true);
    assert.equal(result.success, false); assert.equal(writes, 0);
    assert.equal(state.records['42'].eventos_status, 'error');
    assert.equal(state.records['42'].arquivo_md, '');
});

test('failed second format resumes with the first format preserved', async () => {
    const { api } = harness(); fixtureApi(api);
    let fail = true; const names = []; const state = { records: {} };
    api.setPersistence(async (blob, filename) => {
        if (filename.endsWith('.md') && fail) throw new Error('Disk error');
        names.push(filename);
    }, async () => {});
    const run = () => api.exportTicket({ id: 42 }, 0, 1, true, ['pdf', 'md'], 'Teste', 'p', state, [], true);
    assert.equal((await run()).success, false);
    assert.ok(state.records['42'].arquivo_pdf);
    fail = false;
    assert.equal((await run()).createdFiles, 1);
    assert.equal(names.length, 2);
});

test('disabled events do not call the audit endpoint', async () => {
    const { api } = harness(); fixtureApi(api, true);
    const result = await api.loadTicketDocument({ id: 42 }, false, false);
    assert.equal(result.includeEvents, false);
    assert.equal(result.audits.length, 0);
});

test('UI defaults to events and freezes visibility options during export', () => {
    const { api, dom } = harness(); api.createUi();
    const events = dom.window.document.querySelector('#attus-zdexp-events');
    assert.equal(events.checked, true);
    api.setRunningUi(true);
    assert.equal(events.disabled, true);
    assert.equal(dom.window.document.querySelector('#attus-zdexp-private').disabled, true);
    api.setRunningUi(false);
    assert.equal(events.disabled, false);
});

test('eight-worker pool remains bounded and processes all tickets', async () => {
    const { api } = harness(); let active = 0; let maximum = 0;
    const result = await api.runTicketPool(Array.from({ length: 24 }, (_, i) => i), 8, async () => {
        active++; maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active--; return { success: true, createdFiles: 2 };
    });
    assert.equal(maximum, 8); assert.equal(result.successfulTickets, 24); assert.equal(result.createdFiles, 48);
});

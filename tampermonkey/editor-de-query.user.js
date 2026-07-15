// ==UserScript==
// @name         Editor de Query
// @namespace    http://tampermonkey.net/
// @version      2026-07-15.02
// @description  Editor SQL Pro com CodeMirror, ribbon, snippets, configuracoes, import/export SQL e execucao parcial.
// @compatible   edge
// @match        http://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @match        https://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @match        http://10.200.35.7/*
// @match        https://10.200.35.7/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/mode/sql/sql.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/edit/closebrackets.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/foldcode.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/foldgutter.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/brace-fold.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/comment-fold.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.js
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/editor-de-query.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/editor-de-query.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* global CodeMirror */

(function () {
  "use strict";

  // ===================================================================
  // CONFIG — ajuste aqui sem precisar tocar no restante do código
  // ===================================================================
  var CFG = {
    settingsVersion: 1,
    execWarnThresholdSeconds: 60,
    execFallbackTimeoutSeconds: 0,
    autoCollapseQueryAfterExecDefault: false,
    // Seletores da página de destino — centralizados para facilitar manutenção
    selectors: {
      textarea:      "#edtdeclaracao",
      executeButton: "#btnexecutar, #btnExecutar, input[value='Executar']"
    }
  };

  // ===================================================================
  // CHAVES DE ARMAZENAMENTO
  // ===================================================================
  var KEY_BASE = location.host + location.pathname + location.search;
  var KEYS = {
    size:          "editor_sql_pro_size_v1:"           + KEY_BASE,
    theme:         "editor_sql_pro_theme_v2:"          + KEY_BASE,
    cursor:        "editor_sql_pro_cursor_v1:"         + KEY_BASE,
    lint:          "editor_sql_pro_lint_enabled_v1:"   + KEY_BASE,
    toolbar:       "editor_sql_pro_toolbar_visible_v1:"+ KEY_BASE,
    accordionOpen: "tm:queryAccordion:open_v1:"        + KEY_BASE,
    modalOpen:     "tm:queryModal:open_v1:"            + KEY_BASE,
    modalSize:     "tm:queryModal:size_v1:"            + KEY_BASE,
    execWarn:      "tm:execTimer:warnSeconds_v1:"       + KEY_BASE,
    execFallback:  "tm:execTimer:fallbackSeconds_v1:"   + KEY_BASE,
    execCollapse:  "tm:execTimer:autoCollapse_v1:"      + KEY_BASE,
    execHistory:   "tm:execTimer:history_v1:"           + KEY_BASE,
    execToastPos:  "tm:execToast:position_v1:"          + KEY_BASE,
    execToastTheme:"tm:execToast:theme_v1:"             + KEY_BASE,
    execToastSize: "tm:execToast:size_v1:"              + KEY_BASE,
    execToastHide: "tm:execToast:hideSeconds_v1:"       + KEY_BASE,
    execToastDetail:"tm:execToast:detailVisible_v1:"    + KEY_BASE,
    execToastProgress:"tm:execToast:progressVisible_v1:"+ KEY_BASE,
    ribbonIcons:   "tm:ribbon:iconsVisible_v1:"         + KEY_BASE,
    ribbonItems:   "tm:ribbon:itemsVisible_v1:"         + KEY_BASE,
    execDraft:     "tm:queryEditor:execDraft_v1:"       + KEY_BASE,
    customSnippets:"tm:queryEditor:customSnippets_v1:"  + KEY_BASE,
    snippetFavorites:"tm:queryEditor:snippetFavorites_v1:" + KEY_BASE,
    snippetCardSettings:"tm:queryEditor:snippetCardSettings_v1:" + KEY_BASE,
    snippetDefaultsVersion:"tm:queryEditor:snippetDefaultsVersion_v1:" + KEY_BASE,
    schemaCatalog:"tm:queryEditor:schemaCatalog_v1:" + KEY_BASE,
    schemaCatalogDefaultVersion:"tm:queryEditor:schemaCatalogDefaultVersion_v1:" + KEY_BASE,
    schemaVersion: "tm:queryEditor:schemaVersion_v1:"    + KEY_BASE
  };

  // ===================================================================
  // TEMAS (5 opções)
  // ===================================================================
  var THEMES = [
    { id: "system",   label: "Tema: Sistema",   cm: null,              containerClass: "sql-theme-system"   },
    { id: "darkpro",  label: "Tema: Dark Pro",  cm: "material-darker", containerClass: "sql-theme-darkpro"  },
    { id: "lightsql", label: "Tema: Light SQL", cm: "eclipse",         containerClass: "sql-theme-lightsql" },
    { id: "dracula",  label: "Tema: Dracula",   cm: "dracula",         containerClass: "sql-theme-dracula"  },
    { id: "monokai",  label: "Tema: Monokai",   cm: "monokai",         containerClass: "sql-theme-monokai"  }
  ];

  var CM_THEME_CSS = {
    "material-darker": "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/material-darker.min.css",
    "eclipse":         "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/eclipse.min.css",
    "dracula":         "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/dracula.min.css",
    "monokai":         "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/monokai.min.css"
  };

  // ===================================================================
  // UTILITÁRIO: localStorage com tratamento de erros
  // ===================================================================
  var storage = {
    get: function (key) {
      try { return localStorage.getItem(key); } catch (_) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, value); } catch (_) {}
    },
    remove: function (key) {
      try { localStorage.removeItem(key); } catch (_) {}
    },
    getJson: function (key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    },
    setJson: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    },
    getNumber: function (key, fallback, allowedValues) {
      var raw = this.get(key);
      var n = raw === null ? NaN : Number(raw);
      if (!isFinite(n)) return fallback;
      if (allowedValues && allowedValues.indexOf(n) === -1) return fallback;
      return n;
    },
    getBool: function (key, fallback) {
      var raw = this.get(key);
      return raw === null ? fallback : raw === "on";
    },
    migrate: function () {
      var current = Number(this.get(KEYS.schemaVersion) || 0);
      if (current >= CFG.settingsVersion) return;
      this.set(KEYS.schemaVersion, String(CFG.settingsVersion));
    }
  };

  storage.migrate();

  // ===================================================================
  // ESTADO CENTRALIZADO
  // ===================================================================
  var state = {
    // Editor
    sqlEditor:          null,
    editorContainerEl:  null,
    editorStatsEl:      null,
    lintInfoEl:         null,
    schemaCatalogInfoEl:null,
    toolbarEl:          null,
    ribbonThemeSelect:  null,
    ribbonWarnSelect:   null,
    ribbonFallbackSelect: null,
    btnRibbonLint:      null,
    btnRibbonCollapse:  null,
    ribbonControls:     {},
    themeMode:          storage.get(KEYS.theme) || "system",
    lintEnabled:        storage.getBool(KEYS.lint, true),
    toolbarVisible:     storage.getBool(KEYS.toolbar, true),
    // Execução
    lastExecStart:      null,
    lastExecInterval:   null,
    lastExecElapsed:    null,
    execBox:            null,
    execMain:           null,
    execDetail:         null,
    execCloseBtn:       null,
    execProgressEl:     null,
    execProgressBar:    null,
    execIntervalId:     null,
    execHideTimer:      null,
    execFallbackTimer:   null,
    // Lint
    lintMarkers:        [],
    lintTimeout:        null,
    // Accordion
    accordionRootEl:    null,
    accordionHeaderEl:  null,
    accordionBodyEl:    null,
    accordionMetaEl:    null,
    accordionOpen:      true,
    // Botões do header
    btnHdrToolbar:      null,
    btnHdrMax:          null,
    // Modal
    modalOverlayEl:     null,
    modalWindowEl:      null,
    modalBodyEl:        null,
    modalSizeSelectEl:  null,
    modalIsOpen:        false,
    origAccordionParent: null,
    origAccordionNext:   null,
    // Painel de configurações
    settingsOverlayEl:  null,
    settingsWindowEl:   null,
    snippetsOverlayEl:  null,
    snippetEditorOverlayEl: null,
    snippetJsonOverlayEl: null,
    snippetStops:       [],
    snippetStopIndex:   -1,
    snippetEndMark:     null,
    // Restauração de seleção após execução parcial
    restoreAfterExec:   null,
    execOverrideText:   null,
    partialRestoreTimer: null,
    execEditorSnapshot: null,
    // Flags de inicialização
    cssInjected:        false,
    aspnetHooked:       false,
    editorInited:       false,
    startInProgress:    false,
    cmReady:            false,
    cmLoading:          false,
    cmCallbacks:        []
  };

  // ===================================================================
  // UTILITÁRIOS GERAIS
  // ===================================================================

  /**
   * Exibe uma notificação toast temporária na parte inferior da tela.
   * @param {string} message - Texto a ser exibido.
   */
  function showToast(message) {
    var toastEl = document.querySelector(".sql-toast");
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "sql-toast";
      Object.assign(toastEl.style, {
        position: "fixed", bottom: "16px", right: "16px",
        background: "rgba(40,40,40,0.9)", color: "#fafafa",
        padding: "6px 10px", borderRadius: "6px", fontSize: "12px",
        opacity: "0", transform: "translateY(8px)",
        transition: "all 0.2s ease-out", zIndex: "999999"
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    requestAnimationFrame(function () {
      toastEl.style.opacity = "1";
      toastEl.style.transform = "translateY(0)";
    });
    setTimeout(function () {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translateY(8px)";
    }, 1400);
  }

  /**
   * Retorna a hora atual no formato HH:MM:SS.
   * @returns {string}
   */
  function nowTime() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return String(n).padStart(2, "0"); })
      .join(":");
  }

  /**
   * Sanitiza uma string para uso como nome de arquivo.
   * @param {string} s - String de entrada.
   * @returns {string}
   */
  function sanitizeFilename(s) {
    var t = String(s || "consulta").trim()
      .replace(/[\r\n]+/g, " ")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return (t || "consulta").slice(0, 80);
  }

  function saveExecutionDraft(snapshot) {
    try {
      sessionStorage.setItem(KEYS.execDraft, JSON.stringify({
        savedAt: Date.now(),
        text: snapshot && snapshot.text ? snapshot.text : "",
        cursor: snapshot ? snapshot.cursor : null,
        selections: snapshot ? snapshot.selections : null,
        scrollLeft: snapshot ? snapshot.scrollLeft : 0,
        scrollTop: snapshot ? snapshot.scrollTop : 0
      }));
    } catch (_) {}
  }

  function consumeExecutionDraft() {
    try {
      var raw = sessionStorage.getItem(KEYS.execDraft);
      if (!raw) return null;
      sessionStorage.removeItem(KEYS.execDraft);
      var draft = JSON.parse(raw);
      if (!draft || !draft.savedAt || Date.now() - draft.savedAt > 10 * 60 * 1000) return null;
      return draft;
    } catch (_) {
      return null;
    }
  }

  /**
   * Retorna a definição de tema pelo ID, ou o primeiro tema (padrão) se não encontrado.
   * @param {string} id
   * @returns {object}
   */
  function getThemeDef(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  /**
   * Retorna o primeiro elemento que corresponde ao seletor, ou null.
   * Aceita múltiplos seletores separados por vírgula.
   * @param {string} selector
   * @returns {Element|null}
   */
  function qs(selector) {
    return document.querySelector(selector);
  }

  var PageAdapter = {
    getTextarea: function () {
      return qs(CFG.selectors.textarea);
    },
    getExecuteButton: function () {
      return qs(CFG.selectors.executeButton);
    }
  };

  function getStoredNumber(key, fallback, allowedValues) {
    return storage.getNumber(key, fallback, allowedValues);
  }

  function getExecWarnThresholdSeconds() {
    return getStoredNumber(KEYS.execWarn, CFG.execWarnThresholdSeconds, [5, 10, 15, 30, 60, 120]);
  }

  function getExecFallbackTimeoutSeconds() {
    return getStoredNumber(KEYS.execFallback, CFG.execFallbackTimeoutSeconds, [0, 30, 60, 120, 300]);
  }

  function getExecToastPosition() {
    var value = storage.get(KEYS.execToastPos) || "bottom-center";
    return ["bottom-left", "bottom-right", "top-left", "top-right", "top-center", "bottom-center"].indexOf(value) >= 0 ? value : "bottom-center";
  }

  function getExecToastTheme() {
    var value = storage.get(KEYS.execToastTheme) || "dark";
    return ["dark", "light", "office"].indexOf(value) >= 0 ? value : "dark";
  }

  function getExecToastSize() {
    var value = storage.get(KEYS.execToastSize) || "large";
    return ["compact", "normal", "large"].indexOf(value) >= 0 ? value : "large";
  }

  function getExecToastHideSeconds() {
    return getStoredNumber(KEYS.execToastHide, 2, [0, 1, 2, 4, 8]);
  }

  function getExecToastDetailsVisible() {
    return getStoredBool(KEYS.execToastDetail, true);
  }

  function getExecToastProgressVisible() {
    return getStoredBool(KEYS.execToastProgress, true);
  }

  function getAutoCollapseQueryAfterExec() {
    var raw = storage.get(KEYS.execCollapse);
    return raw === null ? CFG.autoCollapseQueryAfterExecDefault : raw === "on";
  }

  function getExecHistory() {
    var items = storage.getJson(KEYS.execHistory);
    if (!Array.isArray(items)) return [];
    return items
      .map(function (n) { return Number(n); })
      .filter(function (n) { return isFinite(n) && n >= 0; })
      .slice(0, 8);
  }

  function saveExecHistory(items) {
    storage.setJson(KEYS.execHistory, items.slice(0, 8));
  }

  function recordExecDuration(seconds) {
    var items = getExecHistory();
    items.unshift(Number(seconds) || 0);
    saveExecHistory(items);
    return items;
  }

  function getExecHistorySummary(items) {
    items = Array.isArray(items) ? items : getExecHistory();
    if (!items.length) return "";
    var recent = items.slice(0, 5).map(function (n) { return n.toFixed(2) + "s"; }).join(", ");
    var total = items.reduce(function (sum, n) { return sum + n; }, 0);
    var avg = total / items.length;
    return "Ultimos tempos: " + recent + " | Media: " + avg.toFixed(2) + "s";
  }

  function getExecTimeClass(seconds) {
    var warnAfter = getExecWarnThresholdSeconds();
    if (seconds >= warnAfter) return "sql-exec-box-warn";
    if (seconds >= Math.max(1, warnAfter / 2)) return "sql-exec-box-slow";
    return "sql-exec-box-ok";
  }

  function applyExecTimeClass(seconds) {
    if (!state.execBox) return;
    state.execBox.classList.remove("sql-exec-box-ok", "sql-exec-box-slow", "sql-exec-box-warn", "sql-exec-box-persistent");
    state.execBox.classList.add(getExecTimeClass(seconds));
  }

  function getStoredBool(key, fallback) {
    return storage.getBool(key, fallback);
  }

  var RIBBON_ITEMS = [
    { key: "exec",          label: "Executar Query" },
    { key: "execSel",       label: "Executar Seleção" },
    { key: "selectBlock",   label: "Selecionar Bloco" },
    { key: "timerWarn",     label: "Timer: alerta" },
    { key: "timerRestore",  label: "Timer: restaurar seleção" },
    { key: "autoCollapse",  label: "Timer: ocultar query" },
    { key: "clear",         label: "Limpar editor" },
    { key: "importSql",     label: "Importar .sql" },
    { key: "exportSql",     label: "Exportar .sql" },
    { key: "snippets",      label: "Snippets SQL" },
    { key: "lint",          label: "Lint" },
    { key: "theme",         label: "Tema" },
    { key: "settings",      label: "Config na ribbon" }
  ];

  var DEFAULT_RIBBON_ITEMS_VISIBLE = {
    timerRestore: false,
    settings: false
  };

  function getRibbonIconsVisible() {
    return getStoredBool(KEYS.ribbonIcons, false);
  }

  function getRibbonItemsVisibleMap() {
    var saved = storage.getJson(KEYS.ribbonItems) || {};
    var out = {};
    RIBBON_ITEMS.forEach(function (item) {
      var defaultVisible = DEFAULT_RIBBON_ITEMS_VISIBLE[item.key] !== false;
      out[item.key] = Object.prototype.hasOwnProperty.call(saved, item.key) ? saved[item.key] !== false : defaultVisible;
    });
    return out;
  }

  function setRibbonItemVisible(key, visible) {
    var map = getRibbonItemsVisibleMap();
    map[key] = !!visible;
    storage.setJson(KEYS.ribbonItems, map);
    applyRibbonDisplaySettings();
  }

  function applyRibbonDisplaySettings() {
    if (!state.toolbarEl) return;

    state.toolbarEl.classList.toggle("sql-hide-icons", !getRibbonIconsVisible());

    var map = getRibbonItemsVisibleMap();
    Object.keys(state.ribbonControls).forEach(function (key) {
      var el = state.ribbonControls[key];
      if (el) el.style.display = map[key] ? "" : "none";
    });

    state.toolbarEl.querySelectorAll(".sql-ribbon-group").forEach(function (group) {
      var visible = Array.prototype.some.call(group.children, function (child) {
        return child.style.display !== "none";
      });
      group.style.display = visible ? "" : "none";
    });
  }


  // ===================================================================
  // SNIPPETS SQL
  // ===================================================================
  var DEFAULT_SNIPPETS_VERSION = 1;
  var DEFAULT_SNIPPETS = [
    {
      "id": "custom_1782131743527_001_proc_cnj",
      "name": "Processo por número CNJ",
      "category": "01 - Processo e pasta",
      "description": "Consulta dados principais do processo pelo número CNJ, incluindo pasta, classe e indicadores de tramitação.",
      "tags": [
        "processo",
        "cnj",
        "classe",
        "diagnostico"
      ],
      "body": "SELECT\n    p.id AS processo_id,\n    p.numero,\n    p.pasta_id,\n    p.classe_id,\n    c.nome AS classe_nome,\n    p.eletronico_judiciario,\n    p.juizado_especial,\n    p.created_date,\n    p.created_by,\n    p.modified_date,\n    p.modified_by\nFROM att_processo.processo p\nLEFT JOIN att_processo.classe c\n    ON c.id = p.classe_id\nWHERE p.numero = :numero_processo -- ex: '2099666-32.2026.8.26.0000'",
      "native": false
    },
    {
      "id": "custom_1782131743527_002_pasta_nu",
      "name": "Pasta por número administrativo",
      "category": "01 - Processo e pasta",
      "description": "Localiza a pasta pelo número administrativo.",
      "tags": [
        "pasta",
        "numero",
        "diagnostico"
      ],
      "body": "SELECT\n    pa.id AS pasta_id,\n    pa.numero AS numero_pasta,\n    pa.created_date,\n    pa.created_by,\n    pa.modified_date,\n    pa.modified_by\nFROM att_processo.pasta pa\nWHERE pa.numero = :numero_pasta -- ex: '2022.01.000001'",
      "native": false
    },
    {
      "id": "custom_1782131743527_003_proc_pas",
      "name": "Processos dentro da pasta",
      "category": "01 - Processo e pasta",
      "description": "Lista os processos vinculados a uma pasta administrativa.",
      "tags": [
        "pasta",
        "processo",
        "vinculo"
      ],
      "body": "SELECT\n    p.id AS processo_id,\n    p.numero,\n    p.pasta_id,\n    p.classe_id,\n    p.created_date,\n    p.created_by\nFROM att_processo.processo p\nWHERE p.pasta_id = (\n    SELECT pa.id\n    FROM att_processo.pasta pa\n    WHERE pa.numero = :numero_pasta\n)\nORDER BY p.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_004_diag_pro",
      "name": "Diagnóstico rápido do processo",
      "category": "99 - Diagnóstico rápido",
      "description": "Visão consolidada do processo, classe, tramitação, procedimento e distribuição ativa.",
      "tags": [
        "processo",
        "distribuicao",
        "mesa",
        "unidade",
        "diagnostico"
      ],
      "body": "WITH proc AS (\n    SELECT\n        p.id AS processo_id,\n        p.numero,\n        p.pasta_id,\n        p.classe_id,\n        p.eletronico_judiciario,\n        p.juizado_especial\n    FROM att_processo.processo p\n    WHERE p.numero = :numero_processo\n)\nSELECT\n    proc.processo_id,\n    proc.numero,\n    proc.pasta_id,\n    c.nome AS classe_nome,\n    CASE\n        WHEN NVL(proc.eletronico_judiciario, 0) = 1 THEN 'ELETRONICO'\n        ELSE 'FISICO'\n    END AS tipo_tramitacao,\n    CASE\n        WHEN NVL(proc.juizado_especial, 0) = 1 THEN 'JUIZADO_ESPECIAL'\n        ELSE 'COMUM'\n    END AS tipo_procedimento,\n    d.id AS distribuicao_id,\n    d.local_distribuicao_id AS unidade_id,\n    unidade.nome AS unidade_nome,\n    d.local_id AS mesa_id,\n    mesa.nome AS mesa_nome,\n    d.usuario,\n    d.created_date AS data_distribuicao\nFROM proc\nLEFT JOIN att_processo.classe c\n    ON c.id = proc.classe_id\nLEFT JOIN att_distribuicao.distribuicao d\n    ON d.processo_id = proc.processo_id\n   AND d.tipo_objeto = 'PROCESSO'\n   AND d.data_estorno IS NULL\nLEFT JOIN att_security.local unidade\n    ON unidade.id = d.local_distribuicao_id\nLEFT JOIN att_security.local mesa\n    ON mesa.id = d.local_id\nORDER BY d.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_005_loc_proc",
      "name": "Localização atual do processo",
      "category": "02 - Distribuição",
      "description": "Consulta a distribuição ativa do processo, com unidade, mesa e usuário responsável.",
      "tags": [
        "processo",
        "distribuicao",
        "mesa",
        "unidade"
      ],
      "body": "SELECT\n    p.id AS processo_id,\n    p.numero,\n    d.id AS distribuicao_id,\n    d.local_distribuicao_id AS unidade_id,\n    unidade.nome AS unidade_nome,\n    d.local_id AS mesa_id,\n    mesa.nome AS mesa_nome,\n    d.usuario,\n    u.nome AS usuario_nome,\n    d.created_date,\n    d.created_by\nFROM att_processo.processo p\nJOIN att_distribuicao.distribuicao d\n    ON d.processo_id = p.id\nLEFT JOIN att_security.local unidade\n    ON unidade.id = d.local_distribuicao_id\nLEFT JOIN att_security.local mesa\n    ON mesa.id = d.local_id\nLEFT JOIN att_security.usuario u\n    ON u.username = d.usuario\nWHERE p.numero = :numero_processo\n  AND d.tipo_objeto = 'PROCESSO'\n  AND d.data_estorno IS NULL\nORDER BY d.created_date DESC\nFETCH FIRST 20 ROWS ONLY",
      "native": false
    },
    {
      "id": "custom_1782131743527_006_hist_dis",
      "name": "Histórico de distribuição por processo",
      "category": "02 - Distribuição",
      "description": "Lista o histórico de distribuição do processo, incluindo registros estornados.",
      "tags": [
        "processo",
        "distribuicao",
        "historico"
      ],
      "body": "SELECT\n    d.id AS distribuicao_id,\n    d.tipo_objeto,\n    d.objeto_id,\n    d.processo_id,\n    d.local_distribuicao_id AS unidade_id,\n    unidade.nome AS unidade_nome,\n    d.local_id AS mesa_id,\n    mesa.nome AS mesa_nome,\n    d.usuario,\n    d.created_date,\n    d.created_by,\n    d.data_estorno\nFROM att_distribuicao.distribuicao d\nLEFT JOIN att_security.local unidade\n    ON unidade.id = d.local_distribuicao_id\nLEFT JOIN att_security.local mesa\n    ON mesa.id = d.local_id\nWHERE d.processo_id = :processo_id\nORDER BY d.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_007_part_dem",
      "name": "Participantes de demanda",
      "category": "02 - Distribuição",
      "description": "Consulta participantes vinculados à distribuição de uma demanda.",
      "tags": [
        "demanda",
        "participante",
        "distribuicao"
      ],
      "body": "SELECT\n    d.id AS distribuicao_id,\n    d.objeto_id,\n    p.tipo_participacao_id,\n    tp.nome AS tipo_participacao,\n    tp.contemplatoria,\n    p.usuario,\n    u.nome AS usuario_nome,\n    p.local_id,\n    l.nome AS local_nome\nFROM att_distribuicao.distribuicao d\nJOIN att_distribuicao.participante p\n    ON p.distribuicao_id = d.id\nLEFT JOIN att_distribuicao.tipo_participacao tp\n    ON tp.id = p.tipo_participacao_id\nLEFT JOIN att_security.usuario u\n    ON u.username = p.usuario\nLEFT JOIN att_security.local l\n    ON l.id = p.local_id\nWHERE TRIM(d.objeto_id) = :demanda_id\nORDER BY p.tipo_participacao_id",
      "native": false
    },
    {
      "id": "custom_1782131743527_008_redist_u",
      "name": "Demandas redistribuídas por usuário em unidade",
      "category": "02 - Distribuição",
      "description": "Identifica demandas criadas ou redistribuídas por um usuário em determinada unidade.",
      "tags": [
        "demanda",
        "redistribuicao",
        "usuario",
        "unidade"
      ],
      "body": "SELECT\n    d.objeto_id AS demanda_id,\n    d.local_distribuicao_id AS unidade_id,\n    d.local_id AS mesa_id,\n    d.data_estorno,\n    d.created_by,\n    d.created_date\nFROM att_distribuicao.distribuicao d\nWHERE d.tipo_objeto = 'DEMANDA'\n  AND d.local_distribuicao_id = :unidade_id\n  AND d.created_date >= TO_DATE(:data_inicio, 'YYYY-MM-DD HH24:MI:SS')\n  AND LOWER(d.created_by) = LOWER(:username)\nORDER BY d.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_009_cad_user",
      "name": "Cadastro do usuário",
      "category": "04 - Usuário, lotação e regras",
      "description": "Consulta cadastro básico do usuário.",
      "tags": [
        "usuario",
        "cadastro",
        "acesso"
      ],
      "body": "SELECT\n    u.username,\n    u.nome,\n    u.enabled,\n    u.created_date,\n    u.created_by,\n    u.modified_date,\n    u.modified_by\nFROM att_security.usuario u\nWHERE LOWER(u.username) = LOWER(:username)",
      "native": false
    },
    {
      "id": "custom_1782131743527_010_lot_user",
      "name": "Lotações atuais do usuário",
      "category": "04 - Usuário, lotação e regras",
      "description": "Lista lotações ativas do usuário.",
      "tags": [
        "usuario",
        "lotacao",
        "local",
        "papel"
      ],
      "body": "SELECT\n    l.id AS lotacao_id,\n    l.usuario_lotado,\n    l.local_id,\n    loc.nome AS local_nome,\n    loc.tipo_local_id,\n    l.papel_id,\n    p.nome AS papel_nome,\n    l.data_inicial,\n    l.data_final,\n    l.created_date,\n    l.created_by\nFROM att_security.lotacao l\nLEFT JOIN att_security.local loc\n    ON loc.id = l.local_id\nLEFT JOIN att_security.papel p\n    ON p.id = l.papel_id\nWHERE LOWER(l.usuario_lotado) = LOWER(:username)\n  AND l.data_final IS NULL\nORDER BY loc.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_011_user_reg",
      "name": "Usuário em regras de recebimento",
      "category": "04 - Usuário, lotação e regras",
      "description": "Verifica se o usuário está vinculado a regras de recebimento/distribuição.",
      "tags": [
        "usuario",
        "regra",
        "recebimento",
        "distribuicao"
      ],
      "body": "SELECT\n    rtu.regra_recebimento_id,\n    rr.nome AS regra_nome,\n    rr.tipo AS tipo_regra,\n    rr.local_id AS unidade_id,\n    l.nome AS unidade_nome,\n    rtu.usuario,\n    rr.data_inicial,\n    rr.data_final\nFROM att_distribuicao.regra_tem_usuario rtu\nJOIN att_distribuicao.regra_recebimento rr\n    ON rr.id = rtu.regra_recebimento_id\nLEFT JOIN att_security.local l\n    ON l.id = rr.local_id\nWHERE LOWER(rtu.usuario) = LOWER(:username)\nORDER BY rr.local_id, rr.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_012_regras_u",
      "name": "Regras ativas por unidade",
      "category": "04 - Usuário, lotação e regras",
      "description": "Lista regras ativas de uma unidade.",
      "tags": [
        "regra",
        "unidade",
        "distribuicao"
      ],
      "body": "SELECT\n    rr.id AS regra_recebimento_id,\n    rr.nome AS regra_nome,\n    rr.tipo AS tipo_regra,\n    rr.local_id AS unidade_id,\n    l.nome AS unidade_nome,\n    rr.data_inicial,\n    rr.data_final,\n    rr.created_date,\n    rr.created_by\nFROM att_distribuicao.regra_recebimento rr\nLEFT JOIN att_security.local l\n    ON l.id = rr.local_id\nWHERE rr.local_id = :unidade_id\n  AND rr.data_final IS NULL\nORDER BY rr.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_013_reg_ta",
      "name": "Regra por tipo de andamento",
      "category": "04 - Usuário, lotação e regras",
      "description": "Verifica regras vinculadas a tipos de andamento específicos em uma unidade.",
      "tags": [
        "regra",
        "tipo_andamento",
        "unidade"
      ],
      "body": "SELECT\n    rr.local_id AS unidade_id,\n    l.nome AS unidade_nome,\n    rr.id AS regra_recebimento_id,\n    rr.nome AS regra_nome,\n    rr.tipo AS tipo_regra,\n    rr.data_inicial,\n    rr.data_final,\n    rtta.tipo_andamento_id,\n    ta.nome AS tipo_andamento_nome\nFROM att_distribuicao.regra_recebimento rr\nJOIN att_security.local l\n    ON l.id = rr.local_id\nJOIN att_distribuicao.regra_tem_tipo_andamento rtta\n    ON rtta.regra_recebimento_id = rr.id\nJOIN att_processo.tipo_andamento ta\n    ON ta.id = rtta.tipo_andamento_id\nWHERE rr.local_id = :unidade_id\n  AND rr.data_final IS NULL\n  AND rtta.tipo_andamento_id IN (:tipo_andamento_id)\nORDER BY rr.nome, ta.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_014_tipo_and",
      "name": "Buscar tipo de andamento por nome",
      "category": "05 - Andamento, documento e BPMN",
      "description": "Pesquisa tipo de andamento pelo nome.",
      "tags": [
        "andamento",
        "tipo_andamento",
        "busca"
      ],
      "body": "SELECT\n    ta.id AS tipo_andamento_id,\n    ta.nome,\n    ta.origem,\n    ta.created_date,\n    ta.modified_date\nFROM att_processo.tipo_andamento ta\nWHERE UPPER(ta.nome) LIKE UPPER(:nome_tipo_andamento) -- ex: '%INTIMACAO%'\nORDER BY ta.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_015_bpmn_ta",
      "name": "BPMN por tipo de andamento",
      "category": "05 - Andamento, documento e BPMN",
      "description": "Verifica o BPMN configurado para um tipo de andamento.",
      "tags": [
        "andamento",
        "bpmn",
        "flow_starter"
      ],
      "body": "SELECT\n    fs.id,\n    fs.tipo_andamento_id,\n    ta.nome AS tipo_andamento_nome,\n    fs.bpmn,\n    fs.created_date,\n    fs.modified_date\nFROM att_demanda.flow_starter fs\nJOIN att_processo.tipo_andamento ta\n    ON ta.id = fs.tipo_andamento_id\nWHERE fs.tipo_andamento_id = :tipo_andamento_id\nORDER BY fs.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_016_doc_and",
      "name": "Tipo de documento vinculado ao andamento",
      "category": "05 - Andamento, documento e BPMN",
      "description": "Consulta vínculo entre tipo de documento, tipo de andamento e BPMN.",
      "tags": [
        "documento",
        "tipo_documento",
        "andamento",
        "bpmn"
      ],
      "body": "SELECT\n    td.id AS tipo_documento_id,\n    td.nome AS tipo_documento_nome,\n    tdta.tipo_andamento_id,\n    ta.nome AS tipo_andamento_nome,\n    fs.bpmn\nFROM att_documento.tipo_documento td\nLEFT JOIN att_documento.tipo_documento_tipo_andamento tdta\n    ON tdta.tipo_documento_id = td.id\nLEFT JOIN att_processo.tipo_andamento ta\n    ON ta.id = tdta.tipo_andamento_id\nLEFT JOIN att_demanda.flow_starter fs\n    ON fs.tipo_andamento_id = tdta.tipo_andamento_id\nWHERE UPPER(td.nome) LIKE UPPER(:nome_tipo_documento)\nORDER BY td.nome, ta.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_017_ands_pro",
      "name": "Andamentos do processo",
      "category": "05 - Andamento, documento e BPMN",
      "description": "Lista andamentos de um processo pelo ID.",
      "tags": [
        "andamento",
        "processo",
        "historico"
      ],
      "body": "SELECT\n    a.id AS andamento_id,\n    a.processo_id,\n    a.tipo_andamento_id,\n    ta.nome AS tipo_andamento_nome,\n    a.origem,\n    a.business_key,\n    a.identificador_na_pasta,\n    a.created_date,\n    a.created_by,\n    a.modified_date,\n    a.modified_by\nFROM att_processo.andamento a\nLEFT JOIN att_processo.tipo_andamento ta\n    ON ta.id = a.tipo_andamento_id\nWHERE a.processo_id = :processo_id\nORDER BY a.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_018_dem_id",
      "name": "Demanda por ID",
      "category": "03 - Demanda e Camunda",
      "description": "Consulta dados básicos da demanda.",
      "tags": [
        "demanda",
        "camunda",
        "diagnostico"
      ],
      "body": "SELECT\n    d.id AS demanda_id,\n    d.pasta_processo_id,\n    d.local_id AS mesa_id,\n    mesa.nome AS mesa_nome,\n    d.local_distribuicao_id AS unidade_id,\n    unidade.nome AS unidade_nome,\n    d.tipo_demanda,\n    d.situacao,\n    d.created_date,\n    d.created_by,\n    d.modified_date,\n    d.modified_by\nFROM att_demanda.demanda d\nLEFT JOIN att_security.local mesa\n    ON mesa.id = d.local_id\nLEFT JOIN att_security.local unidade\n    ON unidade.id = d.local_distribuicao_id\nWHERE d.id = :demanda_id",
      "native": false
    },
    {
      "id": "custom_1782131743527_019_hist_cam",
      "name": "Histórico Camunda da demanda",
      "category": "03 - Demanda e Camunda",
      "description": "Consulta tarefas históricas da demanda pelo ID da task ou instância.",
      "tags": [
        "demanda",
        "camunda",
        "act_hi_taskinst"
      ],
      "body": "SELECT\n    t.id_ AS task_id,\n    t.name_ AS nome_tarefa,\n    t.assignee_,\n    t.start_time_,\n    t.end_time_,\n    t.delete_reason_,\n    t.proc_inst_id_\nFROM att_demanda.act_hi_taskinst t\nWHERE t.id_ = :demanda_id\n   OR t.proc_inst_id_ = :proc_inst_id\nORDER BY t.start_time_ DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_020_flux_dem",
      "name": "Fluxo percorrido pela demanda",
      "category": "03 - Demanda e Camunda",
      "description": "Lista atividades percorridas no fluxo Camunda.",
      "tags": [
        "demanda",
        "camunda",
        "act_hi_actinst",
        "bpmn"
      ],
      "body": "SELECT\n    a.proc_def_id_ AS nome_bpmn_versao,\n    a.sequence_counter_ AS sequencia,\n    a.act_id_,\n    a.act_type_,\n    a.act_name_,\n    a.task_id_,\n    a.assignee_,\n    a.start_time_,\n    a.end_time_,\n    a.duration_\nFROM att_demanda.act_hi_actinst a\nWHERE a.proc_inst_id_ = :proc_inst_id\nORDER BY a.sequence_counter_",
      "native": false
    },
    {
      "id": "custom_1782131743527_021_pub_proc",
      "name": "Publicação por número do processo",
      "category": "06 - Publicação e Integrajud",
      "description": "Consulta publicações recebidas pelo número do processo.",
      "tags": [
        "publicacao",
        "processo",
        "tribunal"
      ],
      "body": "SELECT\n    p.id AS publicacao_id,\n    p.numero_processo,\n    p.tribunal_id,\n    p.data_disponibilizacao,\n    p.data_publicacao,\n    p.regra_descarte_id,\n    p.data_descarte,\n    p.created_date,\n    p.created_by\nFROM att_publicacao.publicacao p\nWHERE p.numero_processo = :numero_processo\nORDER BY p.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_022_aj_proc",
      "name": "Andamento judicial recebido",
      "category": "06 - Publicação e Integrajud",
      "description": "Consulta andamento judicial recebido pela integração.",
      "tags": [
        "integrajud",
        "andamento_judicial",
        "intimacao"
      ],
      "body": "SELECT\n    aj.id AS andamento_judicial_id,\n    aj.numero_processo,\n    aj.processo_id,\n    aj.tipo,\n    aj.origem_id,\n    aj.data_disponibilizacao,\n    aj.data_termino_carencia,\n    aj.data_ciencia,\n    aj.business_key,\n    aj.created_date,\n    aj.created_by\nFROM att_integrajud.andamento_judicial aj\nWHERE aj.numero_processo = :numero_processo\nORDER BY aj.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_023_doc_jud",
      "name": "Documento judicial sincronizado",
      "category": "06 - Publicação e Integrajud",
      "description": "Lista documentos judiciais sincronizados para um processo.",
      "tags": [
        "integrajud",
        "documento_judicial",
        "sincronizacao"
      ],
      "body": "SELECT\n    dj.id AS documento_judicial_id,\n    dj.processo_id,\n    dj.documento_integracao_id,\n    dj.andamento_attornatus_id,\n    dj.created_date,\n    dj.created_by\nFROM att_integrajud.documento_judicial dj\nWHERE dj.processo_id = :processo_id\nORDER BY dj.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_024_cham_msg",
      "name": "Chamada Integrajud por mensagem",
      "category": "06 - Publicação e Integrajud",
      "description": "Consulta chamada de serviço da integração judicial pelo ID da mensagem.",
      "tags": [
        "integrajud",
        "chamada_servico",
        "mensagem"
      ],
      "body": "SELECT\n    cs.*\nFROM att_integrajud.chamada_servico cs\nWHERE cs.mensagem_id = :mensagem_id\nORDER BY cs.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_025_prot_err",
      "name": "Protocolo com erro por usuário",
      "category": "07 - Protocolo e tribunal",
      "description": "Consulta protocolos com erro por usuário a partir de uma data.",
      "tags": [
        "protocolo",
        "erro",
        "usuario",
        "tribunal"
      ],
      "body": "SELECT\n    prot.id AS protocolo_id,\n    prot.processo_id,\n    prot.status,\n    prot.created_by,\n    prot.created_date,\n    prot.modified_date,\n    prot.mensagem\nFROM att_integrajud.protocolo prot\nWHERE LOWER(prot.created_by) = LOWER(:username)\n  AND prot.status = 'ERRO'\n  AND prot.modified_date >= TO_DATE(:data_inicio, 'YYYY-MM-DD HH24:MI:SS')\nORDER BY prot.modified_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_026_prot_pro",
      "name": "Protocolos por processo",
      "category": "07 - Protocolo e tribunal",
      "description": "Consulta protocolos vinculados ao processo.",
      "tags": [
        "protocolo",
        "processo",
        "integrajud"
      ],
      "body": "SELECT\n    prot.id AS protocolo_id,\n    prot.processo_id,\n    prot.status,\n    prot.created_by,\n    prot.created_date,\n    prot.modified_date,\n    prot.mensagem\nFROM att_integrajud.protocolo prot\nWHERE prot.processo_id = :processo_id\nORDER BY prot.modified_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_027_trib_int",
      "name": "Tribunais com integração ativa",
      "category": "07 - Protocolo e tribunal",
      "description": "Lista integrações judiciais com URL configurada.",
      "tags": [
        "tribunal",
        "integracao",
        "integrajud"
      ],
      "body": "SELECT\n    i.id,\n    i.nome,\n    i.tribunal_id,\n    i.url\nFROM att_integrajud.integracao i\nWHERE i.url IS NOT NULL\nORDER BY i.tribunal_id, i.id",
      "native": false
    },
    {
      "id": "custom_1782131743527_028_cda_num",
      "name": "CDA por número",
      "category": "08 - Dívida ativa e SDA",
      "description": "Consulta dívida/CDA pelo número.",
      "tags": [
        "cda",
        "divida",
        "sda"
      ],
      "body": "SELECT\n    d.id AS divida_id,\n    d.numero,\n    d.identificador_no_cliente,\n    d.devedor_id,\n    d.categoria_id,\n    d.data_prescricao,\n    d.created_date,\n    d.created_by,\n    d.modified_date,\n    d.modified_by\nFROM att_divida.divida d\nWHERE d.numero = :numero_cda",
      "native": false
    },
    {
      "id": "custom_1782131743527_029_aj_cda",
      "name": "Ajuizamento da CDA",
      "category": "08 - Dívida ativa e SDA",
      "description": "Consulta ajuizamentos vinculados a uma dívida.",
      "tags": [
        "cda",
        "ajuizamento",
        "divida"
      ],
      "body": "SELECT\n    a.id AS ajuizamento_id,\n    a.divida_id,\n    a.numero_judicial,\n    a.data_ajuizamento,\n    a.lote_processamento_id,\n    a.created_date,\n    a.created_by\nFROM att_divida.ajuizamento a\nWHERE a.divida_id = :divida_id\nORDER BY a.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_030_rem_aj",
      "name": "Remoção de ajuizamento",
      "category": "08 - Dívida ativa e SDA",
      "description": "Consulta registros de ajuizamento removido para uma dívida.",
      "tags": [
        "cda",
        "desajuizamento",
        "ajuizamento_removido"
      ],
      "body": "SELECT\n    ar.id AS ajuizamento_removido_id,\n    ar.divida_id,\n    ar.data_ajuizamento,\n    ar.created_date,\n    ar.created_by,\n    ar.motivo\nFROM att_divida.ajuizamento_removido ar\nWHERE ar.divida_id = :divida_id\nORDER BY ar.created_date DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_031_sda_cham",
      "name": "Chamada SDA por identificador da dívida",
      "category": "08 - Dívida ativa e SDA",
      "description": "Consulta chamadas de serviço SDA associadas ao identificador da dívida.",
      "tags": [
        "sda",
        "chamada_servico",
        "divida",
        "cda"
      ],
      "body": "SELECT\n    cda.numero,\n    cda.id AS divida_id,\n    cda.identificador_no_cliente,\n    cs.id AS chamada_servico_id,\n    cs.servico,\n    cs.created_date,\n    cs.created_by,\n    cs.status,\n    cs.mensagem\nFROM att_divida.chamada_servico cs\nJOIN att_divida.chamada_servico_tem_divida_identificador_no_cliente csd\n    ON csd.chamada_servico_id = cs.id\nJOIN att_divida.divida cda\n    ON cda.identificador_no_cliente = csd.identificador_divida\nWHERE cs.servico = :servico\n  AND csd.identificador_divida = :identificador_divida\nORDER BY cs.id DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_032_cat_agr",
      "name": "Categoria permite agrupamento CDA",
      "category": "08 - Dívida ativa e SDA",
      "description": "Verifica se a categoria da dívida permite agrupamento em kit de ajuizamento.",
      "tags": [
        "cda",
        "categoria",
        "agrupamento",
        "ajuizamento"
      ],
      "body": "SELECT\n    d.numero,\n    d.id AS divida_id,\n    c.id AS categoria_id,\n    c.nome AS categoria_nome,\n    c.permite_agrupamento_kit_ajuizamento\nFROM att_divida.divida d\nJOIN att_divida.categoria c\n    ON c.id = d.categoria_id\nWHERE d.numero IN (:numeros_cda)\nORDER BY d.numero",
      "native": false
    },
    {
      "id": "custom_1782131743527_033_param_id",
      "name": "Parâmetro por ID",
      "category": "09 - Parâmetros e configuração",
      "description": "Consulta parâmetro de configuração por ID.",
      "tags": [
        "parametro",
        "configuracao"
      ],
      "body": "SELECT\n    cp.parametro_id,\n    cp.valor,\n    cp.instituicao_id,\n    cp.created_date,\n    cp.created_by,\n    cp.modified_date,\n    cp.modified_by\nFROM att_admin.configuracao_parametro cp\nWHERE cp.parametro_id = :parametro_id\nORDER BY cp.instituicao_id",
      "native": false
    },
    {
      "id": "custom_1782131743527_034_param_te",
      "name": "Buscar parâmetro por termo",
      "category": "09 - Parâmetros e configuração",
      "description": "Pesquisa parâmetros por parte do nome.",
      "tags": [
        "parametro",
        "configuracao",
        "busca"
      ],
      "body": "SELECT\n    cp.parametro_id,\n    cp.valor,\n    cp.instituicao_id,\n    cp.modified_date,\n    cp.modified_by\nFROM att_admin.configuracao_parametro cp\nWHERE UPPER(cp.parametro_id) LIKE UPPER(:termo) -- ex: '%DESCARTE%'\nORDER BY cp.parametro_id",
      "native": false
    },
    {
      "id": "custom_1782131743527_035_aud_id",
      "name": "Auditoria por identificador",
      "category": "10 - Auditoria",
      "description": "Consulta alterações auditadas por identificador de entidade.",
      "tags": [
        "auditoria",
        "rastreabilidade",
        "alteracao"
      ],
      "body": "SELECT\n    a.data_transacao,\n    ai.valor AS identificador,\n    aa.valor_antigo,\n    aa.valor_novo,\n    a.usuario,\n    aa.atributo_id,\n    a.id AS auditoria_id\nFROM att_auditoria.auditoria a\nJOIN att_auditoria.auditoria_entidade ae\n    ON ae.auditoria_id = a.id\nJOIN att_auditoria.auditoria_identificacao ai\n    ON ai.auditoria_entidade_id = ae.id\nJOIN att_auditoria.auditoria_atributo aa\n    ON aa.auditoria_entidade_id = ae.id\nWHERE ai.valor LIKE :identificador\nORDER BY a.data_transacao DESC\nFETCH FIRST 100 ROWS ONLY",
      "native": false
    },
    {
      "id": "custom_1782131743527_036_login_us",
      "name": "Últimos acessos do usuário",
      "category": "10 - Auditoria",
      "description": "Consulta os últimos acessos do usuário no sistema.",
      "tags": [
        "auditoria",
        "login",
        "usuario",
        "acesso"
      ],
      "body": "SELECT\n    rl.username,\n    rl.data,\n    rl.ip,\n    rl.user_agent\nFROM att_auditoria.registro_login rl\nWHERE LOWER(rl.username) = LOWER(:username)\nORDER BY rl.data DESC\nFETCH FIRST 10 ROWS ONLY",
      "native": false
    },
    {
      "id": "custom_1782131743527_037_classes",
      "name": "Listar classes",
      "category": "11 - Classes e assuntos",
      "description": "Lista classes processuais cadastradas.",
      "tags": [
        "classe",
        "processo"
      ],
      "body": "SELECT\n    c.id,\n    c.nome,\n    c.codigo,\n    c.created_date,\n    c.modified_date\nFROM att_processo.classe c\nORDER BY c.nome",
      "native": false
    },
    {
      "id": "custom_1782131743527_038_classes_",
      "name": "Classes efetivamente usadas",
      "category": "11 - Classes e assuntos",
      "description": "Lista classes com total de processos vinculados.",
      "tags": [
        "classe",
        "processo",
        "contagem"
      ],
      "body": "SELECT\n    c.id,\n    c.nome,\n    COUNT(*) AS total_processos\nFROM att_processo.processo p\nJOIN att_processo.classe c\n    ON c.id = p.classe_id\nWHERE p.data_cancelamento IS NULL\nGROUP BY\n    c.id,\n    c.nome\nORDER BY total_processos DESC",
      "native": false
    },
    {
      "id": "custom_1782131743527_039_ass_past",
      "name": "Assunto institucional da pasta",
      "category": "11 - Classes e assuntos",
      "description": "Consulta assuntos institucionais vinculados a uma pasta.",
      "tags": [
        "assunto",
        "pasta",
        "processo"
      ],
      "body": "SELECT\n    pa.id AS pasta_id,\n    pa.numero AS numero_pasta,\n    ai.id AS assunto_id,\n    ai.nome AS assunto_nome\nFROM att_processo.pasta pa\nJOIN att_processo.pasta_tem_assunto_instituicao pti\n    ON pti.pasta_id = pa.id\nJOIN att_processo.assunto_instituicao ai\n    ON ai.id = pti.assunto_id\nWHERE pa.numero = :numero_pasta\nORDER BY ai.nome",
      "native": false
    }
  ];
  var SNIPPET_CATEGORIES = [
    "01 - Processo e pasta",
    "02 - Distribuição",
    "03 - Demanda e Camunda",
    "04 - Usuário, lotação e regras",
    "05 - Andamento, documento e BPMN",
    "06 - Publicação e Integrajud",
    "07 - Protocolo e tribunal",
    "08 - Dívida ativa e SDA",
    "09 - Parâmetros e configuração",
    "10 - Auditoria",
    "11 - Classes e assuntos",
    "99 - Diagnóstico rápido"
  ];

  function cloneSnippet(snippet) {
    return {
      id: String(snippet.id),
      name: String(snippet.name || "Snippet"),
      category: normalizeSnippetCategory(snippet.category),
      description: String(snippet.description || ""),
      tags: Array.isArray(snippet.tags) ? snippet.tags.slice(0, 12) : [],
      body: String(snippet.body || ""),
      native: false
    };
  }

  function normalizeSnippetCategory(category) {
    category = String(category || "");
    return SNIPPET_CATEGORIES.indexOf(category) >= 0 ? category : SNIPPET_CATEGORIES[0];
  }

  function ensureDefaultSnippets() {
    var installedVersion = Number(storage.get(KEYS.snippetDefaultsVersion) || 0);
    if (installedVersion >= DEFAULT_SNIPPETS_VERSION) return;

    var existing = storage.getJson(KEYS.customSnippets);
    var merged = DEFAULT_SNIPPETS.map(function (snippet) {
      return cloneSnippet(snippet);
    });

    if (Array.isArray(existing)) {
      existing.forEach(function (snippet) {
        if (!snippet || !snippet.id || !snippet.body) return;
        var copy = cloneSnippet(snippet);
        var index = merged.findIndex(function (current) { return current.id === copy.id; });
        if (index >= 0) merged[index] = copy;
        else merged.push(copy);
      });
    }

    var validIds = Object.create(null);
    merged.forEach(function (snippet) { validIds[snippet.id] = true; });
    var savedFavorites = storage.getJson(KEYS.snippetFavorites);
    storage.setJson(KEYS.customSnippets, merged);
    storage.setJson(KEYS.snippetFavorites, Array.isArray(savedFavorites) ? savedFavorites.filter(function (id) {
      return !/^native_\d+$/.test(id) && validIds[id];
    }) : []);
    storage.set(KEYS.snippetDefaultsVersion, String(DEFAULT_SNIPPETS_VERSION));
  }

  function customSnippets(){
    ensureDefaultSnippets();
    var saved=storage.getJson(KEYS.customSnippets);
    if(!Array.isArray(saved))return[];
    var changed=false;
    var normalized=saved.map(function(snippet){
      var category=normalizeSnippetCategory(snippet&&snippet.category);
      if(snippet&&snippet.category===category)return snippet;
      changed=true;
      var copy=Object.assign({},snippet||{});
      copy.category=category;
      return copy;
    });
    if(changed)storage.setJson(KEYS.customSnippets,normalized);
    return normalized;
  }
  function favorites(){ensureDefaultSnippets();var x=storage.getJson(KEYS.snippetFavorites);return Array.isArray(x)?x:[];}
  function allSnippets(){return customSnippets();}
  function getSnippetCardSettings() {
    var saved = storage.getJson(KEYS.snippetCardSettings) || {};
    return {
      density: saved.density === "compact" ? "compact" : "comfortable",
      columns: [1, 2, 3].indexOf(Number(saved.columns)) >= 0 ? Number(saved.columns) : 2,
      showDescription: saved.showDescription !== false,
      showTags: saved.showTags !== false,
      previewLines: [0, 4, 8, 12].indexOf(Number(saved.previewLines)) >= 0 ? Number(saved.previewLines) : 8
    };
  }
  function saveSnippetCardSettings(settings) {
    storage.setJson(KEYS.snippetCardSettings, settings);
  }
  function setSnippetFavorite(id, enabled) {
    var saved = favorites();
    var index = saved.indexOf(id);
    if (enabled && index < 0) saved.push(id);
    if (!enabled && index >= 0) saved.splice(index, 1);
    storage.setJson(KEYS.snippetFavorites, saved);
  }
  function clearAllSnippets() {
    if (!confirm("Excluir todos os snippets e favoritos? Esta ação não pode ser desfeita.")) return false;
    storage.setJson(KEYS.customSnippets, []);
    storage.setJson(KEYS.snippetFavorites, []);
    showToast("Biblioteca de snippets limpa");
    return true;
  }
  function restoreDefaultSnippets() {
    if (!confirm("Restaurar os 39 snippets padrão ATTUS N2? Os snippets atuais serão substituídos.")) return false;
    storage.setJson(KEYS.customSnippets, DEFAULT_SNIPPETS.map(cloneSnippet));
    storage.setJson(KEYS.snippetFavorites, []);
    storage.set(KEYS.snippetDefaultsVersion, String(DEFAULT_SNIPPETS_VERSION));
    showToast("Catálogo padrão restaurado");
    return true;
  }
  function clearSnippetStops(){state.snippetStops.forEach(function(x){try{x.clear();}catch(_){}});state.snippetStops=[];state.snippetStopIndex=-1;if(state.snippetEndMark){try{state.snippetEndMark.clear();}catch(_){}state.snippetEndMark=null;}}
  function parseSnippet(body,selection){var out="",stops=[],end=null,last=0,re=/\$\{([A-Z0-9_]+)(?::([^}]*))?\}/gi,m;while((m=re.exec(body))){out+=body.slice(last,m.index);var n=m[1].toUpperCase(),v=m[2]!==undefined?m[2]:n;if(n==="SELECAO")v=selection||v;if(n==="CURSOR"){end=out.length;v="";}var a=out.length;out+=v;if(n!=="CURSOR"&&v)stops.push([a,out.length]);last=re.lastIndex;}out+=body.slice(last);return{text:out,stops:stops,end:end===null?out.length:end};}
  function selectSnippetStop(i){if(!state.snippetStops.length)return false;i=Math.max(0,Math.min(i,state.snippetStops.length-1));var f=state.snippetStops[i].find();if(!f)return false;state.snippetStopIndex=i;state.sqlEditor.getDoc().setSelection(f.from,f.to);return true;}
  function snippetTab(cm,back){if(!state.snippetStops.length)return CodeMirror.Pass;var n=state.snippetStopIndex+(back?-1:1);if(n<0)n=0;if(n>=state.snippetStops.length){var p=state.snippetEndMark&&state.snippetEndMark.find();clearSnippetStops();if(p)cm.getDoc().setCursor(p);return;}selectSnippetStop(n);}
  function insertSnippet(x){clearSnippetStops();var d=state.sqlEditor.getDoc(),f=d.getCursor("from"),t=d.getCursor("to"),r=parseSnippet(x.body,d.getSelection()),base=d.indexFromPos(f);state.sqlEditor.operation(function(){d.replaceRange(r.text,f,t,"+snippet");r.stops.forEach(function(q){state.snippetStops.push(d.markText(d.posFromIndex(base+q[0]),d.posFromIndex(base+q[1]),{className:"sql-snippet-placeholder",inclusiveLeft:true,inclusiveRight:true}));});state.snippetEndMark=d.setBookmark(d.posFromIndex(base+r.end));});closeSnippets();if(!selectSnippetStop(0)){var p=state.snippetEndMark.find();clearSnippetStops();if(p)d.setCursor(p);}state.sqlEditor.focus();}
  function closeSnippetEditor() {
    if (state.snippetEditorOverlayEl) state.snippetEditorOverlayEl.remove();
    state.snippetEditorOverlayEl = null;
  }

  function normalizeSnippetCollection(value) {
    var source = Array.isArray(value) ? value : value && value.snippets;
    if (!Array.isArray(source)) throw new Error("A propriedade 'snippets' deve ser uma lista.");
    var ids = Object.create(null);
    var snippets = source.map(function (snippet, index) {
      if (!snippet || typeof snippet !== "object") throw new Error("Snippet " + (index + 1) + " inválido.");
      var normalized = cloneSnippet({
        id: snippet.id || "custom_" + Date.now() + "_" + index,
        name: snippet.name,
        category: snippet.category,
        description: snippet.description,
        tags: snippet.tags,
        body: snippet.body
      });
      if (!normalized.name.trim()) throw new Error("Snippet " + (index + 1) + " sem nome.");
      if (!normalized.body.trim()) throw new Error("Snippet '" + normalized.name + "' sem código SQL.");
      if (ids[normalized.id]) throw new Error("ID duplicado: " + normalized.id);
      if (SNIPPET_CATEGORIES.indexOf(String(snippet.category || "")) < 0) {
        throw new Error("Categoria inválida em '" + normalized.name + "'. Use uma das categorias fixas.");
      }
      ids[normalized.id] = true;
      return normalized;
    });
    var requestedFavorites = !Array.isArray(value) && Array.isArray(value.favorites) ? value.favorites : [];
    var normalizedFavorites = requestedFavorites.filter(function (id, index, list) {
      return ids[id] && list.indexOf(id) === index;
    });
    return { snippets: snippets, favorites: normalizedFavorites };
  }

  function closeSnippetJsonEditor() {
    if (state.snippetJsonOverlayEl) state.snippetJsonOverlayEl.remove();
    state.snippetJsonOverlayEl = null;
  }

  function openSnippetJsonEditor() {
    closeSnippetJsonEditor();
    var overlay = document.createElement("div");
    overlay.className = "tm-modal-ov tm-snippet-json-overlay";
    var dialog = document.createElement("div");
    dialog.className = "tm-snippet-json-editor";
    var header = document.createElement("div");
    header.className = "tm-snippet-editor-head";
    var title = document.createElement("strong");
    title.textContent = "Editar JSON dos snippets";
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Fechar";
    closeButton.addEventListener("click", closeSnippetJsonEditor, true);
    header.appendChild(title);
    header.appendChild(closeButton);

    var body = document.createElement("div");
    body.className = "tm-snippet-json-body";
    var help = document.createElement("p");
    help.textContent = "Edite snippets e favoritos. IDs devem ser únicos e a categoria precisa pertencer à lista fixa.";
    var categoriesHelp = document.createElement("details");
    var categoriesSummary = document.createElement("summary");
    categoriesSummary.textContent = "Ver categorias permitidas";
    var categoriesList = document.createElement("div");
    categoriesList.className = "tm-snippet-json-categories";
    categoriesList.textContent = SNIPPET_CATEGORIES.join(" | ");
    categoriesHelp.appendChild(categoriesSummary);
    categoriesHelp.appendChild(categoriesList);
    var textarea = document.createElement("textarea");
    textarea.spellcheck = false;
    textarea.value = JSON.stringify({ snippets: customSnippets(), favorites: favorites() }, null, 2);
    var error = document.createElement("div");
    error.className = "tm-snippet-json-error";
    error.hidden = true;
    body.appendChild(help);
    body.appendChild(categoriesHelp);
    body.appendChild(textarea);
    body.appendChild(error);

    var footer = document.createElement("div");
    footer.className = "tm-snippet-editor-footer";
    var formatButton = document.createElement("button");
    formatButton.type = "button";
    formatButton.textContent = "Formatar JSON";
    formatButton.addEventListener("click", function () {
      try {
        textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
        error.hidden = true;
      } catch (exception) {
        error.textContent = "JSON inválido: " + exception.message;
        error.hidden = false;
      }
    }, true);
    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.addEventListener("click", closeSnippetJsonEditor, true);
    var saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = "Validar e salvar";
    saveButton.addEventListener("click", function () {
      try {
        var normalized = normalizeSnippetCollection(JSON.parse(textarea.value));
        storage.setJson(KEYS.customSnippets, normalized.snippets);
        storage.setJson(KEYS.snippetFavorites, normalized.favorites);
        closeSnippetJsonEditor();
        openSnippets();
        showToast("JSON dos snippets atualizado");
      } catch (exception) {
        error.textContent = exception.message || "JSON inválido.";
        error.hidden = false;
      }
    }, true);
    footer.appendChild(formatButton);
    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closeSnippetJsonEditor();
    }, true);
    document.body.appendChild(overlay);
    state.snippetJsonOverlayEl = overlay;
    textarea.focus();
  }

  function editSnippet(item) {
    closeSnippetEditor();

    var overlay = document.createElement("div");
    overlay.className = "tm-modal-ov tm-snippet-editor-overlay";
    var dialog = document.createElement("div");
    dialog.className = "tm-snippet-editor";

    var header = document.createElement("div");
    header.className = "tm-snippet-editor-head";
    var title = document.createElement("strong");
    title.textContent = item ? "Editar snippet" : "Novo snippet";
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Fechar";
    closeButton.addEventListener("click", closeSnippetEditor, true);
    header.appendChild(title);
    header.appendChild(closeButton);

    var form = document.createElement("div");
    form.className = "tm-snippet-editor-form";

    function createField(labelText, control) {
      var field = document.createElement("label");
      var label = document.createElement("span");
      label.textContent = labelText;
      field.appendChild(label);
      field.appendChild(control);
      return field;
    }

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 80;
    nameInput.value = item ? item.name : "";

    var categoryInput = document.createElement("select");
    SNIPPET_CATEGORIES.forEach(function (category) {
      var option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categoryInput.appendChild(option);
    });
    categoryInput.value = normalizeSnippetCategory(item && item.category);

    var descriptionInput = document.createElement("textarea");
    descriptionInput.className = "tm-snippet-description";
    descriptionInput.maxLength = 240;
    descriptionInput.value = item ? (item.description || "") : "";

    var tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.value = item && Array.isArray(item.tags) ? item.tags.join(", ") : "";
    tagsInput.placeholder = "consulta, relatório, suporte";

    var favoriteInput = document.createElement("input");
    favoriteInput.type = "checkbox";
    favoriteInput.checked = item ? favorites().indexOf(item.id) >= 0 : false;
    var favoriteField = document.createElement("label");
    favoriteField.className = "tm-snippet-favorite-field";
    favoriteField.appendChild(favoriteInput);
    favoriteField.appendChild(document.createTextNode(" Marcar como favorito"));

    var bodyInput = document.createElement("textarea");
    bodyInput.className = "tm-snippet-code";
    var selectedSql = state.sqlEditor ? state.sqlEditor.getDoc().getSelection() : "";
    bodyInput.value = item ? item.body : (selectedSql || "SELECT\n    ${COLUNAS:*}\nFROM ${TABELA}\nWHERE ${CONDICAO:1 = 1}${CURSOR}");

    var help = document.createElement("div");
    help.className = "tm-snippet-editor-help";
    help.textContent = "Placeholders: ${CAMPO}, ${CAMPO:valor padrão}, ${SELECAO} e ${CURSOR}.";

    form.appendChild(createField("Nome", nameInput));
    form.appendChild(createField("Categoria", categoryInput));
    form.appendChild(createField("Descrição", descriptionInput));
    form.appendChild(createField("Tags separadas por vírgula", tagsInput));
    form.appendChild(favoriteField);
    form.appendChild(createField("Código SQL", bodyInput));
    form.appendChild(help);

    var footer = document.createElement("div");
    footer.className = "tm-snippet-editor-footer";
    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.addEventListener("click", closeSnippetEditor, true);
    var saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = item ? "Salvar alterações" : "Criar snippet";
    saveButton.addEventListener("click", function () {
      var name = nameInput.value.trim();
      var body = bodyInput.value;
      if (!name) {
        nameInput.focus();
        return alert("Informe o nome do snippet.");
      }
      if (!body.trim()) {
        bodyInput.focus();
        return alert("Informe o código SQL do snippet.");
      }

      var saved = customSnippets();
      var updated = {
        id: item ? item.id : "custom_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: name,
        category: normalizeSnippetCategory(categoryInput.value),
        description: descriptionInput.value.trim(),
        tags: tagsInput.value.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean).slice(0, 12),
        body: body,
        native: false
      };
      var index = saved.findIndex(function (snippet) { return snippet.id === updated.id; });
      if (index >= 0) saved[index] = updated;
      else saved.push(updated);
      storage.setJson(KEYS.customSnippets, saved);
      setSnippetFavorite(updated.id, favoriteInput.checked);
      closeSnippetEditor();
      openSnippets();
      showToast(item ? "Snippet atualizado" : "Snippet criado");
    }, true);

    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);
    dialog.appendChild(header);
    dialog.appendChild(form);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closeSnippetEditor();
    }, true);

    var pageForm = PageAdapter.getTextarea() ? PageAdapter.getTextarea().closest("form") : null;
    (pageForm || document.body).appendChild(overlay);
    state.snippetEditorOverlayEl = overlay;
    setTimeout(function () { nameInput.focus(); }, 0);
  }

  function deleteSnippet(item) {
    if (!item || item.native) return;
    if (!confirm("Excluir permanentemente o snippet '" + item.name + "'?")) return;
    storage.setJson(KEYS.customSnippets, customSnippets().filter(function (snippet) {
      return snippet.id !== item.id;
    }));
    storage.setJson(KEYS.snippetFavorites, favorites().filter(function (id) {
      return id !== item.id;
    }));
    openSnippets();
    showToast("Snippet excluído");
  }
  function toggleFavorite(id){setSnippetFavorite(id,favorites().indexOf(id)<0);}
  function downloadBlob(filename, blob) {
    if (navigator.msSaveOrOpenBlob) {
      navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
  }
  function exportSnippets(){downloadBlob("editor-query-snippets.json",new Blob([JSON.stringify({snippets:customSnippets(),favorites:favorites()},null,2)],{type:"application/json"}));}
  function importSnippets(file){if(!file)return;var r=new FileReader();r.onload=function(){try{var normalized=normalizeSnippetCollection(JSON.parse(r.result));storage.setJson(KEYS.customSnippets,normalized.snippets);storage.setJson(KEYS.snippetFavorites,normalized.favorites);openSnippets();showToast("Snippets importados");}catch(exception){alert(exception.message||"JSON inválido.");}};r.readAsText(file,"UTF-8");}
  function closeSnippets(){if(state.snippetsOverlayEl)state.snippetsOverlayEl.remove();state.snippetsOverlayEl=null;}
  function openSnippets() {
    closeSnippets();

    var overlay = document.createElement("div");
    overlay.className = "tm-modal-ov";
    var windowEl = document.createElement("div");
    windowEl.className = "tm-snippets-win";
    var header = document.createElement("div");
    header.className = "tm-snippets-head";
    var title = document.createElement("strong");
    title.textContent = "Snippets SQL";
    var actions = document.createElement("div");
    var search = document.createElement("input");
    var category = document.createElement("select");
    var favoritesOnly = document.createElement("input");
    var list = document.createElement("div");
    var fileInput = document.createElement("input");
    var settingsPanel = document.createElement("section");

    function button(text, handler, className) {
      var element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      if (className) element.className = className;
      element.addEventListener("click", handler, true);
      return element;
    }
    function option(value, label) {
      var element = document.createElement("option");
      element.value = String(value);
      element.textContent = label;
      return element;
    }
    function settingRow(labelText, control) {
      var row = document.createElement("label");
      var label = document.createElement("span");
      label.textContent = labelText;
      row.appendChild(label);
      row.appendChild(control);
      return row;
    }

    search.type = "search";
    search.placeholder = "Buscar por nome, categoria, tag ou SQL";
    favoritesOnly.type = "checkbox";
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.style.display = "none";
    list.className = "tm-snippets-list";
    settingsPanel.className = "tm-snippets-settings";
    settingsPanel.hidden = true;

    var settings = getSnippetCardSettings();
    var density = document.createElement("select");
    density.appendChild(option("comfortable", "Confortável"));
    density.appendChild(option("compact", "Compacto"));
    density.value = settings.density;
    var columns = document.createElement("select");
    columns.appendChild(option(1, "1 coluna"));
    columns.appendChild(option(2, "2 colunas"));
    columns.appendChild(option(3, "3 colunas"));
    columns.value = String(settings.columns);
    var previewLines = document.createElement("select");
    previewLines.appendChild(option(0, "Ocultar código"));
    previewLines.appendChild(option(4, "4 linhas"));
    previewLines.appendChild(option(8, "8 linhas"));
    previewLines.appendChild(option(12, "12 linhas"));
    previewLines.value = String(settings.previewLines);
    var showDescription = document.createElement("input");
    showDescription.type = "checkbox";
    showDescription.checked = settings.showDescription;
    var showTags = document.createElement("input");
    showTags.type = "checkbox";
    showTags.checked = settings.showTags;

    var settingsHeader = document.createElement("div");
    settingsHeader.className = "tm-snippets-settings-head";
    var settingsTitle = document.createElement("strong");
    settingsTitle.textContent = "Configurações dos snippets";
    settingsHeader.appendChild(settingsTitle);
    settingsHeader.appendChild(button("Fechar", function () { settingsPanel.hidden = true; }));
    var settingsGrid = document.createElement("div");
    settingsGrid.className = "tm-snippets-settings-grid";
    settingsGrid.appendChild(settingRow("Densidade dos cards", density));
    settingsGrid.appendChild(settingRow("Colunas", columns));
    settingsGrid.appendChild(settingRow("Prévia do código", previewLines));
    settingsGrid.appendChild(settingRow("Exibir descrição", showDescription));
    settingsGrid.appendChild(settingRow("Exibir tags", showTags));
    var danger = document.createElement("div");
    danger.className = "tm-snippets-settings-danger";
    danger.appendChild(button("Restaurar catálogo padrão", function () {
      if (restoreDefaultSnippets()) render();
    }));
    danger.appendChild(button("Limpar tudo", function () {
      if (clearAllSnippets()) render();
    }, "danger"));
    settingsPanel.appendChild(settingsHeader);
    settingsPanel.appendChild(settingsGrid);
    settingsPanel.appendChild(danger);

    function persistCardSettings() {
      settings = {
        density: density.value,
        columns: Number(columns.value),
        previewLines: Number(previewLines.value),
        showDescription: showDescription.checked,
        showTags: showTags.checked
      };
      saveSnippetCardSettings(settings);
      render();
    }
    [density, columns, previewLines, showDescription, showTags].forEach(function (control) {
      control.addEventListener("change", persistCardSettings, true);
    });

    fileInput.addEventListener("change", function () { importSnippets(fileInput.files[0]); }, true);
    actions.appendChild(button("Novo", function () { editSnippet(null); }));
    actions.appendChild(button("Importar", function () { fileInput.click(); }));
    actions.appendChild(button("Exportar", exportSnippets));
    actions.appendChild(button("Editar JSON", openSnippetJsonEditor));
    actions.appendChild(button("Configurações", function () { settingsPanel.hidden = !settingsPanel.hidden; }));
    actions.appendChild(button("Fechar", closeSnippets));
    actions.appendChild(fileInput);
    header.appendChild(title);
    header.appendChild(actions);

    var tools = document.createElement("div");
    tools.className = "tm-snippets-tools";
    var favoritesLabel = document.createElement("label");
    favoritesLabel.appendChild(favoritesOnly);
    favoritesLabel.appendChild(document.createTextNode(" Somente favoritos"));
    tools.appendChild(search);
    tools.appendChild(category);
    tools.appendChild(favoritesLabel);

    function render() {
      var snippets = allSnippets();
      var savedFavorites = favorites();
      var categories = ["Todas"].concat(SNIPPET_CATEGORIES);
      var selectedCategory = category.value || "Todas";
      category.innerHTML = "";
      categories.forEach(function (item) { category.appendChild(option(item, item)); });
      category.value = categories.indexOf(selectedCategory) >= 0 ? selectedCategory : "Todas";

      list.innerHTML = "";
      list.dataset.density = settings.density;
      list.style.gridTemplateColumns = "repeat(" + settings.columns + ", minmax(0, 1fr))";
      var query = search.value.trim().toLowerCase();
      var filtered = snippets.filter(function (snippet) {
        var haystack = [snippet.name, snippet.category, snippet.description, (snippet.tags || []).join(" "), snippet.body].join(" ").toLowerCase();
        return (category.value === "Todas" || snippet.category === category.value) &&
          (!favoritesOnly.checked || savedFavorites.indexOf(snippet.id) >= 0) &&
          (!query || haystack.indexOf(query) >= 0);
      });

      if (!filtered.length) {
        var empty = document.createElement("div");
        empty.className = "tm-snippets-empty";
        empty.textContent = snippets.length ? "Nenhum snippet encontrado." : "A biblioteca está vazia. Crie um snippet ou restaure o catálogo padrão.";
        list.appendChild(empty);
        return;
      }

      filtered.forEach(function (snippet) {
        var card = document.createElement("article");
        card.className = "tm-snippet-card";
        var cardHeader = document.createElement("div");
        cardHeader.className = "tm-snippet-card-head";
        var cardTitle = document.createElement("strong");
        cardTitle.textContent = snippet.name;
        var categoryLabel = document.createElement("span");
        categoryLabel.textContent = snippet.category;
        cardHeader.appendChild(cardTitle);
        cardHeader.appendChild(categoryLabel);
        card.appendChild(cardHeader);

        if (settings.showDescription && snippet.description) {
          var description = document.createElement("p");
          description.className = "tm-snippet-card-description";
          description.textContent = snippet.description;
          card.appendChild(description);
        }
        if (settings.showTags && Array.isArray(snippet.tags) && snippet.tags.length) {
          var tags = document.createElement("div");
          tags.className = "tm-snippet-card-tags";
          snippet.tags.forEach(function (tag) {
            var badge = document.createElement("span");
            badge.textContent = tag;
            tags.appendChild(badge);
          });
          card.appendChild(tags);
        }
        if (settings.previewLines > 0) {
          var preview = document.createElement("pre");
          preview.textContent = snippet.body;
          preview.style.maxHeight = (settings.previewLines * 16 + 12) + "px";
          card.appendChild(preview);
        }

        var cardActions = document.createElement("div");
        cardActions.className = "tm-snippet-card-actions";
        var isFavorite = savedFavorites.indexOf(snippet.id) >= 0;
        var favoriteButton = button(isFavorite ? "★ Favorito" : "☆ Favoritar", function () {
          toggleFavorite(snippet.id);
          render();
        }, isFavorite ? "favorite active" : "favorite");
        favoriteButton.title = isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos";
        cardActions.appendChild(favoriteButton);
        cardActions.appendChild(button(state.sqlEditor.getDoc().somethingSelected() ? "Substituir seleção" : "Inserir", function () {
          insertSnippet(snippet);
        }));
        cardActions.appendChild(button("Editar", function () { editSnippet(snippet); }));
        cardActions.appendChild(button("Excluir", function () { deleteSnippet(snippet); }));
        card.appendChild(cardActions);
        list.appendChild(card);
      });
    }

    search.addEventListener("input", render, true);
    category.addEventListener("change", render, true);
    favoritesOnly.addEventListener("change", render, true);
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closeSnippets();
    }, true);
    windowEl.appendChild(header);
    windowEl.appendChild(settingsPanel);
    windowEl.appendChild(tools);
    windowEl.appendChild(list);
    overlay.appendChild(windowEl);
    var pageForm = PageAdapter.getTextarea() ? PageAdapter.getTextarea().closest("form") : null;
    (pageForm || document.body).appendChild(overlay);
    state.snippetsOverlayEl = overlay;
    render();
    search.focus();
  }

  // ===================================================================
  // EXPORTAR .SQL
  // ===================================================================
  function exportQueryAsSql() {
    if (!state.sqlEditor) return alert("Editor ainda não carregou.");
    var text = state.sqlEditor.getDoc().getValue() || "";
    if (!text.trim()) return alert("Query vazia. Nada para exportar.");

    var firstLine = (text.split(/\r?\n/)[0] || "").replace(/--.*$/g, "").trim();
    var base = sanitizeFilename(firstLine || "consulta");
    var stamp = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, "");
    var filename = base + "_" + stamp + ".sql";

    try {
      var blob = new Blob([text], { type: "application/sql;charset=utf-8" });
      downloadBlob(filename, blob);
      showToast("Exportado: " + filename);
    } catch (_) {
      alert("Falha ao exportar .sql (possível bloqueio do navegador).");
    }
  }

  function importQueryFromSqlFile(file) {
    if (!state.sqlEditor) return alert("Editor ainda não carregou.");
    if (!file) return;
    if (!/\.sql$/i.test(file.name || "")) {
      return alert("Selecione um arquivo .sql.");
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = String(reader.result || "");
        var doc = state.sqlEditor.getDoc();
        if (doc.getValue().trim() && !confirm("Substituir o conteúdo atual pelo arquivo importado?")) return;
        doc.setValue(text);
        doc.setCursor({ line: 0, ch: 0 });
        state.sqlEditor.save();
        state.sqlEditor.focus();
        updateStats();
        showToast("Importado: " + file.name);
      } catch (_) {
        alert("Falha ao importar o arquivo .sql.");
      }
    };
    reader.onerror = function () {
      alert("Não foi possível ler o arquivo .sql.");
    };
    reader.readAsText(file, "UTF-8");
  }

  // ===================================================================
  // AUTOCOMPLETE POR CATALOGO JSON
  // ===================================================================
  var SQL_HINT_KEYWORDS = [
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "INNER JOIN", "GROUP BY",
    "ORDER BY", "HAVING", "INSERT", "UPDATE", "DELETE", "AND", "OR", "IN",
    "EXISTS", "BETWEEN", "LIKE", "IS NULL", "IS NOT NULL", "COUNT", "SUM",
    "MAX", "MIN", "AVG", "DISTINCT"
  ];

  var DEFAULT_SCHEMA_CATALOG_VERSION = "2026-07-15.02";
  var DEFAULT_SCHEMA_CATALOG = {"version":1,"source":"embedded","importedAt":"2026-07-15T00:00:00.000Z","tables":[{"schema":"ATT_SMS","name":"SMS","fullName":"ATT_SMS.SMS","columns":["ID","INSTITUICAO_ID","TELEFONE","PESSOA_ID","MENSAGEM","DATA_ENVIO","STATUS","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SMS","name":"SEQUENCE","fullName":"ATT_SMS.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_SMS","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_SMS.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_ADMIN","name":"ALERTA","fullName":"ATT_ADMIN.ALERTA","columns":["ID","NOME","MENSAGEM","TIPO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_ENCERRAMENTO"]},{"schema":"ATT_ADMIN","name":"SEQUENCE","fullName":"ATT_ADMIN.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_ADMIN","name":"PARAMETRO","fullName":"ATT_ADMIN.PARAMETRO","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DESCRICAO"]},{"schema":"ATT_ADMIN","name":"DEAD_LETTER","fullName":"ATT_ADMIN.DEAD_LETTER","columns":["ID","TOPICO","CONSUMER","MENSAGEM","CHAVE","INSTITUICAO_ID","CORRELATION_ID","USUARIO","ACAO","PARTICAO","OFF_SET","EXCEPTION_FQCN","EXCEPTION_MESSAGE","EXCEPTION_STACKTRACE","DATA_ERRO","CREATED_DATE","HASH","QUANTIDADE_TENTATIVAS","HISTORICO_TENTATIVAS","DATA_PROXIMA_RETENTATIVA","TOKEN"]},{"schema":"ATT_ADMIN","name":"ERRO_FRONTEND","fullName":"ATT_ADMIN.ERRO_FRONTEND","columns":["ID","NOME","MENSAGEM","URL","USER_AGENT","RESPONSE","REQUEST_URL","CREATED_DATE","CREATED_BY","INSTITUICAO_ID","STACK"]},{"schema":"ATT_ADMIN","name":"ALERTA_TEM_LOCAL","fullName":"ATT_ADMIN.ALERTA_TEM_LOCAL","columns":["ALERTA_ID","LOCAL_ID"]},{"schema":"ATT_ADMIN","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_ADMIN.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_ADMIN","name":"ALERTA_TEM_INSTITUICAO","fullName":"ATT_ADMIN.ALERTA_TEM_INSTITUICAO","columns":["ALERTA_ID","INSTITUICAO_ID"]},{"schema":"ATT_ADMIN","name":"CONFIGURACAO_PARAMETRO","fullName":"ATT_ADMIN.CONFIGURACAO_PARAMETRO","columns":["ID","PARAMETRO_ID","INSTITUICAO_ID","LOCAL_ID","USUARIO","VALOR","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","COMPLEMENTO"]},{"schema":"ATT_ADMIN","name":"DEAD_LETTER_TEM_HEADER","fullName":"ATT_ADMIN.DEAD_LETTER_TEM_HEADER","columns":["DEAD_LETTER_ID","CHAVE","VALOR"]},{"schema":"ATT_ADMIN","name":"PARAMETRO_FUNCIONALIDADE","fullName":"ATT_ADMIN.PARAMETRO_FUNCIONALIDADE","columns":["PARAMETRO_ID","FUNCIONALIDADE_ID"]},{"schema":"ATT_ATENA","name":"PROMPT","fullName":"ATT_ATENA.PROMPT","columns":["ID","NOME","VALOR","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID","TAG"]},{"schema":"ATT_ATENA","name":"ANALISE","fullName":"ATT_ATENA.ANALISE","columns":["ID","ANDAMENTO_ID","ORIGEM_ID","DOCUMENTO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TRIBUNAL_ID","POLO_REPRESENTADO","CLASSE_ID","MATERIA_ID","UNIDADE_JUDICIAL_ID","PROCESSO_ID","HASH","TIPO","PASTA_ID"]},{"schema":"ATT_ATENA","name":"SEQUENCE","fullName":"ATT_ATENA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_ATENA","name":"GERACAO_LLM","fullName":"ATT_ATENA.GERACAO_LLM","columns":["ID","TEXTO_GERADO","CONFIGURACAO_PROMPT_ID","PROMPT_CUSTOMIZADO","QUANTIDADE_INPUT_TOKENS","QUANTIDADE_OUTPUT_TOKENS","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID","ANALISE_ID","SERVICO_LLM_ID"]},{"schema":"ATT_ATENA","name":"SERVICO_LLM","fullName":"ATT_ATENA.SERVICO_LLM","columns":["ID","NOME","PROVEDOR","PARAMETROS","CONTADOR","PENSAMENTO","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","OBSOLETO"]},{"schema":"ATT_ATENA","name":"INTERACAO_CHAT","fullName":"ATT_ATENA.INTERACAO_CHAT","columns":["ID","CHAVE","GERACAO_LLM_ID","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","OBSOLETO"]},{"schema":"ATT_ATENA","name":"STATUS_ANALISE","fullName":"ATT_ATENA.STATUS_ANALISE","columns":["ID","ANALISE_ID","ETAPA","DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_ATENA","name":"ENTIDADES_ANALISE","fullName":"ATT_ATENA.ENTIDADES_ANALISE","columns":["ID","ANALISE_ID","CHAVE","VALOR","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CONFIANCA","STATUS"]},{"schema":"ATT_ATENA","name":"ITEM_PROCESSAMENTO","fullName":"ATT_ATENA.ITEM_PROCESSAMENTO","columns":["ID","LOTE_PROCESSAMENTO_ID","ANALISE_ID","DATA_TERMINO_PROCESSAMENTO","DESCRICAO_ERRO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_ATENA","name":"LOTE_PROCESSAMENTO","fullName":"ATT_ATENA.LOTE_PROCESSAMENTO","columns":["ID","TIPO_ANALISE","QUANTIDADE","QUANTIDADE_ERROS","DATA_TERMINO_PROCESSAMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_ATENA","name":"REGRA_RESUMO_PASTA","fullName":"ATT_ATENA.REGRA_RESUMO_PASTA","columns":["ID","DESCRICAO","ASSUNTO_INSTITUICAO_ID","MATERIA_ID","CLASSE_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_ATENA","name":"CONFIGURACAO_PROMPT","fullName":"ATT_ATENA.CONFIGURACAO_PROMPT","columns":["ID","FLUXO_IA","USUARIO","TIPO_ANDAMENTO_ID","LOCAL_DISTRIBUICAO_PROCESSO_ID","ASSUNTO_INSTITUICAO_ID","MATERIA_ID","CLASSE_ID","UNIDADE_JUDICIAL_ID","TRIBUNAL_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DESCRICAO","OBSOLETO","INSTITUICAO_ID","SERVICO_LLM_ID","TIPO_DOCUMENTO_ID","ESQUEMA_RETORNO_LLM_ID"]},{"schema":"ATT_ATENA","name":"ESQUEMA_RETORNO_LLM","fullName":"ATT_ATENA.ESQUEMA_RETORNO_LLM","columns":["ID","DESCRICAO","ESQUEMA","INSTITUICAO_ID","OBSOLETO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_ATENA","name":"MODELO_CONHECIMENTO","fullName":"ATT_ATENA.MODELO_CONHECIMENTO","columns":["ID","TIPO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CHAVE_API","CHAVE_MODELO","DESCRICAO","CLASSE_ID","MATERIA_ID","UNIDADE_JUDICIAL_ID","TRIBUNAL_ID","TIPO_PROCESSAMENTO_DOCUMENTO","SERVICO"]},{"schema":"ATT_ATENA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_ATENA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_ATENA","name":"DESCRICAO_CLASSIFICACAO","fullName":"ATT_ATENA.DESCRICAO_CLASSIFICACAO","columns":["ID","CATEGORIA_ID","TIPO","DESCRICAO","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NOME"]},{"schema":"ATT_ATENA","name":"CONFIGURACAO_PROMPT_TEM_PROMPT","fullName":"ATT_ATENA.CONFIGURACAO_PROMPT_TEM_PROMPT","columns":["CONFIGURACAO_PROMPT_ID","PROMPT_ID"]},{"schema":"ATT_ATENA","name":"REGRA_RESUMO_PASTA_TEM_TIPO_ANDAMENTO","fullName":"ATT_ATENA.REGRA_RESUMO_PASTA_TEM_TIPO_ANDAMENTO","columns":["TIPO_ANDAMENTO_ID","REGRA_RESUMO_PASTA_ID"]},{"schema":"ATT_ATENA","name":"MODELO_CONHECIMENTO_DESCRICAO_CLASSIFICACAO","fullName":"ATT_ATENA.MODELO_CONHECIMENTO_DESCRICAO_CLASSIFICACAO","columns":["MODELO_CONHECIMENTO_ID","DESCRICAO_CLASSIFICACAO_ID"]},{"schema":"ATT_DIVIDA","name":"ERRO","fullName":"ATT_DIVIDA.ERRO","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DIVIDA","name":"DEFESA","fullName":"ATT_DIVIDA.DEFESA","columns":["ID","INSTITUICAO_ID","TIPO","DATA_INICIO","DATA_FIM","VALOR_IMPOSTO","VALOR_MULTA","VALOR_JUROS","VALOR_SALDO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CATEGORIA"]},{"schema":"ATT_DIVIDA","name":"DIVIDA","fullName":"ATT_DIVIDA.DIVIDA","columns":["ID","INSTITUICAO_ID","NUMERO","DEVEDOR_ID","ENDERECO_ID","CATEGORIA_ID","TIPO_ORIGEM","TRIBUTO_ID","INFRACAO_ID","SITUACAO_ATUAL_ID","PARCELAMENTO_ATUAL_ID","DATA_BASE","CAPITULACAO_CORRECAO","CAPITULACAO_JUROS","CAPITULACAO_MULTA","FATO","DATA_ATUALIZACAO_VALORES","DATA_CIENCIA_FATO","DATA_INSCRICAO","DATA_PRESCRICAO","IDENTIFICADOR_NO_CLIENTE","NUMERO_BEM_FATO","NUMERO_DOCUMENTO_FATO","FOLHA","LIVRO","SERIE","PROCESSO_INSCRICAO","VALOR_CORRECAO_ATUAL","VALOR_CORRECAO_FATO","VALOR_CORRECAO_IMPOSTO_ATUAL","VALOR_CORRECAO_IMPOSTO_FATO","VALOR_CORRECAO_IMPOSTO_INSCRICAO","VALOR_CORRECAO_INSCRICAO","VALOR_CORRECAO_MULTA_ATUAL","VALOR_CORRECAO_MULTA_FATO","VALOR_CORRECAO_MULTA_INSCRICAO","VALOR_IMPOSTO_ATUAL","VALOR_IMPOSTO_FATO","VALOR_IMPOSTO_INSCRICAO","VALOR_JUROS_ATUAL","VALOR_JUROS_FATO","VALOR_JUROS_IMPOSTO_ATUAL","VALOR_JUROS_IMPOSTO_FATO","VALOR_JUROS_IMPOSTO_INSCRICAO","VALOR_JUROS_INSCRICAO","VALOR_JUROS_MULTA_ATUAL","VALOR_JUROS_MULTA_FATO","VALOR_JUROS_MULTA_INSCRICAO","VALOR_MULTA_ATUAL","VALOR_MULTA_FATO","VALOR_MULTA_INSCRICAO","VALOR_TOTAL_ATUAL","VALOR_TOTAL_FATO","VALOR_TOTAL_INSCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PROTESTO_ID","HASH","ORGAO_ORIGEM_ID","MODALIDADE_ID","CAPITULACAO_INFRACAO","NOME_ID","VALOR_MULTA_PUNITIVA_ATUAL","VALOR_CORRECAO_MULTA_PUNITIVA_ATUAL","VALOR_JUROS_MULTA_PUNITIVA_ATUAL","VALOR_HONORARIOS_ATUAL","VALOR_MULTA_MORATORIA_ATUAL","VALOR_MULTA_ATRASO_ATUAL","DATA_SINCRONIZACAO","MOTIVO_REMOCAO","DATA_REMOCAO","NATUREZA","HASH_RETIFICACAO","DATA_LANCAMENTO","DATA_CONSTITUICAO_CREDITO","VALOR_HONORARIOS_HISTORICO","EXIGIBILIDADE_CREDITO_SUSPENSO","VALOR_CUSTAS_ATUAL","VALOR_TAXA_ATUAL","NEGATIVADA","DATA_NEGATIVACAO","SUSPENSAO_IRREGULARIDADE","NUMERO_ORIGEM","DATA_INICIO_SUSPENSAO","DATA_FIM_SUSPENSAO","DIVIDA_SUBSTITUTA_ID","ENCARGOS_INSCRICAO"]},{"schema":"ATT_DIVIDA","name":"SERVICO","fullName":"ATT_DIVIDA.SERVICO","columns":["ID","INTEGRACAO_ID","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PATH_MAPPING","STREAM_MAPPING","ENCONDING_CORPO","QUEBRA_LINHA","IGNORAR_CABECALHO","ROTA","URL","XSLT_ENVIO","XSLT_RETORNO","XML_ENCAPSULADO_ELEMENTO_RAIZ","XPATH_RETORNO_HAS_ERRO_VALIDADOR","UNMARSHAL_TYPE","TIPO_PROTOCOLO","XPATH_CODIGO_RETORNO","XPATH_MENSAGEM_RETORNO","XPATH_XML_ENCAPSULADO","METODO_HTTP","TIPO_RESPOSTA","NOME_HEADER_AUTENTICACAO","XSLT_ASSINATURA","NOME_BEAN","HEADER"]},{"schema":"ATT_DIVIDA","name":"TRIBUTO","fullName":"ATT_DIVIDA.TRIBUTO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","ASSUNTO_INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ASSUNTO_CNJ_ID"]},{"schema":"ATT_DIVIDA","name":"INFRACAO","fullName":"ATT_DIVIDA.INFRACAO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"SEQUENCE","fullName":"ATT_DIVIDA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_DIVIDA","name":"CATEGORIA","fullName":"ATT_DIVIDA.CATEGORIA","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PERMITE_AGRUPAMENTO_KIT_AJUIZAMENTO"]},{"schema":"ATT_DIVIDA","name":"EXERCICIO","fullName":"ATT_DIVIDA.EXERCICIO","columns":["ID","DIVIDA_ID","ANO","VENCIMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DIVIDA","name":"FAKE_NAME","fullName":"ATT_DIVIDA.FAKE_NAME","columns":["ID","GIVENNAME","MIDDLEINITIAL","SURNAME","DATA_UTILIZACAO"]},{"schema":"ATT_DIVIDA","name":"COMPOSICAO","fullName":"ATT_DIVIDA.COMPOSICAO","columns":["ID","DIVIDA_ID","NUMERO","TRIBUTO_ID","INFRACAO_ID","PARCELA","FATO","DATA_BASE","CAPITULACAO_CORRECAO","CAPITULACAO_INFRACAO","CAPITULACAO_JUROS","CAPITULACAO_MULTA","DATA_ATUALIZACAO_VALORES","DATA_INSCRICAO","DATA_VENCIMENTO_FATO","FOLHA","LIVRO","SERIE","VALOR_CORRECAO_ATUAL","VALOR_CORRECAO_FATO","VALOR_CORRECAO_IMPOSTO_ATUAL","VALOR_CORRECAO_IMPOSTO_FATO","VALOR_CORRECAO_IMPOSTO_INSCRICAO","VALOR_CORRECAO_INSCRICAO","VALOR_CORRECAO_MULTA_ATUAL","VALOR_CORRECAO_MULTA_FATO","VALOR_CORRECAO_MULTA_INSCRICAO","VALOR_IMPOSTO_ATUAL","VALOR_IMPOSTO_FATO","VALOR_IMPOSTO_INSCRICAO","INDICE_CALCULO","VALOR_JUROS_ATUAL","VALOR_JUROS_FATO","VALOR_JUROS_IMPOSTO_ATUAL","VALOR_JUROS_IMPOSTO_FATO","VALOR_JUROS_IMPOSTO_INSCRICAO","VALOR_JUROS_INSCRICAO","VALOR_JUROS_MULTA_ATUAL","VALOR_JUROS_MULTA_FATO","VALOR_JUROS_MULTA_INSCRICAO","VALOR_MULTA_ATUAL","VALOR_MULTA_FATO","VALOR_MULTA_INSCRICAO","VALOR_TOTAL_ATUAL","VALOR_TOTAL_CORRECAO_INSCRICAO","VALOR_TOTAL_FATO","VALOR_TOTAL_IMPOSTO_INSCRICAO","VALOR_TOTAL_INSCRICAO","VALOR_TOTAL_JUROS_INSCRICAO","VALOR_TOTAL_MULTA_INSCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","SIGLA_MOEDA_IMPOSTO","DATA_REFERENCIA_CORRECAO","DATA_INICIO_INCIDENCIA_JUROS","DATA_REFERENCIA_MULTA","SIGLA_MOEDA_MULTA","DATA_REFERENCIA_CORRECAO_MULTA_PUNITIVA","DATA_INICIO_INCIDENCIA_JUROS_MULTA_PUNITIVA","PERCENTUAL_MULTA_ATRASO","PERCENTUAL_MULTA_MORA","DATA_REFERENCIA","SITUACAO_ATUAL_ID","IDENTIFICADOR_NO_CLIENTE","VALOR_HONORARIOS_ATUAL","CAPITULACAO_ENCARGOS","PERIODO","PERCENTUAL_MULTA"]},{"schema":"ATT_DIVIDA","name":"INTEGRACAO","fullName":"ATT_DIVIDA.INTEGRACAO","columns":["ID","NOME","INSTITUICAO_ID","USUARIO","SENHA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_AUTENTICACAO","SCOPE","CERTIFICADO","SENHA_CERTIFICADO","TIPO_CONEXAO_SSL","CERTIFICADO_AUTENTICACAO","SENHA_CERTIFICADO_AUTENTICACAO"]},{"schema":"ATT_DIVIDA","name":"MODALIDADE","fullName":"ATT_DIVIDA.MODALIDADE","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"AJUIZAMENTO","fullName":"ATT_DIVIDA.AJUIZAMENTO","columns":["DIVIDA_ID","DATA_AJUIZAMENTO","NUMERO_JUDICIAL","TRIBUNAL_ID","UNIDADE_JUDICIAL_ID","JUIZO_ID","PROCESSO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","LOTE_PROCESSAMENTO_ID","NUMERO_JUDICIAL_PESQUISA","SUCESSO_NOTIFICACAO_FAZENDA","DATA_NOTIFICACAO_CDA_EMITIDA","DATA_NOTIFICACAO_AJUIZAMENTO","EXCEPCIONAL","PROCESSAMENTO_ACTION_ID"]},{"schema":"ATT_DIVIDA","name":"ORIGEM_ICMS","fullName":"ATT_DIVIDA.ORIGEM_ICMS","columns":["ID","IDENTIFICADOR_NO_CLIENTE","NOME","CATEGORIA_ID","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"REGIME_ICMS","fullName":"ATT_DIVIDA.REGIME_ICMS","columns":["ID","IDENTIFICADOR_NO_CLIENTE","NOME","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"DE_PARA_CNAE","fullName":"ATT_DIVIDA.DE_PARA_CNAE","columns":["ID","IDENTIFICADOR_NO_CLIENTE","CNAE_ID","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"HASH_DEVEDOR","fullName":"ATT_DIVIDA.HASH_DEVEDOR","columns":["ID","INSTITUICAO_ID","PESSOA_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","NOME_ID"]},{"schema":"ATT_DIVIDA","name":"PARCELAMENTO","fullName":"ATT_DIVIDA.PARCELAMENTO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NUMERO","NR_PESQUISA","TIPO","DATA_CONCESSAO","DATA_ULTIMO_PAGAMENTO","VALOR_PARCELAMENTO","VALOR_SALDO","VALOR_PAGO","PARCELAS","PARCELAS_EM_ATRASO","SITUACAO_ATUAL_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","REGRA_PARCELAMENTO_ID","PARCELAS_PAGAS","VALOR_PARCELAS_ATRASO","DATA_ULTIMO_VENCIMENTO"]},{"schema":"ATT_DIVIDA","name":"TIPO_VEICULO","fullName":"ATT_DIVIDA.TIPO_VEICULO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"EVENTO_DIVIDA","fullName":"ATT_DIVIDA.EVENTO_DIVIDA","columns":["ID","PROCESSO_ID","SITUACAO_DIVIDA_ID","SITUACAO_PARCELAMENTO_ID","SITUACAO_COMPOSICAO_ID","SITUACAO_RETIFICACAO_ID","DATA_ANDAMENTO","TIPO_ANDAMENTO_ID","BUSINESS_KEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"CORRESPONSAVEL","fullName":"ATT_DIVIDA.CORRESPONSAVEL","columns":["ID","DIVIDA_ID","PESSOA_ID","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NOME_ID","CARGO","GERENTE","PERIODO_INICIAL","PERIODO_FINAL"]},{"schema":"ATT_DIVIDA","name":"CHAMADA_SERVICO","fullName":"ATT_DIVIDA.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","SERVICO","DATA_ORIGEM_MENSAGEM","MENSAGEM_ID","TIPO_ERRO","DEVEDOR_DOCUMENTO","PARCELAMENTO_IDENTIFICADOR_NO_CLIENTE","MENSAGEM_ENVIO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","IDENTIFICADOR_ERRO_NO_CLIENTE"]},{"schema":"ATT_DIVIDA","name":"SITUACAO_DIVIDA","fullName":"ATT_DIVIDA.SITUACAO_DIVIDA","columns":["ID","DATA_SITUACAO","TIPO_SITUACAO_ID","MOTIVO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","MENSAGEM_ID","DATA_PROCESSAMENTO_EVENTO"]},{"schema":"ATT_DIVIDA","name":"PROTESTO_FAZENDA","fullName":"ATT_DIVIDA.PROTESTO_FAZENDA","columns":["ID","DIVIDA_ID","TIPO_SITUACAO_PROTESTO_FAZENDA_ID","DATA","NOME_CARTORIO","NUMERO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ORDEM_NO_PROCESSO"]},{"schema":"ATT_DIVIDA","name":"BLOQUEIO_COBRANCA","fullName":"ATT_DIVIDA.BLOQUEIO_COBRANCA","columns":["ID","DIVIDA_ID","DEVEDOR_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_FINAL","INSTITUICAO_ID","MOTIVO"]},{"schema":"ATT_DIVIDA","name":"DIVIDA_TEM_DEFESA","fullName":"ATT_DIVIDA.DIVIDA_TEM_DEFESA","columns":["DIVIDA_ID","DEFESA_ID"]},{"schema":"ATT_DIVIDA","name":"LOTE_PROCESSAMENTO","fullName":"ATT_DIVIDA.LOTE_PROCESSAMENTO","columns":["ID","INSTITUICAO_ID","LOTE_AJUIZAMENTO","STATUS","TIPO_PROCESSAMENTO","NOME","DATA_TERMINO_LEITURA_ARQUIVO","DATA_TERMINO_SINCRONIZACAO","DATA_TERMINO_GERACAO_COBRANCA","DATA_TERMINO_GERACAO_ARQUIVO_RETORNO","DATA_TERMINO_AJUIZAMENTO","DATA_FINALIZACAO","DOCUMENTO_RETORNO_ID","JOB_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","QUANTIDADE_COBRANCAS_GERADAS","QUANTIDADE_COBRANCAS_SUCESSO","QUANTIDADE_DIVIDAS_ARQUIVO","QUANTIDADE_ERROS_DEVEDORES","QUANTIDADE_ERROS_DIVIDAS","QUANTIDADE_DIVIDAS_SINCRONIZADAS","QUANTIDADE_DEVEDORES_QUALIFICADOS","QUANTIDADE_DEVEDORES_SINCRONIZADOS","VERSION","CRITERIO_SELECAO","DATA_TERMINO_QUALIFICACAO_DEVEDORES","USUARIO_EXECUTOR","NOME_JOB","PATH_ARQUIVO_DIVIDAS","QUANTIDADE_DEVEDORES_FALHA","QUANTIDADE_DEVEDORES_ALERTA","QUANTIDADE_DIVIDAS_ALERTA","QUANTIDADE_DIVIDAS_SELECIONADAS","QUANTIDADE_DIVIDAS_FALHA"]},{"schema":"ATT_DIVIDA","name":"PERDA_PARCELAMENTO","fullName":"ATT_DIVIDA.PERDA_PARCELAMENTO","columns":["ID","DIVIDA_ID","PARCELAMENTO_ID","CREATED_DATE","CREATED_BY"]},{"schema":"ATT_DIVIDA","name":"REGRA_PARCELAMENTO","fullName":"ATT_DIVIDA.REGRA_PARCELAMENTO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"DIVIDA_TEM_SITUACAO","fullName":"ATT_DIVIDA.DIVIDA_TEM_SITUACAO","columns":["DIVIDA_ID","SITUACAO_DIVIDA_ID"]},{"schema":"ATT_DIVIDA","name":"LOG_CHAMADA_SERVICO","fullName":"ATT_DIVIDA.LOG_CHAMADA_SERVICO","columns":["ID","SERVICO","MENSAGEM","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"SITUACAO_COMPOSICAO","fullName":"ATT_DIVIDA.SITUACAO_COMPOSICAO","columns":["ID","TIPO_SITUACAO_ID","COMPOSICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DIVIDA","name":"AJUIZAMENTO_REMOVIDO","fullName":"ATT_DIVIDA.AJUIZAMENTO_REMOVIDO","columns":["ID","DIVIDA_ID","PROCESSO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ORIGEM","DATA_REMOCAO","DIVERGENCIA_FAZENDA","DATA_AJUIZAMENTO","NUMERO_JUDICIAL","NUMERO_JUDICIAL_PESQUISA","MOTIVO_REMOCAO"]},{"schema":"ATT_DIVIDA","name":"DE_PARA_ORGAO_ORIGEM","fullName":"ATT_DIVIDA.DE_PARA_ORGAO_ORIGEM","columns":["ID","LOCAL_ID","IDENTIFICADOR_NO_CLIENTE","NOME_NO_CLIENTE","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DIVIDA","name":"TIPO_SITUACAO_DIVIDA","fullName":"ATT_DIVIDA.TIPO_SITUACAO_DIVIDA","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","CATEGORIA","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_ANDAMENTO_ID"]},{"schema":"ATT_DIVIDA","name":"VENCIMENTO_EXERCICIO","fullName":"ATT_DIVIDA.VENCIMENTO_EXERCICIO","columns":["ID","CATEGORIA_ID","ANO","VENCIMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","INSTITUICAO_ID"]},{"schema":"ATT_DIVIDA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_DIVIDA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_DIVIDA","name":"SITUACAO_PARCELAMENTO","fullName":"ATT_DIVIDA.SITUACAO_PARCELAMENTO","columns":["ID","TIPO_SITUACAO_ID","DATA_SITUACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","MENSAGEM_ID","DATA_PROCESSAMENTO_EVENTO","MOTIVO"]},{"schema":"ATT_DIVIDA","name":"DIVIDA_TEM_COMPLEMENTO","fullName":"ATT_DIVIDA.DIVIDA_TEM_COMPLEMENTO","columns":["DIVIDA_ID","NOME","VALOR"]},{"schema":"ATT_DIVIDA","name":"ERRO_PROCESSAMENTO_DIVIDA","fullName":"ATT_DIVIDA.ERRO_PROCESSAMENTO_DIVIDA","columns":["ID","INSTITUICAO_ID","SERVICO","MENSAGEM","IDENTIFICADOR_DIVIDA","IDENTIFICADOR_PARCELAMENTO","EXCEPTION_MESSAGE","EXCEPTION_STACKTRACE","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DIVIDA","name":"PARCELAMENTO_TEM_SITUACAO","fullName":"ATT_DIVIDA.PARCELAMENTO_TEM_SITUACAO","columns":["PARCELAMENTO_ID","SITUACAO_PARCELAMENTO_ID"]},{"schema":"ATT_DIVIDA","name":"TIPO_SITUACAO_PARCELAMENTO","fullName":"ATT_DIVIDA.TIPO_SITUACAO_PARCELAMENTO","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CATEGORIA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_ANDAMENTO_ID"]},{"schema":"ATT_DIVIDA","name":"LOTE_PROCESSAMENTO_TEM_ERRO","fullName":"ATT_DIVIDA.LOTE_PROCESSAMENTO_TEM_ERRO","columns":["ID","LOTE_PROCESSAMENTO_ID","DETALHE","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DEVEDOR_ID","DIVIDA_ID","NUMERO_DIVIDA","PROCESSO_INSCRICAO","TIPO_ERRO","VISIVEL_USUARIO","CATEGORIA_ERRO"]},{"schema":"ATT_DIVIDA","name":"DE_PARA_TIPO_SITUACAO_PESSOA","fullName":"ATT_DIVIDA.DE_PARA_TIPO_SITUACAO_PESSOA","columns":["ID","INSTITUICAO_ID","TIPO_SITUACAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","IDENTIFICADOR_NO_CLIENTE"]},{"schema":"ATT_DIVIDA","name":"LOTE_PROCESSAMENTO_TEM_DIVIDA","fullName":"ATT_DIVIDA.LOTE_PROCESSAMENTO_TEM_DIVIDA","columns":["DIVIDA_ID","LOTE_PROCESSAMENTO_ID"]},{"schema":"ATT_DIVIDA","name":"LOTE_PROCESSAMENTO_TEM_DEVEDOR","fullName":"ATT_DIVIDA.LOTE_PROCESSAMENTO_TEM_DEVEDOR","columns":["ID","DEVEDOR_ID","LOTE_PROCESSAMENTO_ID","RAIZ_CNPJ","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_QUALIFICACAO","DATA_TERMINO_QUALIFICACAO","DATA_INICIO_MONTAGEM_KITS","DATA_TERMINO_MONTAGEM_KITS","DATA_TERMINO_COBRANCA","QUANTIDADE_DIVIDAS_SELECIONADAS","AGRUPADO","QUANTIDADE_DIVIDAS_ADICIONADAS_EM_KITS","QUANTIDADE_DIVIDAS_COM_ERRO"]},{"schema":"ATT_DIVIDA","name":"TIPO_SITUACAO_PROTESTO_FAZENDA","fullName":"ATT_DIVIDA.TIPO_SITUACAO_PROTESTO_FAZENDA","columns":["ID","INSTITUICAO_ID","IDENTIFICADOR_NO_CLIENTE","NOME","CATEGORIA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PERMITE_AJUIZAMENTO"]},{"schema":"ATT_DIVIDA","name":"CHAMADA_SERVICO_TEM_DIVIDA_IDENTIFICADOR_NO_CLIENTE","fullName":"ATT_DIVIDA.CHAMADA_SERVICO_TEM_DIVIDA_IDENTIFICADOR_NO_CLIENTE","columns":["CHAMADA_SERVICO_ID","IDENTIFICADOR_DIVIDA"]},{"schema":"ATT_JASPER","name":"JIROLE","fullName":"ATT_JASPER.JIROLE","columns":["ID","ROLENAME","TENANTID","EXTERNALLYDEFINED"]},{"schema":"ATT_JASPER","name":"JIUSER","fullName":"ATT_JASPER.JIUSER","columns":["ID","USERNAME","TENANTID","FULLNAME","EMAILADDRESS","PASSWORD","EXTERNALLYDEFINED","ENABLED","PREVIOUSPASSWORDCHANGETIME"]},{"schema":"ATT_JASPER","name":"JIQUERY","fullName":"ATT_JASPER.JIQUERY","columns":["ID","DATASOURCE","QUERY_LANGUAGE","SQL_QUERY"]},{"schema":"ATT_JASPER","name":"JITENANT","fullName":"ATT_JASPER.JITENANT","columns":["ID","TENANTID","TENANTALIAS","PARENTID","TENANTNAME","TENANTDESC","TENANTNOTE","TENANTURI","TENANTFOLDERURI","THEME"]},{"schema":"ATT_JASPER","name":"JIDATATYPE","fullName":"ATT_JASPER.JIDATATYPE","columns":["ID","TYPE","MAXLENGTH","DECIMALS","REGULAREXPR","MINVALUE","MAX_VALUE","STRICTMIN","STRICTMAX"]},{"schema":"ATT_JASPER","name":"JILOGEVENT","fullName":"ATT_JASPER.JILOGEVENT","columns":["ID","OCCURRENCE_DATE","EVENT_TYPE","COMPONENT","MESSAGE","RESOURCE_URI","EVENT_TEXT","EVENT_DATA","EVENT_STATE","USERID"]},{"schema":"ATT_JASPER","name":"JIOLAPUNIT","fullName":"ATT_JASPER.JIOLAPUNIT","columns":["ID","OLAPCLIENTCONNECTION","MDX_QUERY","VIEW_OPTIONS"]},{"schema":"ATT_JASPER","name":"JIRESOURCE","fullName":"ATT_JASPER.JIRESOURCE","columns":["ID","VERSION","NAME","PARENT_FOLDER","CHILDRENFOLDER","LABEL","DESCRIPTION","RESOURCETYPE","CREATION_DATE","UPDATE_DATE"]},{"schema":"ATT_JASPER","name":"JIUSERROLE","fullName":"ATT_JASPER.JIUSERROLE","columns":["ROLEID","USERID"]},{"schema":"ATT_JASPER","name":"QRTZ_LOCKS","fullName":"ATT_JASPER.QRTZ_LOCKS","columns":["SCHED_NAME","LOCK_NAME"]},{"schema":"ATT_JASPER","name":"JIREPORTJOB","fullName":"ATT_JASPER.JIREPORTJOB","columns":["ID","VERSION","OWNER","LABEL","DESCRIPTION","CREATION_DATE","REPORT_UNIT_URI","SCHEDULEDRESOURCE","JOB_TRIGGER","BASE_OUTPUT_NAME","OUTPUT_LOCALE","CONTENT_DESTINATION","MAIL_NOTIFICATION","ALERT"]},{"schema":"ATT_JASPER","name":"JIREPORTUNIT","fullName":"ATT_JASPER.JIREPORTUNIT","columns":["ID","REPORTDATASOURCE","QUERY","MAINREPORT","CONTROLRENDERER","REPORTRENDERER","PROMPTCONTROLS","CONTROLSLAYOUT","DATA_SNAPSHOT_ID"]},{"schema":"ATT_JASPER","name":"JIACCESSEVENT","fullName":"ATT_JASPER.JIACCESSEVENT","columns":["ID","USER_ID","EVENT_DATE","RESOURCE_ID","UPDATING"]},{"schema":"ATT_JASPER","name":"QRTZ_TRIGGERS","fullName":"ATT_JASPER.QRTZ_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","JOB_NAME","JOB_GROUP","DESCRIPTION","NEXT_FIRE_TIME","PREV_FIRE_TIME","PRIORITY","TRIGGER_STATE","TRIGGER_TYPE","START_TIME","END_TIME","CALENDAR_NAME","MISFIRE_INSTR","JOB_DATA"]},{"schema":"ATT_JASPER","name":"JIDATASNAPSHOT","fullName":"ATT_JASPER.JIDATASNAPSHOT","columns":["ID","VERSION","SNAPSHOT_DATE","CONTENTS_ID"]},{"schema":"ATT_JASPER","name":"JIFILERESOURCE","fullName":"ATT_JASPER.JIFILERESOURCE","columns":["ID","DATA","FILE_TYPE","REFERENCE"]},{"schema":"ATT_JASPER","name":"JIINPUTCONTROL","fullName":"ATT_JASPER.JIINPUTCONTROL","columns":["ID","TYPE","MANDATORY","READONLY","VISIBLE","DATA_TYPE","LIST_OF_VALUES","LIST_QUERY","QUERY_VALUE_COLUMN","DEFAULTVALUE"]},{"schema":"ATT_JASPER","name":"JILISTOFVALUES","fullName":"ATT_JASPER.JILISTOFVALUES","columns":["ID"]},{"schema":"ATT_JASPER","name":"QRTZ_CALENDARS","fullName":"ATT_JASPER.QRTZ_CALENDARS","columns":["SCHED_NAME","CALENDAR_NAME","CALENDAR"]},{"schema":"ATT_JASPER","name":"JIAWSDATASOURCE","fullName":"ATT_JASPER.JIAWSDATASOURCE","columns":["ID","ACCESSKEY","SECRETKEY","ROLEARN","REGION","DBNAME","DBINSTANCEIDENTIFIER","DBSERVICE"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBMAIL","fullName":"ATT_JASPER.JIREPORTJOBMAIL","columns":["ID","VERSION","SUBJECT","MESSAGE","SEND_TYPE","SKIP_EMPTY","MESSAGE_TEXT_WHEN_JOB_FAILS","INC_STKTRC_WHEN_JOB_FAILS","SKIP_NOTIF_WHEN_JOB_FAILS"]},{"schema":"ATT_JASPER","name":"JIBEANDATASOURCE","fullName":"ATT_JASPER.JIBEANDATASOURCE","columns":["ID","BEANNAME","BEANMETHOD"]},{"schema":"ATT_JASPER","name":"JIJDBCDATASOURCE","fullName":"ATT_JASPER.JIJDBCDATASOURCE","columns":["ID","DRIVER","PASSWORD","CONNECTIONURL","USERNAME","TIMEZONE"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBALERT","fullName":"ATT_JASPER.JIREPORTJOBALERT","columns":["ID","VERSION","RECIPIENT","SUBJECT","MESSAGE_TEXT","MESSAGE_TEXT_WHEN_JOB_FAILS","JOB_STATE","INCLUDING_STACK_TRACE","INCLUDING_REPORT_JOB_INFO"]},{"schema":"ATT_JASPER","name":"JIRESOURCEFOLDER","fullName":"ATT_JASPER.JIRESOURCEFOLDER","columns":["ID","VERSION","URI","HIDDEN","NAME","LABEL","DESCRIPTION","PARENT_FOLDER","CREATION_DATE","UPDATE_DATE"]},{"schema":"ATT_JASPER","name":"JIXMLACONNECTION","fullName":"ATT_JASPER.JIXMLACONNECTION","columns":["ID","CATALOG","USERNAME","PASSWORD","DATASOURCE","URI"]},{"schema":"ATT_JASPER","name":"QRTZ_JOB_DETAILS","fullName":"ATT_JASPER.QRTZ_JOB_DETAILS","columns":["SCHED_NAME","JOB_NAME","JOB_GROUP","DESCRIPTION","JOB_CLASS_NAME","IS_DURABLE","IS_NONCONCURRENT","IS_UPDATE_DATA","REQUESTS_RECOVERY","JOB_DATA"]},{"schema":"ATT_JASPER","name":"JICONTENTRESOURCE","fullName":"ATT_JASPER.JICONTENTRESOURCE","columns":["ID","DATA","FILE_TYPE"]},{"schema":"ATT_JASPER","name":"JIREPORTTHUMBNAIL","fullName":"ATT_JASPER.JIREPORTTHUMBNAIL","columns":["ID","USER_ID","RESOURCE_ID","THUMBNAIL"]},{"schema":"ATT_JASPER","name":"JIREPOSITORYCACHE","fullName":"ATT_JASPER.JIREPOSITORYCACHE","columns":["ID","URI","CACHE_NAME","DATA","VERSION","VERSION_DATE","ITEM_REFERENCE"]},{"schema":"ATT_JASPER","name":"JICUSTOMDATASOURCE","fullName":"ATT_JASPER.JICUSTOMDATASOURCE","columns":["ID","SERVICECLASS"]},{"schema":"ATT_JASPER","name":"JILISTOFVALUESITEM","fullName":"ATT_JASPER.JILISTOFVALUESITEM","columns":["ID","IDX","LABEL","VALUE"]},{"schema":"ATT_JASPER","name":"JIOBJECTPERMISSION","fullName":"ATT_JASPER.JIOBJECTPERMISSION","columns":["ID","URI","RECIPIENTOBJECTCLASS","RECIPIENTOBJECTID","PERMISSIONMASK"]},{"schema":"ATT_JASPER","name":"JIPROFILEATTRIBUTE","fullName":"ATT_JASPER.JIPROFILEATTRIBUTE","columns":["ID","ATTRNAME","ATTRVALUE","DESCRIPTION","OWNER","PRINCIPALOBJECTCLASS","PRINCIPALOBJECTID"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBTRIGGER","fullName":"ATT_JASPER.JIREPORTJOBTRIGGER","columns":["ID","VERSION","TIMEZONE","START_TYPE","START_DATE","END_DATE","CALENDAR_NAME","MISFIRE_INSTRUCTION"]},{"schema":"ATT_JASPER","name":"QRTZ_BLOB_TRIGGERS","fullName":"ATT_JASPER.QRTZ_BLOB_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","BLOB_DATA"]},{"schema":"ATT_JASPER","name":"QRTZ_CRON_TRIGGERS","fullName":"ATT_JASPER.QRTZ_CRON_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","CRON_EXPRESSION","TIME_ZONE_ID"]},{"schema":"ATT_JASPER","name":"JIFTPINFOPROPERTIES","fullName":"ATT_JASPER.JIFTPINFOPROPERTIES","columns":["REPODEST_ID","PROPERTY_NAME","PROPERTY_VALUE"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBREPODEST","fullName":"ATT_JASPER.JIREPORTJOBREPODEST","columns":["ID","VERSION","FOLDER_URI","SEQUENTIAL_FILENAMES","OVERWRITE_FILES","SAVE_TO_REPOSITORY","OUTPUT_DESCRIPTION","TIMESTAMP_PATTERN","USING_DEF_RPT_OPT_FOLDER_URI","OUTPUT_LOCAL_FOLDER","USER_NAME","PASSWORD","SERVER_NAME","FOLDER_PATH","SSH_PRIVATE_KEY"]},{"schema":"ATT_JASPER","name":"JIVIRTUALDATASOURCE","fullName":"ATT_JASPER.JIVIRTUALDATASOURCE","columns":["ID","TIMEZONE"]},{"schema":"ATT_JASPER","name":"QRTZ_FIRED_TRIGGERS","fullName":"ATT_JASPER.QRTZ_FIRED_TRIGGERS","columns":["SCHED_NAME","ENTRY_ID","TRIGGER_NAME","TRIGGER_GROUP","INSTANCE_NAME","FIRED_TIME","SCHED_TIME","PRIORITY","STATE","JOB_NAME","JOB_GROUP","IS_NONCONCURRENT","REQUESTS_RECOVERY"]},{"schema":"ATT_JASPER","name":"JIAZURESQLDATASOURCE","fullName":"ATT_JASPER.JIAZURESQLDATASOURCE","columns":["ID","KEYSTORE_ID","KEYSTOREPASSWORD","KEYSTORETYPE","SUBSCRIPTIONID","SERVERNAME","DBNAME"]},{"schema":"ATT_JASPER","name":"JIJNDIJDBCDATASOURCE","fullName":"ATT_JASPER.JIJNDIJDBCDATASOURCE","columns":["ID","JNDINAME","TIMEZONE"]},{"schema":"ATT_JASPER","name":"JIMONDRIANCONNECTION","fullName":"ATT_JASPER.JIMONDRIANCONNECTION","columns":["ID","REPORTDATASOURCE","MONDRIANSCHEMA"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBPARAMETER","fullName":"ATT_JASPER.JIREPORTJOBPARAMETER","columns":["JOB_ID","PARAMETER_NAME","PARAMETER_VALUE"]},{"schema":"ATT_JASPER","name":"JIREPORTUNITRESOURCE","fullName":"ATT_JASPER.JIREPORTUNITRESOURCE","columns":["REPORT_UNIT_ID","RESOURCE_INDEX","RESOURCE_ID"]},{"schema":"ATT_JASPER","name":"QRTZ_SCHEDULER_STATE","fullName":"ATT_JASPER.QRTZ_SCHEDULER_STATE","columns":["SCHED_NAME","INSTANCE_NAME","LAST_CHECKIN_TIME","CHECKIN_INTERVAL"]},{"schema":"ATT_JASPER","name":"QRTZ_SIMPLE_TRIGGERS","fullName":"ATT_JASPER.QRTZ_SIMPLE_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","REPEAT_COUNT","REPEAT_INTERVAL","TIMES_TRIGGERED"]},{"schema":"ATT_JASPER","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_JASPER.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_JASPER","name":"QRTZ_SIMPROP_TRIGGERS","fullName":"ATT_JASPER.QRTZ_SIMPROP_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","STR_PROP_1","STR_PROP_2","STR_PROP_3","INT_PROP_1","INT_PROP_2","LONG_PROP_1","LONG_PROP_2","DEC_PROP_1","DEC_PROP_2","BOOL_PROP_1","BOOL_PROP_2"]},{"schema":"ATT_JASPER","name":"JIDATASNAPSHOTCONTENTS","fullName":"ATT_JASPER.JIDATASNAPSHOTCONTENTS","columns":["ID","DATA"]},{"schema":"ATT_JASPER","name":"JIOLAPCLIENTCONNECTION","fullName":"ATT_JASPER.JIOLAPCLIENTCONNECTION","columns":["ID"]},{"schema":"ATT_JASPER","name":"JIREPORTALERTTOADDRESS","fullName":"ATT_JASPER.JIREPORTALERTTOADDRESS","columns":["ALERT_ID","TO_ADDRESS_IDX","TO_ADDRESS"]},{"schema":"ATT_JASPER","name":"JIDATASNAPSHOTPARAMETER","fullName":"ATT_JASPER.JIDATASNAPSHOTPARAMETER","columns":["ID","PARAMETER_NAME","PARAMETER_VALUE"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBOUTPUTFORMAT","fullName":"ATT_JASPER.JIREPORTJOBOUTPUTFORMAT","columns":["REPORT_JOB_ID","OUTPUT_FORMAT"]},{"schema":"ATT_JASPER","name":"JIMONDRIANXMLADEFINITION","fullName":"ATT_JASPER.JIMONDRIANXMLADEFINITION","columns":["ID","CATALOG","MONDRIANCONNECTION"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBMAILRECIPIENT","fullName":"ATT_JASPER.JIREPORTJOBMAILRECIPIENT","columns":["DESTINATION_ID","RECIPIENT_IDX","RECIPIENT_TYPE","ADDRESS"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBSIMPLETRIGGER","fullName":"ATT_JASPER.JIREPORTJOBSIMPLETRIGGER","columns":["ID","OCCURRENCE_COUNT","RECURRENCE_INTERVAL","RECURRENCE_INTERVAL_UNIT"]},{"schema":"ATT_JASPER","name":"JIREPORTUNITINPUTCONTROL","fullName":"ATT_JASPER.JIREPORTUNITINPUTCONTROL","columns":["REPORT_UNIT_ID","CONTROL_INDEX","INPUT_CONTROL_ID"]},{"schema":"ATT_JASPER","name":"QRTZ_PAUSED_TRIGGER_GRPS","fullName":"ATT_JASPER.QRTZ_PAUSED_TRIGGER_GRPS","columns":["SCHED_NAME","TRIGGER_GROUP"]},{"schema":"ATT_JASPER","name":"JIINPUTCONTROLQUERYCOLUMN","fullName":"ATT_JASPER.JIINPUTCONTROLQUERYCOLUMN","columns":["INPUT_CONTROL_ID","COLUMN_INDEX","QUERY_COLUMN"]},{"schema":"ATT_JASPER","name":"JIVIRTUALDATASOURCEURIMAP","fullName":"ATT_JASPER.JIVIRTUALDATASOURCEURIMAP","columns":["VIRTUALDS_ID","DATA_SOURCE_NAME","RESOURCE_ID"]},{"schema":"ATT_JASPER","name":"JICUSTOMDATASOURCEPROPERTY","fullName":"ATT_JASPER.JICUSTOMDATASOURCEPROPERTY","columns":["DS_ID","NAME","VALUE"]},{"schema":"ATT_JASPER","name":"JICUSTOMDATASOURCERESOURCE","fullName":"ATT_JASPER.JICUSTOMDATASOURCERESOURCE","columns":["DS_ID","NAME","RESOURCE_ID"]},{"schema":"ATT_JASPER","name":"JIREPORTJOBCALENDARTRIGGER","fullName":"ATT_JASPER.JIREPORTJOBCALENDARTRIGGER","columns":["ID","MINUTES","HOURS","DAYS_TYPE","WEEK_DAYS","MONTH_DAYS","MONTHS"]},{"schema":"ATT_PESSOA","name":"UF","fullName":"ATT_PESSOA.UF","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"BEM","fullName":"ATT_PESSOA.BEM","columns":["ID","PESSOA_ID","FIEL_DEPOSITARIO_ID","TIPO_PENHORA_ID","TIPO","DATA_PENHORA","NUMERO_PROCESSO","DATA_VENCIMENTO","VALOR","DATA_AVALIACAO","DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"CNAE","fullName":"ATT_PESSOA.CNAE","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"NOME","fullName":"ATT_PESSOA.NOME","columns":["ID","INSTITUICAO_ID","PESSOA_ID","NOME","ORIGEM","DATA_ORIGEM","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"BANCO","fullName":"ATT_PESSOA.BANCO","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"EMAIL","fullName":"ATT_PESSOA.EMAIL","columns":["ID","PESSOA_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"PESSOA","fullName":"ATT_PESSOA.PESSOA","columns":["ID","INSTITUICAO_ID","DATA_NASCIMENTO","GENERO","CNAE_ID","DOCUMENTO_PRINCIPAL_ID","EMAIL_PRINCIPAL_ID","ENDERECO_PRINCIPAL_ID","TELEFONE_PRINCIPAL_ID","FALECIDA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","QUALIFICACAO_ID","ORGAO_UNIAO","VALOR_FATURAMENTO_MEDIO","DATA_FATURAMENTO_MEDIO","NOME_PRINCIPAL_ID","GRUPO_ECONOMICO","DATA_FALECIMENTO","PARTICIPACAO_SOMENTE_EM_PROCESSOS_SIGILOSOS","CIRCUNSCRICAO_FISCAL","DATA_ABERTURA","PORTE_EMPRESA_ID","TIPO_PESSOA","DEPENDENTES","CLASSIFICACAO_NATUREZA_JURIDICA","ISENTA_IRRF","CONTA_BANCARIA_PRINCIPAL_ID","IMUNE_TRIBUTACAO","SIGLA"]},{"schema":"ATT_PESSOA","name":"SERVICO","fullName":"ATT_PESSOA.SERVICO","columns":["ID","INTEGRACAO_ID","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","IDENTIFICADOR_NA_INTEGRACAO","URL","PATH_ARQUIVO_DE_TRANSFORMACAO"]},{"schema":"ATT_PESSOA","name":"ANOTACAO","fullName":"ATT_PESSOA.ANOTACAO","columns":["ID","DESCRICAO","PESSOA_ID","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","LOCAL_ID","VISIBILIDADE"]},{"schema":"ATT_PESSOA","name":"ENDERECO","fullName":"ATT_PESSOA.ENDERECO","columns":["ID","LOGRADOURO","NUMERO","CEP","BAIRRO","COMPLEMENTO","MUNICIPIO_NOME","MUNICIPIO_ID","UF","HASH","LATITUDE","LONGITUDE","QUALIFICACAO","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION","ENDERECO_CONSISTENTE_ID","PESSOA_ID","SITUACAO_CITACAO","HIGIENIZADO"]},{"schema":"ATT_PESSOA","name":"FALENCIA","fullName":"ATT_PESSOA.FALENCIA","columns":["ID","PESSOA_ID","TIPO","ANOTACAO","DATA_OCORRENCIA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"SEQUENCE","fullName":"ATT_PESSOA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_PESSOA","name":"SITUACAO","fullName":"ATT_PESSOA.SITUACAO","columns":["ID","TIPO_SITUACAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION","PESSOA_ID","ORIGEM","DATA_SITUACAO","DATA_CONSULTA","DESCRICAO_REGIME"]},{"schema":"ATT_PESSOA","name":"TELEFONE","fullName":"ATT_PESSOA.TELEFONE","columns":["ID","PESSOA_ID","TIPO","NUMERO","DATA_ORIGEM","QUALIFICACAO","OPERADORA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NUMERO_PESQUISA"]},{"schema":"ATT_PESSOA","name":"DOCUMENTO","fullName":"ATT_PESSOA.DOCUMENTO","columns":["ID","INSTITUICAO_ID","DATA_EXPEDICAO","NR_PESQUISA","NUMERO","ORGAO_EXPEDIDOR","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PESSOA_ID"]},{"schema":"ATT_PESSOA","name":"MUNICIPIO","fullName":"ATT_PESSOA.MUNICIPIO","columns":["ID","NOME","NOME_PESQUISA","UF_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DDD"]},{"schema":"ATT_PESSOA","name":"INTEGRACAO","fullName":"ATT_PESSOA.INTEGRACAO","columns":["ID","TIPO","NOME","URL","APIKEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","CERTIFICADO","SENHA_CERTIFICADO"]},{"schema":"ATT_PESSOA","name":"TIPO_PENHORA","fullName":"ATT_PESSOA.TIPO_PENHORA","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"PORTE_EMPRESA","fullName":"ATT_PESSOA.PORTE_EMPRESA","columns":["ID","DESCRICAO","IDENTIFICADOR_NA_INTEGRACAO","ORIGEM","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"TIPO_SITUACAO","fullName":"ATT_PESSOA.TIPO_SITUACAO","columns":["ID","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION","CATEGORIA","CODIGO_SITUACAO_CADASTRAL","CODIGO_MOTIVO_SITUACAO_CADASTRAL","ORIGEM","DESCRICAO_MOTIVO","DESCRICAO_TIPO","SITUACAO_APTA_AJUIZAMENTO"]},{"schema":"ATT_PESSOA","name":"BUSCA_ENDERECO","fullName":"ATT_PESSOA.BUSCA_ENDERECO","columns":["ID","INSTITUICAO_ID","PESSOA_ID","SERVICO_ID","ENDERECO_INFORMADO_ID","ENDERECO_CONSULTADO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"CONTA_BANCARIA","fullName":"ATT_PESSOA.CONTA_BANCARIA","columns":["ID","PESSOA_ID","BANCO_ID","AGENCIA","NUMERO_CONTA","CONVENIO","CODIGO_MCI","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO","CONVENIO_CNAB","SITUACAO","CHAVE_PIX","DIGITO_AGENCIA","DIGITO_CONTA"]},{"schema":"ATT_PESSOA","name":"CORRESPONSAVEL","fullName":"ATT_PESSOA.CORRESPONSAVEL","columns":["ID","TIPO_ID","EMPRESA_ID","PESSOA_ID","ORIGEM","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"ISENCAO_DOENCA","fullName":"ATT_PESSOA.ISENCAO_DOENCA","columns":["ID","PESSOA_ID","DATA_INICIAL","DATA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"GRUPO_ECONOMICO","fullName":"ATT_PESSOA.GRUPO_ECONOMICO","columns":["ID","RAIZ_CNPJ","PESSOA_MATRIZ_ID","NOME_MATRIZ","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"MIGRACAO_PESSOA","fullName":"ATT_PESSOA.MIGRACAO_PESSOA","columns":["ID_ORIGEM","NOME","CREATED_BY","CREATED_DATE","MODIFIED_DATE","GRUPO_ECONOMICO_ID","ORGAO_UNIAO","NATUREZA_JURIDICA_ID","TIPO_DOCUMENTO","NUMERO_DOCUMENTO","ID_ATTORNATUS"]},{"schema":"ATT_PESSOA","name":"ORIGEM_ENDERECO","fullName":"ATT_PESSOA.ORIGEM_ENDERECO","columns":["ID","ORIGEM","ENDERECO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"DE_PARA_MUNICIPIO","fullName":"ATT_PESSOA.DE_PARA_MUNICIPIO","columns":["ID","IDENTIFICADOR_NO_CLIENTE","MUNICIPIO_ID","ORIGEM","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"MIGRACAO_MUNICIPIO","fullName":"ATT_PESSOA.MIGRACAO_MUNICIPIO","columns":["ID_ORIGEM","NOME","NOME_PESQUISA","UF","CREATED_BY","CREATED_DATE","ID_ATTORNATUS","NOME_ATTORNATUS","UF_ATTORNATUS"]},{"schema":"ATT_PESSOA","name":"QUALIFICACAO_PESSOA","fullName":"ATT_PESSOA.QUALIFICACAO_PESSOA","columns":["ID","INSTITUICAO_ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"TIPO_CORRESPONSAVEL","fullName":"ATT_PESSOA.TIPO_CORRESPONSAVEL","columns":["ID","IDENTIFICADOR_NA_INTEGRACAO","DESCRICAO","ORIGEM","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PESSOA","name":"VINCULO_EMPREGATICIO","fullName":"ATT_PESSOA.VINCULO_EMPREGATICIO","columns":["ID","PESSOA_ID","TIPO_REGIME","MATRICULA_REGISTRO","EMPREGADOR_ID","ADMISSAO_DATA","APOSENTADORIA_DATA","EXONERACAO_DEMISSAO_DATA","OPCAO_FGTS_DATA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_PESSOA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_PESSOA","name":"RESUMO_BUSCA_ENDERECO","fullName":"ATT_PESSOA.RESUMO_BUSCA_ENDERECO","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MES","QUANTIDADE","CONSISTENTE","GRAFIA_CORRIGIDA","ENDERECO_CORRIGIDO"]},{"schema":"ATT_PESSOA","name":"MIGRACAO_PESSOA_ENDERECO","fullName":"ATT_PESSOA.MIGRACAO_PESSOA_ENDERECO","columns":["ID","ID_ORIGEM","SEQUENCIAL","LOGRADOURO","NUMERO","CEP","BAIRRO","COMPLEMENTO","MUNICIPIO_NOME","MUNICIPIO_ID_ORIGEM","MUNICIPIO_ID","UF","HASH","LATITUDE","LONGITUDE","QUALIFICACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ORIGEM","ENDERECO_CONSISTENTE_ID","ID_PESSOA","CITACAO_NEGATIVA","PRINCIPAL","ID_PESSOA_ATTORNATUS","ID_ENDERECO_ATTORNATUS"]},{"schema":"ATT_PESSOA","name":"MIGRACAO_PESSOA_DOCUMENTO","fullName":"ATT_PESSOA.MIGRACAO_PESSOA_DOCUMENTO","columns":["ID","ID_ORIGEM","SEQUENCIAL","INSTITUICAO_ID","DATA_EXPEDICAO","NR_PESQUISA","NUMERO_DOCUMENTO","ORGAO_EXPEDIDOR","TIPO","PRINCIPAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PESSOA_ID","ID_PESSOA_ATTORNATUS","ID_DOCUMENTO_ATTORNATUS"]},{"schema":"ATT_PESSOA","name":"GRUPO_ECONOMICO_TEM_PESSOA","fullName":"ATT_PESSOA.GRUPO_ECONOMICO_TEM_PESSOA","columns":["ID","GRUPO_ECONOMICO_ID","PESSOA_ID","VALOR_TOTAL_DIVIDAS","QUANTIDADE_PROCESSOS","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PESSOA","name":"RESPONSABILIDADE_SOCIETARIA","fullName":"ATT_PESSOA.RESPONSABILIDADE_SOCIETARIA","columns":["ID","PESSOA_ID","PESSOA_VINCULADA_ID","TIPO","DATA_RESPONSABILIDADE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NOME_PESSOA_ID","NOME_PESSOA_VINCULADA_ID"]},{"schema":"ATT_CALCULO","name":"MOEDA","fullName":"ATT_CALCULO.MOEDA","columns":["ID","CODIGO_ISO","SIMBOLO","NOME","CASAS_DECIMAIS","OBSOLETO","DATA_INICIO","DATA_TERMINO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_CALCULO","name":"INDICE","fullName":"ATT_CALCULO.INDICE","columns":["ID","NOME","PERIODICIDADE","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID","SIGLA","OBSERVACAO","REGIME","DATA_ENCERRAMENTO"]},{"schema":"ATT_CALCULO","name":"SEQUENCE","fullName":"ATT_CALCULO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_CALCULO","name":"FAIXA_IMPOSTO","fullName":"ATT_CALCULO.FAIXA_IMPOSTO","columns":["ID","VIGENCIA_IMPOSTO_ID","VALOR_INICIAL","VALOR_FINAL","PERCENTUAL_ALIQUOTA","VALOR_DEDUCAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_CALCULO","name":"JURO_TRIBUNAL","fullName":"ATT_CALCULO.JURO_TRIBUNAL","columns":["ID","TRIBUNAL_ID","TIPO","FONTE","REGIME","PERIODICIDADE","INCIDENCIA","DATA_INICIAL","DATA_FINAL","JURO_FIXO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_CALCULO","name":"VARIACAO_INDICE","fullName":"ATT_CALCULO.VARIACAO_INDICE","columns":["ID","INDICE_ID","DATA","VALOR","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_CALCULO","name":"VIGENCIA_IMPOSTO","fullName":"ATT_CALCULO.VIGENCIA_IMPOSTO","columns":["ID","DATA_INICIAL","DATA_FINAL","VALOR_BONUS","VALOR_ABATIMENTO_DEPENDENTE","VALOR_TETO","TIPO_IMPOSTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","VALOR_LIMITE_REDUCAO_TOTAL","VALOR_LIMITE_REDUCAO_GRADUAL","VALOR_CONSTANTE_REDUCAO","FATOR_REDUCAO_GRADUAL","VALOR_MAXIMO_REDUCAO"]},{"schema":"ATT_CALCULO","name":"INDEXADOR_TRIBUNAL","fullName":"ATT_CALCULO.INDEXADOR_TRIBUNAL","columns":["ID","TRIBUNAL_ID","INDEXADOR_ID","DATA_INICIAL","DATA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_SUGESTAO"]},{"schema":"ATT_CALCULO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_CALCULO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_DEMANDA","name":"PRAZO","fullName":"ATT_DEMANDA.PRAZO","columns":["ID","TIPO_ANDAMENTO_ID","JUIZADO_ESPECIAL","CLASSE_ID","SEGMENTO_JUDICIAL_ID","TIPO_DOCUMENTO_ID","PRAZO","AGENDAR","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","PRAZO_DESPACHO","INSTITUICAO_ID","LOCAL_DISTRIBUICAO_ID"]},{"schema":"ATT_DEMANDA","name":"FERIADO","fullName":"ATT_DEMANDA.FERIADO","columns":["ID","DESCRICAO","DIA","MES","ANO","UF","MUNICIPIO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"SEQUENCE","fullName":"ATT_DEMANDA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_JOB","fullName":"ATT_DEMANDA.ACT_RU_JOB","columns":["ID_","REV_","TYPE_","LOCK_EXP_TIME_","LOCK_OWNER_","EXCLUSIVE_","EXECUTION_ID_","PROCESS_INSTANCE_ID_","PROCESS_DEF_ID_","PROCESS_DEF_KEY_","RETRIES_","EXCEPTION_STACK_ID_","EXCEPTION_MSG_","FAILED_ACT_ID_","DUEDATE_","REPEAT_","REPEAT_OFFSET_","HANDLER_TYPE_","HANDLER_CFG_","DEPLOYMENT_ID_","SUSPENSION_STATE_","JOB_DEF_ID_","PRIORITY_","SEQUENCE_COUNTER_","TENANT_ID_","CREATE_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_INFO","fullName":"ATT_DEMANDA.ACT_ID_INFO","columns":["ID_","REV_","USER_ID_","TYPE_","KEY_","VALUE_","PASSWORD_","PARENT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_USER","fullName":"ATT_DEMANDA.ACT_ID_USER","columns":["ID_","REV_","FIRST_","LAST_","EMAIL_","PWD_","SALT_","LOCK_EXP_TIME_","ATTEMPTS_","PICTURE_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_TASK","fullName":"ATT_DEMANDA.ACT_RU_TASK","columns":["ID_","REV_","EXECUTION_ID_","PROC_INST_ID_","PROC_DEF_ID_","CASE_EXECUTION_ID_","CASE_INST_ID_","CASE_DEF_ID_","NAME_","PARENT_TASK_ID_","DESCRIPTION_","TASK_DEF_KEY_","OWNER_","ASSIGNEE_","DELEGATION_","PRIORITY_","CREATE_TIME_","DUE_DATE_","FOLLOW_UP_DATE_","SUSPENSION_STATE_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_BATCH","fullName":"ATT_DEMANDA.ACT_HI_BATCH","columns":["ID_","TYPE_","TOTAL_JOBS_","JOBS_PER_SEED_","INVOCATIONS_PER_JOB_","SEED_JOB_DEF_ID_","MONITOR_JOB_DEF_ID_","BATCH_JOB_DEF_ID_","TENANT_ID_","CREATE_USER_ID_","START_TIME_","END_TIME_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_GROUP","fullName":"ATT_DEMANDA.ACT_ID_GROUP","columns":["ID_","REV_","NAME_","TYPE_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_BATCH","fullName":"ATT_DEMANDA.ACT_RU_BATCH","columns":["ID_","REV_","TYPE_","TOTAL_JOBS_","JOBS_CREATED_","JOBS_PER_SEED_","INVOCATIONS_PER_JOB_","SEED_JOB_DEF_ID_","BATCH_JOB_DEF_ID_","MONITOR_JOB_DEF_ID_","SUSPENSION_STATE_","CONFIGURATION_","TENANT_ID_","CREATE_USER_ID_"]},{"schema":"ATT_DEMANDA","name":"FLOW_STARTER","fullName":"ATT_DEMANDA.FLOW_STARTER","columns":["ID","TIPO_ANDAMENTO_ID","BPMN","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","INSTITUICAO_ID","MATERIA_ID","TIPO_PROCESSO"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_DEC_IN","fullName":"ATT_DEMANDA.ACT_HI_DEC_IN","columns":["ID_","DEC_INST_ID_","CLAUSE_ID_","CLAUSE_NAME_","VAR_TYPE_","BYTEARRAY_ID_","DOUBLE_","LONG_","TEXT_","TEXT2_","TENANT_ID_","CREATE_TIME_","ROOT_PROC_INST_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_DETAIL","fullName":"ATT_DEMANDA.ACT_HI_DETAIL","columns":["ID_","TYPE_","PROC_DEF_KEY_","PROC_DEF_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","CASE_DEF_KEY_","CASE_DEF_ID_","CASE_INST_ID_","CASE_EXECUTION_ID_","TASK_ID_","ACT_INST_ID_","VAR_INST_ID_","NAME_","VAR_TYPE_","REV_","TIME_","BYTEARRAY_ID_","DOUBLE_","LONG_","TEXT_","TEXT2_","SEQUENCE_COUNTER_","TENANT_ID_","OPERATION_ID_","REMOVAL_TIME_","INITIAL_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_OP_LOG","fullName":"ATT_DEMANDA.ACT_HI_OP_LOG","columns":["ID_","DEPLOYMENT_ID_","PROC_DEF_ID_","PROC_DEF_KEY_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","CASE_DEF_ID_","CASE_INST_ID_","CASE_EXECUTION_ID_","TASK_ID_","JOB_ID_","JOB_DEF_ID_","BATCH_ID_","USER_ID_","TIMESTAMP_","OPERATION_TYPE_","OPERATION_ID_","ENTITY_TYPE_","PROPERTY_","ORG_VALUE_","NEW_VALUE_","TENANT_ID_","REMOVAL_TIME_","CATEGORY_","EXTERNAL_TASK_ID_","ANNOTATION_"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_TENANT","fullName":"ATT_DEMANDA.ACT_ID_TENANT","columns":["ID_","REV_","NAME_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_FILTER","fullName":"ATT_DEMANDA.ACT_RU_FILTER","columns":["ID_","REV_","RESOURCE_TYPE_","NAME_","OWNER_","QUERY_","PROPERTIES_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_JOBDEF","fullName":"ATT_DEMANDA.ACT_RU_JOBDEF","columns":["ID_","REV_","PROC_DEF_ID_","PROC_DEF_KEY_","ACT_ID_","JOB_TYPE_","JOB_CONFIGURATION_","SUSPENSION_STATE_","JOB_PRIORITY_","TENANT_ID_","DEPLOYMENT_ID_"]},{"schema":"ATT_DEMANDA","name":"MODELO_PADRAO","fullName":"ATT_DEMANDA.MODELO_PADRAO","columns":["ID","INSTITUICAO_ID","TIPO_ANDAMENTO_ID","TIPO_DOCUMENTO_ID","USUARIO","ASSUNTO_ID","MODELO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_ACTINST","fullName":"ATT_DEMANDA.ACT_HI_ACTINST","columns":["ID_","PARENT_ACT_INST_ID_","PROC_DEF_KEY_","PROC_DEF_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","ACT_ID_","TASK_ID_","CALL_PROC_INST_ID_","CALL_CASE_INST_ID_","ACT_NAME_","ACT_TYPE_","ASSIGNEE_","START_TIME_","END_TIME_","DURATION_","ACT_INST_STATE_","SEQUENCE_COUNTER_","TENANT_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_COMMENT","fullName":"ATT_DEMANDA.ACT_HI_COMMENT","columns":["ID_","TYPE_","TIME_","USER_ID_","TASK_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","ACTION_","MESSAGE_","FULL_MSG_","TENANT_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_DECINST","fullName":"ATT_DEMANDA.ACT_HI_DECINST","columns":["ID_","DEC_DEF_ID_","DEC_DEF_KEY_","DEC_DEF_NAME_","PROC_DEF_KEY_","PROC_DEF_ID_","PROC_INST_ID_","CASE_DEF_KEY_","CASE_DEF_ID_","CASE_INST_ID_","ACT_INST_ID_","ACT_ID_","EVAL_TIME_","REMOVAL_TIME_","COLLECT_VALUE_","USER_ID_","ROOT_DEC_INST_ID_","ROOT_PROC_INST_ID_","DEC_REQ_ID_","DEC_REQ_KEY_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_DEC_OUT","fullName":"ATT_DEMANDA.ACT_HI_DEC_OUT","columns":["ID_","DEC_INST_ID_","CLAUSE_ID_","CLAUSE_NAME_","RULE_ID_","RULE_ORDER_","VAR_NAME_","VAR_TYPE_","BYTEARRAY_ID_","DOUBLE_","LONG_","TEXT_","TEXT2_","TENANT_ID_","CREATE_TIME_","ROOT_PROC_INST_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_JOB_LOG","fullName":"ATT_DEMANDA.ACT_HI_JOB_LOG","columns":["ID_","TIMESTAMP_","JOB_ID_","JOB_DUEDATE_","JOB_RETRIES_","JOB_PRIORITY_","JOB_EXCEPTION_MSG_","JOB_EXCEPTION_STACK_ID_","JOB_STATE_","JOB_DEF_ID_","JOB_DEF_TYPE_","JOB_DEF_CONFIGURATION_","ACT_ID_","FAILED_ACT_ID_","EXECUTION_ID_","ROOT_PROC_INST_ID_","PROCESS_INSTANCE_ID_","PROCESS_DEF_ID_","PROCESS_DEF_KEY_","DEPLOYMENT_ID_","SEQUENCE_COUNTER_","TENANT_ID_","HOSTNAME_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_VARINST","fullName":"ATT_DEMANDA.ACT_HI_VARINST","columns":["ID_","PROC_DEF_KEY_","PROC_DEF_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","ACT_INST_ID_","CASE_DEF_KEY_","CASE_DEF_ID_","CASE_INST_ID_","CASE_EXECUTION_ID_","TASK_ID_","NAME_","VAR_TYPE_","CREATE_TIME_","REV_","BYTEARRAY_ID_","DOUBLE_","LONG_","TEXT_","TEXT2_","TENANT_ID_","STATE_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_RE_PROCDEF","fullName":"ATT_DEMANDA.ACT_RE_PROCDEF","columns":["ID_","REV_","CATEGORY_","NAME_","KEY_","VERSION_","DEPLOYMENT_ID_","RESOURCE_NAME_","DGRM_RESOURCE_NAME_","HAS_START_FORM_KEY_","SUSPENSION_STATE_","TENANT_ID_","VERSION_TAG_","HISTORY_TTL_","STARTABLE_"]},{"schema":"ATT_DEMANDA","name":"TIPO_ATIVIDADE","fullName":"ATT_DEMANDA.TIPO_ATIVIDADE","columns":["ID","INSTITUICAO_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DEMANDA","name":"ACT_GE_PROPERTY","fullName":"ATT_DEMANDA.ACT_GE_PROPERTY","columns":["NAME_","VALUE_","REV_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_CASEINST","fullName":"ATT_DEMANDA.ACT_HI_CASEINST","columns":["ID_","CASE_INST_ID_","BUSINESS_KEY_","CASE_DEF_ID_","CREATE_TIME_","CLOSE_TIME_","DURATION_","STATE_","CREATE_USER_ID_","SUPER_CASE_INSTANCE_ID_","SUPER_PROCESS_INSTANCE_ID_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_INCIDENT","fullName":"ATT_DEMANDA.ACT_HI_INCIDENT","columns":["ID_","PROC_DEF_KEY_","PROC_DEF_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","CREATE_TIME_","END_TIME_","INCIDENT_MSG_","INCIDENT_TYPE_","ACTIVITY_ID_","FAILED_ACTIVITY_ID_","CAUSE_INCIDENT_ID_","ROOT_CAUSE_INCIDENT_ID_","CONFIGURATION_","HISTORY_CONFIGURATION_","INCIDENT_STATE_","TENANT_ID_","JOB_DEF_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_PROCINST","fullName":"ATT_DEMANDA.ACT_HI_PROCINST","columns":["ID_","PROC_INST_ID_","BUSINESS_KEY_","PROC_DEF_KEY_","PROC_DEF_ID_","START_TIME_","END_TIME_","REMOVAL_TIME_","DURATION_","START_USER_ID_","START_ACT_ID_","END_ACT_ID_","SUPER_PROCESS_INSTANCE_ID_","ROOT_PROC_INST_ID_","SUPER_CASE_INSTANCE_ID_","CASE_INST_ID_","DELETE_REASON_","TENANT_ID_","STATE_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_TASKINST","fullName":"ATT_DEMANDA.ACT_HI_TASKINST","columns":["ID_","TASK_DEF_KEY_","PROC_DEF_KEY_","PROC_DEF_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","EXECUTION_ID_","CASE_DEF_KEY_","CASE_DEF_ID_","CASE_INST_ID_","CASE_EXECUTION_ID_","ACT_INST_ID_","PARENT_TASK_ID_","NAME_","DESCRIPTION_","OWNER_","ASSIGNEE_","START_TIME_","END_TIME_","DURATION_","DELETE_REASON_","PRIORITY_","DUE_DATE_","FOLLOW_UP_DATE_","TENANT_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_RE_CASE_DEF","fullName":"ATT_DEMANDA.ACT_RE_CASE_DEF","columns":["ID_","REV_","CATEGORY_","NAME_","KEY_","VERSION_","DEPLOYMENT_ID_","RESOURCE_NAME_","DGRM_RESOURCE_NAME_","TENANT_ID_","HISTORY_TTL_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_EXT_TASK","fullName":"ATT_DEMANDA.ACT_RU_EXT_TASK","columns":["ID_","REV_","WORKER_ID_","TOPIC_NAME_","RETRIES_","ERROR_MSG_","ERROR_DETAILS_ID_","LOCK_EXP_TIME_","SUSPENSION_STATE_","EXECUTION_ID_","PROC_INST_ID_","PROC_DEF_ID_","PROC_DEF_KEY_","ACT_ID_","ACT_INST_ID_","TENANT_ID_","PRIORITY_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_INCIDENT","fullName":"ATT_DEMANDA.ACT_RU_INCIDENT","columns":["ID_","REV_","INCIDENT_TIMESTAMP_","INCIDENT_MSG_","INCIDENT_TYPE_","EXECUTION_ID_","ACTIVITY_ID_","FAILED_ACTIVITY_ID_","PROC_INST_ID_","PROC_DEF_ID_","CAUSE_INCIDENT_ID_","ROOT_CAUSE_INCIDENT_ID_","CONFIGURATION_","TENANT_ID_","JOB_DEF_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_VARIABLE","fullName":"ATT_DEMANDA.ACT_RU_VARIABLE","columns":["ID_","REV_","TYPE_","NAME_","EXECUTION_ID_","PROC_INST_ID_","PROC_DEF_ID_","CASE_EXECUTION_ID_","CASE_INST_ID_","TASK_ID_","BATCH_ID_","BYTEARRAY_ID_","DOUBLE_","LONG_","TEXT_","TEXT2_","VAR_SCOPE_","SEQUENCE_COUNTER_","IS_CONCURRENT_LOCAL_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"RECESSO_FORENSE","fullName":"ATT_DEMANDA.RECESSO_FORENSE","columns":["ID","DESCRICAO","DIA_INICIAL","MES_INICIAL","ANO_INICIAL","DIA_FINAL","MES_FINAL","ANO_FINAL","DATA_INICIAL","DATA_FINAL","UNIDADE_JUDICIAL_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"ACT_GE_BYTEARRAY","fullName":"ATT_DEMANDA.ACT_GE_BYTEARRAY","columns":["ID_","REV_","NAME_","DEPLOYMENT_ID_","BYTES_","GENERATED_","TENANT_ID_","TYPE_","CREATE_TIME_","ROOT_PROC_INST_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_EXECUTION","fullName":"ATT_DEMANDA.ACT_RU_EXECUTION","columns":["ID_","REV_","ROOT_PROC_INST_ID_","PROC_INST_ID_","BUSINESS_KEY_","PARENT_ID_","PROC_DEF_ID_","SUPER_EXEC_","SUPER_CASE_EXEC_","CASE_INST_ID_","ACT_ID_","ACT_INST_ID_","IS_ACTIVE_","IS_CONCURRENT_","IS_SCOPE_","IS_EVENT_SCOPE_","SUSPENSION_STATE_","CACHED_ENT_STATE_","SEQUENCE_COUNTER_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_METER_LOG","fullName":"ATT_DEMANDA.ACT_RU_METER_LOG","columns":["ID_","NAME_","REPORTER_","VALUE_","TIMESTAMP_","MILLISECONDS_"]},{"schema":"ATT_DEMANDA","name":"SITUACAO_DEMANDA","fullName":"ATT_DEMANDA.SITUACAO_DEMANDA","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"USO_REQUERIMENTO","fullName":"ATT_DEMANDA.USO_REQUERIMENTO","columns":["ID","INSTITUICAO_ID","TIPO_DOCUMENTO_ID","LOCAL_DISTRIBUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"ACT_GE_SCHEMA_LOG","fullName":"ATT_DEMANDA.ACT_GE_SCHEMA_LOG","columns":["ID_","TIMESTAMP_","VERSION_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_ATTACHMENT","fullName":"ATT_DEMANDA.ACT_HI_ATTACHMENT","columns":["ID_","REV_","USER_ID_","NAME_","DESCRIPTION_","TYPE_","TASK_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","URL_","CONTENT_ID_","TENANT_ID_","CREATE_TIME_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_MEMBERSHIP","fullName":"ATT_DEMANDA.ACT_ID_MEMBERSHIP","columns":["USER_ID_","GROUP_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RE_DEPLOYMENT","fullName":"ATT_DEMANDA.ACT_RE_DEPLOYMENT","columns":["ID_","NAME_","DEPLOY_TIME_","SOURCE_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_CASEACTINST","fullName":"ATT_DEMANDA.ACT_HI_CASEACTINST","columns":["ID_","PARENT_ACT_INST_ID_","CASE_DEF_ID_","CASE_INST_ID_","CASE_ACT_ID_","TASK_ID_","CALL_PROC_INST_ID_","CALL_CASE_INST_ID_","CASE_ACT_NAME_","CASE_ACT_TYPE_","CREATE_TIME_","END_TIME_","DURATION_","STATE_","REQUIRED_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ITEM_PROCESSAMENTO","fullName":"ATT_DEMANDA.ITEM_PROCESSAMENTO","columns":["ID","LOTE_PROCESSAMENTO_ID","DEMANDA_ID","PROCESSO_ID","DESCRICAO_ERRO","DATA_TERMINO_PROCESSAMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"LOTE_PROCESSAMENTO","fullName":"ATT_DEMANDA.LOTE_PROCESSAMENTO","columns":["ID","ACTION","CHAVE_DEMANDA_AGRUPADA","NOME_DEMANDA","QUANTIDADE","QUANTIDADE_ERROS","DATA_TERMINO_PROCESSAMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ESTRATEGIA_EXECUCAO"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_EXT_TASK_LOG","fullName":"ATT_DEMANDA.ACT_HI_EXT_TASK_LOG","columns":["ID_","TIMESTAMP_","EXT_TASK_ID_","RETRIES_","TOPIC_NAME_","WORKER_ID_","PRIORITY_","ERROR_MSG_","ERROR_DETAILS_ID_","ACT_ID_","ACT_INST_ID_","EXECUTION_ID_","ROOT_PROC_INST_ID_","PROC_INST_ID_","PROC_DEF_ID_","PROC_DEF_KEY_","TENANT_ID_","STATE_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_HI_IDENTITYLINK","fullName":"ATT_DEMANDA.ACT_HI_IDENTITYLINK","columns":["ID_","TIMESTAMP_","TYPE_","USER_ID_","GROUP_ID_","TASK_ID_","ROOT_PROC_INST_ID_","PROC_DEF_ID_","OPERATION_TYPE_","ASSIGNER_ID_","PROC_DEF_KEY_","TENANT_ID_","REMOVAL_TIME_"]},{"schema":"ATT_DEMANDA","name":"ACT_RE_DECISION_DEF","fullName":"ATT_DEMANDA.ACT_RE_DECISION_DEF","columns":["ID_","REV_","CATEGORY_","NAME_","KEY_","VERSION_","DEPLOYMENT_ID_","RESOURCE_NAME_","DGRM_RESOURCE_NAME_","DEC_REQ_ID_","DEC_REQ_KEY_","TENANT_ID_","HISTORY_TTL_","VERSION_TAG_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_EVENT_SUBSCR","fullName":"ATT_DEMANDA.ACT_RU_EVENT_SUBSCR","columns":["ID_","REV_","EVENT_TYPE_","EVENT_NAME_","EXECUTION_ID_","PROC_INST_ID_","ACTIVITY_ID_","CONFIGURATION_","CREATED_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_IDENTITYLINK","fullName":"ATT_DEMANDA.ACT_RU_IDENTITYLINK","columns":["ID_","REV_","GROUP_ID_","TYPE_","USER_ID_","TASK_ID_","PROC_DEF_ID_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ATIVIDADE_REALIZADA","fullName":"ATT_DEMANDA.ATIVIDADE_REALIZADA","columns":["ID","TIPO_ATIVIDADE_ID","INSTITUICAO_ID","NUMERO_PROCESSO","NUMERO_PASTA","BUSINESS_KEY","DATA_ATIVIDADE","DURACAO","DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PROCESSO_ID"]},{"schema":"ATT_DEMANDA","name":"HISTORICO_ANDAMENTO","fullName":"ATT_DEMANDA.HISTORICO_ANDAMENTO","columns":["ID","INSTITUICAO_ID","BUSINESS_KEY","DATA","TIPO","TIPO_ANDAMENTO_ID","USUARIO","TIPO_DEMANDA","DOCUMENTO_ID","PROCESSO_ID","DEMANDA_ID","COMPLEMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","VISIVEL_USUARIO_EXTERNO"]},{"schema":"ATT_DEMANDA","name":"ACT_ID_TENANT_MEMBER","fullName":"ATT_DEMANDA.ACT_ID_TENANT_MEMBER","columns":["ID_","TENANT_ID_","USER_ID_","GROUP_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_AUTHORIZATION","fullName":"ATT_DEMANDA.ACT_RU_AUTHORIZATION","columns":["ID_","REV_","TYPE_","GROUP_ID_","USER_ID_","RESOURCE_TYPE_","RESOURCE_ID_","PERMS_","REMOVAL_TIME_","ROOT_PROC_INST_ID_"]},{"schema":"ATT_DEMANDA","name":"DEVOLUCAO_AUTOMATICA","fullName":"ATT_DEMANDA.DEVOLUCAO_AUTOMATICA","columns":["ID","NOME","LOCAL_DISTRIBUICAO_ID","TIPO_ANDAMENTO_ID","INSTITUICAO_ID","PERCENTUAL","CREATED_BY","CREATED_DATE","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_CASE_EXECUTION","fullName":"ATT_DEMANDA.ACT_RU_CASE_EXECUTION","columns":["ID_","REV_","CASE_INST_ID_","SUPER_CASE_EXEC_","SUPER_EXEC_","BUSINESS_KEY_","PARENT_ID_","CASE_DEF_ID_","ACT_ID_","PREV_STATE_","CURRENT_STATE_","REQUIRED_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_DEMANDA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_DEMANDA","name":"ACT_RE_DECISION_REQ_DEF","fullName":"ATT_DEMANDA.ACT_RE_DECISION_REQ_DEF","columns":["ID_","REV_","CATEGORY_","NAME_","KEY_","VERSION_","DEPLOYMENT_ID_","RESOURCE_NAME_","DGRM_RESOURCE_NAME_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"ACT_RU_CASE_SENTRY_PART","fullName":"ATT_DEMANDA.ACT_RU_CASE_SENTRY_PART","columns":["ID_","REV_","CASE_INST_ID_","CASE_EXEC_ID_","SENTRY_ID_","TYPE_","SOURCE_CASE_EXEC_ID_","STANDARD_EVENT_","SOURCE_","VARIABLE_EVENT_","VARIABLE_NAME_","SATISFIED_","TENANT_ID_"]},{"schema":"ATT_DEMANDA","name":"DEVOLUCAO_AUTOMATICA_TIPO_DEVOLUCAO","fullName":"ATT_DEMANDA.DEVOLUCAO_AUTOMATICA_TIPO_DEVOLUCAO","columns":["DEVOLUCAO_AUTOMATICA_ID","TIPO_DEVOLUCAO"]},{"schema":"ATT_DEMANDA","name":"HISTORICO_ANDAMENTO_TEM_CHAVE_VALOR","fullName":"ATT_DEMANDA.HISTORICO_ANDAMENTO_TEM_CHAVE_VALOR","columns":["HISTORICO_ANDAMENTO_ID","CHAVE","VALOR"]},{"schema":"ATT_DEMANDA","name":"ATIVIDADE_REALIZADA_TEM_PARTICIPANTE","fullName":"ATT_DEMANDA.ATIVIDADE_REALIZADA_TEM_PARTICIPANTE","columns":["ATIVIDADE_REALIZADA_ID","PARTICIPANTE"]},{"schema":"ATT_PROCESSO","name":"CARGA","fullName":"ATT_PROCESSO.CARGA","columns":["ID","PROCESSO_ID","DATA_DEVOLUCAO","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_CANCELAMENTO"]},{"schema":"ATT_PROCESSO","name":"JUIZO","fullName":"ATT_PROCESSO.JUIZO","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"PASTA","fullName":"ATT_PROCESSO.PASTA","columns":["ID","INSTITUICAO_ID","NUMERO","MATERIA_ID","SITUACAO_ATUAL_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","RESULTADO_FINANCEIRO","INDICE_ATUALIZACAO_ID","DATA_CANCELAMENTO","TIPO_ACESSO","RISCO_FISCAL","DATA_PREVISTA_DESEMBOLSO","NATUREZA_PRETENSAO_ID"]},{"schema":"ATT_PROCESSO","name":"CLASSE","fullName":"ATT_PROCESSO.CLASSE","columns":["ID","CLASSE_PAI_ID","NOME","SIGLA","NUMERACAO_PROPRIA","HIERARQUIA","DATA_ATUALIZACAO_CNJ","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","APLICACAO","OBSOLETO","SELECIONAVEL"]},{"schema":"ATT_PROCESSO","name":"MATERIA","fullName":"ATT_PROCESSO.MATERIA","columns":["ID","NOME","OBSOLETO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID"]},{"schema":"ATT_PROCESSO","name":"ANOTACAO","fullName":"ATT_PROCESSO.ANOTACAO","columns":["ID","DESCRICAO","PASTA_ID","LOCAL_ID","VISIBILIDADE","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"ETIQUETA","fullName":"ATT_PROCESSO.ETIQUETA","columns":["ID","PASTA_ID","VALOR","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CHAVE_ETIQUETA"]},{"schema":"ATT_PROCESSO","name":"PROCESSO","fullName":"ATT_PROCESSO.PROCESSO","columns":["ID","INSTITUICAO_ID","NR_PESQUISA","NUMERO","JUIZADO_ESPECIAL","CLASSE_ID","JUIZO_ID","PARTICIPACAO_CONTRARIA_ID","PARTICIPACAO_REPRESENTADA_ID","PASTA_ID","PROCESSO_PAI_ID","UNIDADE_JUDICIAL_ID","ELETRONICO_JUDICIARIO","DATA_AJUIZAMENTO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","SINCRONIZACAO_JUDICIARIO","DATA_SINCRONIZACAO_JUDICIARIO","SEGREDO_JUSTICA","LOCAL_ORIGEM_ID","OBSERVACOES","TIPO_PROCESSO","LOTE_PROCESSAMENTO_ID","SITUACAO_ATUAL_ID","IDENTIFICADOR_INTEGRACAO","MOTIVO_CANCELAMENTO","DATA_CANCELAMENTO","QUANTIDADE_DOCUMENTOS_JUDICIARIO","PEDIDO","QUANTIDADE_ANDAMENTOS_JUDICIARIO","SITUACAO_LITISPENDENCIA","JUDICIARIO_INTEGRACAO_ID","DATA_ANEXACAO","PROCESSAMENTO_ACTION_ID"]},{"schema":"ATT_PROCESSO","name":"SEQUENCE","fullName":"ATT_PROCESSO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_PROCESSO","name":"TRIBUNAL","fullName":"ATT_PROCESSO.TRIBUNAL","columns":["ID","NOME","SEGMENTO_JUDICIAL_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PERCENTUAL_IRRF"]},{"schema":"ATT_PROCESSO","name":"ANDAMENTO","fullName":"ATT_PROCESSO.ANDAMENTO","columns":["ID","INSTITUICAO_ID","PROCESSO_ID","DATA_ANDAMENTO","TIPO_ANDAMENTO_ID","ORIGEM","COMPLEMENTO","DOCUMENTO_ID","BUSINESS_KEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_VENCIMENTO","IDENTIFICADOR_NA_PASTA","IDENTIFICADOR_NA_ORIGEM","CANCELADO_POR","DATA_CANCELAMENTO","ORIGEM_CLASSIFICACAO"]},{"schema":"ATT_PROCESSO","name":"VALOR_TIPO","fullName":"ATT_PROCESSO.VALOR_TIPO","columns":["ID","DESCRICAO","ORDEM_EXIBICAO","ATIVO","PERMITE_MULTIPLOS_REGISTROS","CATEGORIA","VERSION","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_CNJ","fullName":"ATT_PROCESSO.ASSUNTO_CNJ","columns":["ID","ASSUNTO_PAI_ID","NOME","HIERARQUIA","DATA_ATUALIZACAO_CNJ","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"VALOR_PASTA","fullName":"ATT_PROCESSO.VALOR_PASTA","columns":["ID","PASTA_ID","TIPO","DATA_VALOR_HISTORICO","VALOR_HISTORICO","DATA_VALOR_ATUALIZADO","VALOR_ATUALIZADO","OBSERVACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INDICE_ATUALIZACAO_ID"]},{"schema":"ATT_PROCESSO","name":"OUTRO_NUMERO","fullName":"ATT_PROCESSO.OUTRO_NUMERO","columns":["ID","PROCESSO_ID","NOME","NUMERO","NR_PESQUISA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"PARTICIPACAO","fullName":"ATT_PROCESSO.PARTICIPACAO","columns":["ID","PESSOA_ID","TIPO_PARTICIPACAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","PROCESSO_ID","NOME_ID","ENDERECO_ID","BUSINESS_KEY_ATUALIZACAO_ENDERECO"]},{"schema":"ATT_PROCESSO","name":"QUALIFICACAO","fullName":"ATT_PROCESSO.QUALIFICACAO","columns":["ID","NOME","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"USO_ETIQUETA","fullName":"ATT_PROCESSO.USO_ETIQUETA","columns":["ID","MATERIA_ID","ASSUNTO_INSTITUICAO_ID","OBRIGATORIO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CHAVE_ETIQUETA"]},{"schema":"ATT_PROCESSO","name":"ANDAMENTO_TMP","fullName":"ATT_PROCESSO.ANDAMENTO_TMP","columns":["ID","INSTITUICAO_ID","PROCESSO_ID","DATA_ANDAMENTO","TIPO_ANDAMENTO_ID","ORIGEM","COMPLEMENTO","DOCUMENTO_ID","BUSINESS_KEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_VENCIMENTO","IDENTIFICADOR_NA_PASTA"]},{"schema":"ATT_PROCESSO","name":"ANDAMENTO_TEMP","fullName":"ATT_PROCESSO.ANDAMENTO_TEMP","columns":["ID","INSTITUICAO_ID","PROCESSO_ID","DATA_ANDAMENTO","TIPO_ANDAMENTO_ID","ORIGEM","COMPLEMENTO","DOCUMENTO_ID","BUSINESS_KEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_VENCIMENTO"]},{"schema":"ATT_PROCESSO","name":"CHAVE_ETIQUETA","fullName":"ATT_PROCESSO.CHAVE_ETIQUETA","columns":["CHAVE","NOME","INCLUSAO_DINAMICA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"LITISPENDENCIA","fullName":"ATT_PROCESSO.LITISPENDENCIA","columns":["ID","REFERENCIA_PARTICIPACAO_ID","SUSPEITA_PARTICIPACAO_ID","SITUACAO","ORIGEM","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"MIGRACAO_PASTA","fullName":"ATT_PROCESSO.MIGRACAO_PASTA","columns":["ID_ORIGEM","ID_ATTORNATUS"]},{"schema":"ATT_PROCESSO","name":"SITUACAO_PASTA","fullName":"ATT_PROCESSO.SITUACAO_PASTA","columns":["ID","TIPO_SITUACAO_ID","DATA_SITUACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"TIPO_ANDAMENTO","fullName":"ATT_PROCESSO.TIPO_ANDAMENTO","columns":["ID","NOME","AUDIENCIA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_SITUACAO_PASTA_ID","TIPO_SITUACAO_PROCESSO_ID","INSTITUICAO_ID"]},{"schema":"ATT_PROCESSO","name":"VALOR_EVOLUCAO","fullName":"ATT_PROCESSO.VALOR_EVOLUCAO","columns":["ID","PASTA_ID","VALOR_TIPO_ID","MONTANTE","MONTANTE_ORIGINAL","DATA_ATUALIZACAO","DATA_ATUALIZACAO_ORIGINAL","OBSERVACAO","VERSION","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","DATA_CANCELAMENTO","BUSINESS_KEY"]},{"schema":"ATT_PROCESSO","name":"COMPETENCIA_CNJ","fullName":"ATT_PROCESSO.COMPETENCIA_CNJ","columns":["ID","NOME"]},{"schema":"ATT_PROCESSO","name":"USO_COMPLEMENTO","fullName":"ATT_PROCESSO.USO_COMPLEMENTO","columns":["ID","TIPO_ANDAMENTO_ID","TIPO_COMPLEMENTO_ID","OBRIGATORIO","MULTIPLA_SELECAO","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"DOMINIO_ETIQUETA","fullName":"ATT_PROCESSO.DOMINIO_ETIQUETA","columns":["ID","NOME","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CHAVE_ETIQUETA"]},{"schema":"ATT_PROCESSO","name":"TIPO_COMPLEMENTO","fullName":"ATT_PROCESSO.TIPO_COMPLEMENTO","columns":["ID","TIPO_DADO","NOME","MASCARA","TAMANHO_MINIMO","TAMANHO_MAXIMO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"UNIDADE_JUDICIAL","fullName":"ATT_PROCESSO.UNIDADE_JUDICIAL","columns":["ID","TRIBUNAL_ID","NOME","INSTANCIA","MUNICIPIO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ASSINATURA_ELETRONICA_PROCESSO_FISICO","OBSOLETO"]},{"schema":"ATT_PROCESSO","name":"USO_RISCO_FISCAL","fullName":"ATT_PROCESSO.USO_RISCO_FISCAL","columns":["ID","INSTITUICAO_ID","ASSUNTO_INSTITUICAO_ID","CLASSE_ID","RISCO_FISCAL","DIAS_PARA_DESEMBOLSO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"MIGRACAO_PROCESSO","fullName":"ATT_PROCESSO.MIGRACAO_PROCESSO","columns":["ID_ORIGEM","ID_ATTORNATUS","NR_PESQUISA","TRIBUNAL_ID","MATERIA_ID"]},{"schema":"ATT_PROCESSO","name":"SEGMENTO_JUDICIAL","fullName":"ATT_PROCESSO.SEGMENTO_JUDICIAL","columns":["ID","NOME","FEDERAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"SITUACAO_PROCESSO","fullName":"ATT_PROCESSO.SITUACAO_PROCESSO","columns":["ID","TIPO_SITUACAO_ID","DATA_SITUACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PROCESSO_ID"]},{"schema":"ATT_PROCESSO","name":"TIPO_PARTICIPACAO","fullName":"ATT_PROCESSO.TIPO_PARTICIPACAO","columns":["ID","POLO","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"NATUREZA_PRETENSAO","fullName":"ATT_PROCESSO.NATUREZA_PRETENSAO","columns":["ID","NOME","INSTITUICAO_ID","OBSOLETO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"PASTA_TEM_SITUACAO","fullName":"ATT_PROCESSO.PASTA_TEM_SITUACAO","columns":["PASTA_ID","SITUACAO_PASTA_ID"]},{"schema":"ATT_PROCESSO","name":"PROCESSO_VINCULADO","fullName":"ATT_PROCESSO.PROCESSO_VINCULADO","columns":["ID","INSTITUICAO_ID","PROCESSO_ORIGEM_ID","PROCESSO_DESTINO_ID","MODALIDADE","DATA_VINCULO","MOTIVO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_INSTITUICAO","fullName":"ATT_PROCESSO.ASSUNTO_INSTITUICAO","columns":["ID","ASSUNTO_PAI_ID","NOME","HIERARQUIA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID","SELECIONAVEL","ISENTO_IRRF","TRIBUTACAO_ESPECIAL"]},{"schema":"ATT_PROCESSO","name":"MATERIA_ASSUNTO_CNJ","fullName":"ATT_PROCESSO.MATERIA_ASSUNTO_CNJ","columns":["MATERIA_ID","ASSUNTO_CNJ_ID"]},{"schema":"ATT_PROCESSO","name":"PROCESSO_TEM_DIVIDA","fullName":"ATT_PROCESSO.PROCESSO_TEM_DIVIDA","columns":["PROCESSO_ID","DIVIDA_ID"]},{"schema":"ATT_PROCESSO","name":"TIPO_SITUACAO_PASTA","fullName":"ATT_PROCESSO.TIPO_SITUACAO_PASTA","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PROCESSO","name":"COMPETENCIA_JUDICIAL","fullName":"ATT_PROCESSO.COMPETENCIA_JUDICIAL","columns":["ID","UNIDADE_JUDICIAL_ID","MUNICIPIO_ID","MATERIA_ID","ABRANGENCIA_INSTITUICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"COMPLEMENTO_ANDAMENTO","fullName":"ATT_PROCESSO.COMPLEMENTO_ANDAMENTO","columns":["ID","ANDAMENTO_ID","TIPO_COMPLEMENTO_ID","VALOR_TEXTO","VALOR_NUMERO","VALOR_DATA","VALOR_BOOLEANO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_PROCESSO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_PROCESSO","name":"MIGRACAO_PARTICIPACAO","fullName":"ATT_PROCESSO.MIGRACAO_PARTICIPACAO","columns":["ID_ORIGEM","SEQUENCIAL","TIPO_PARTICIPACAO_ID","PESSOA_ID","PRINCIPAL","TIPO_PARTE","ID_ATTORNATUS"]},{"schema":"ATT_PROCESSO","name":"PASTA_TEM_QUALIFICACAO","fullName":"ATT_PROCESSO.PASTA_TEM_QUALIFICACAO","columns":["PASTA_ID","QUALIFICACAO_ID"]},{"schema":"ATT_PROCESSO","name":"DOMINIO_TIPO_COMPLEMENTO","fullName":"ATT_PROCESSO.DOMINIO_TIPO_COMPLEMENTO","columns":["ID","TIPO_COMPLEMENTO_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_PROCESSO","name":"PROCESSO_TEM_ASSUNTO_CNJ","fullName":"ATT_PROCESSO.PROCESSO_TEM_ASSUNTO_CNJ","columns":["PROCESSO_ID","ASSUNTO_CNJ_ID"]},{"schema":"ATT_PROCESSO","name":"VALOR_EVOLUCAO_HISTORICO","fullName":"ATT_PROCESSO.VALOR_EVOLUCAO_HISTORICO","columns":["ID","VALOR_EVOLUCAO_ID","MONTANTE_ANTERIOR","DATA_ATUALIZACAO_ANTERIOR","OBSERVACAO_ANTERIOR","VERSION","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","USUARIO"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_CNJ_ATENDE_CLASSE","fullName":"ATT_PROCESSO.ASSUNTO_CNJ_ATENDE_CLASSE","columns":["ASSUNTO_CNJ_ID","CLASSE_ID"]},{"schema":"ATT_PROCESSO","name":"CLASSE_TEM_COMPETENCIA_CNJ","fullName":"ATT_PROCESSO.CLASSE_TEM_COMPETENCIA_CNJ","columns":["CLASSE_ID","COMPETENCIA_CNJ_ID"]},{"schema":"ATT_PROCESSO","name":"VALOR_TIPO_TEM_INSTITUICAO","fullName":"ATT_PROCESSO.VALOR_TIPO_TEM_INSTITUICAO","columns":["VALOR_TIPO_ID","INSTITUICAO_ID"]},{"schema":"ATT_PROCESSO","name":"LITISPENDENCIA_TEM_CRITERIO","fullName":"ATT_PROCESSO.LITISPENDENCIA_TEM_CRITERIO","columns":["LITISPENDENCIA_ID","CAMPO"]},{"schema":"ATT_PROCESSO","name":"MATERIA_ASSUNTO_INSTITUICAO","fullName":"ATT_PROCESSO.MATERIA_ASSUNTO_INSTITUICAO","columns":["MATERIA_ID","ASSUNTO_INSTITUICAO_ID"]},{"schema":"ATT_PROCESSO","name":"CLASSE_TEM_TIPO_PARTICIPACAO","fullName":"ATT_PROCESSO.CLASSE_TEM_TIPO_PARTICIPACAO","columns":["CLASSE_ID","TIPO_PARTICIPACAO_ID"]},{"schema":"ATT_PROCESSO","name":"TIPO_ANDAMENTO_TEM_APLICACAO","fullName":"ATT_PROCESSO.TIPO_ANDAMENTO_TEM_APLICACAO","columns":["TIPO_ANDAMENTO_ID","TIPO_PROCESSO"]},{"schema":"ATT_PROCESSO","name":"PASTA_TEM_ASSUNTO_INSTITUICAO","fullName":"ATT_PROCESSO.PASTA_TEM_ASSUNTO_INSTITUICAO","columns":["PASTA_ID","ASSUNTO_ID"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_CNJ_TEM_COMPETENCIA_CNJ","fullName":"ATT_PROCESSO.ASSUNTO_CNJ_TEM_COMPETENCIA_CNJ","columns":["ASSUNTO_CNJ_ID","COMPETENCIA_CNJ_ID"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_INSTITUICAO_ASSUNTO_CNJ","fullName":"ATT_PROCESSO.ASSUNTO_INSTITUICAO_ASSUNTO_CNJ","columns":["ASSUNTO_INSTITUICAO_ID","ASSUNTO_CNJ_ID"]},{"schema":"ATT_PROCESSO","name":"VALOR_COMPLEMENTO_LISTA_MULTIPLA","fullName":"ATT_PROCESSO.VALOR_COMPLEMENTO_LISTA_MULTIPLA","columns":["COMPLEMENTO_ANDAMENTO_ID","VALOR"]},{"schema":"ATT_PROCESSO","name":"ASSUNTO_CNJ_ATENDE_UNIDADE_JUDICIAL","fullName":"ATT_PROCESSO.ASSUNTO_CNJ_ATENDE_UNIDADE_JUDICIAL","columns":["ASSUNTO_CNJ_ID","UNIDADE_JUDICIAL_ID"]},{"schema":"ATT_PROCESSO","name":"TIPO_ANDAMENTO_TEM_APLICACAO_ORIGEM","fullName":"ATT_PROCESSO.TIPO_ANDAMENTO_TEM_APLICACAO_ORIGEM","columns":["TIPO_ANDAMENTO_ID","ORIGEM"]},{"schema":"ATT_PROCESSO","name":"UNIDADE_JUDICIAL_TEM_COMPETENCIA_CNJ","fullName":"ATT_PROCESSO.UNIDADE_JUDICIAL_TEM_COMPETENCIA_CNJ","columns":["UNIDADE_JUDICIAL_ID","COMPETENCIA_CNJ_ID"]},{"schema":"ATT_SECURITY","name":"CARGO","fullName":"ATT_SECURITY.CARGO","columns":["ID","NOME","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"LOCAL","fullName":"ATT_SECURITY.LOCAL","columns":["ID","INSTITUICAO_ID","TIPO_LOCAL_ID","NOME","ENDERECO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","PESSOA_ID_EXEQUENTE_FISCAL","EMAIL"]},{"schema":"ATT_SECURITY","name":"PAPEL","fullName":"ATT_SECURITY.PAPEL","columns":["ID","TIPO","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID","ROLE"]},{"schema":"ATT_SECURITY","name":"LEIAUTE","fullName":"ATT_SECURITY.LEIAUTE","columns":["ID","INSTITUICAO_ID","NOME","DESCRICAO","COMPONENTE","ORDENACAO","TIPO_DEMANDA","USUARIO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","AGRUPAMENTOS"]},{"schema":"ATT_SECURITY","name":"LOTACAO","fullName":"ATT_SECURITY.LOTACAO","columns":["ID","LOCAL_ID","LOCAL_LOTADO_ID","USUARIO_LOTADO","PAPEL_ID","DATA_INICIAL","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_EFETIVACAO","INSTITUICAO_ID"]},{"schema":"ATT_SECURITY","name":"USUARIO","fullName":"ATT_SECURITY.USUARIO","columns":["USERNAME","INSTITUICAO_ID","PASSWORD","ACCOUNT_NON_EXPIRED","ACCOUNT_NON_LOCKED","CREDENTIALS_NON_EXPIRED","ENABLED","NOME","PESSOA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO","IMAGEM_ASSINATURA","WOPI_USER_INFO","CARGO_ID","SUB","PASSWORD_LOGIN_ENABLED","EMAIL_LOGIN"]},{"schema":"ATT_SECURITY","name":"ATRIBUTO","fullName":"ATT_SECURITY.ATRIBUTO","columns":["ID","NOME","EXEMPLO","TIPO","MASCARA","ORDENACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"SEQUENCE","fullName":"ATT_SECURITY.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_SECURITY","name":"DASHBOARD","fullName":"ATT_SECURITY.DASHBOARD","columns":["ID","INSTITUICAO_ID","USUARIO","ORDEM","NOME","URL","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","LOCAL_ID","PAPEL_ID","REPORT_ID","WORKSPACE_ID","RLS_HABILITADO"]},{"schema":"ATT_SECURITY","name":"TIPO_LOCAL","fullName":"ATT_SECURITY.TIPO_LOCAL","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_SECURITY","name":"GRUPO_LOCAL","fullName":"ATT_SECURITY.GRUPO_LOCAL","columns":["ID","NOME","DESCRICAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_SECURITY","name":"INSTITUICAO","fullName":"ATT_SECURITY.INSTITUICAO","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DEPARTAMENTO"]},{"schema":"ATT_SECURITY","name":"LINHA_LEIAUTE","fullName":"ATT_SECURITY.LINHA_LEIAUTE","columns":["ID","LEIAUTE_ID","POSICAO","STYLE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"ELEMENTO_LINHA","fullName":"ATT_SECURITY.ELEMENTO_LINHA","columns":["ID","LINHA_LEIAUTE_ID","ATRIBUTO_COMPONENTE_ID","POSICAO","STYLE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"FUNCIONALIDADE","fullName":"ATT_SECURITY.FUNCIONALIDADE","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ROLE","DISPONIVEL_MOBILE","VISIVEL_MENU"]},{"schema":"ATT_SECURITY","name":"V_TITULARIDADE","fullName":"ATT_SECURITY.V_TITULARIDADE","columns":["SUPERIOR_ID","SUPERIOR_NOME","TIPO_LOCAL_ID","TIPO_LOCAL_NOME","ID","NOME","DATA_INICIAL","DATA_FINAL","PAPEL_ID","PAPEL_NOME","TIPO","USUARIO_LOTADO"]},{"schema":"ATT_SECURITY","name":"IMAGEM_ASSINATURA","fullName":"ATT_SECURITY.IMAGEM_ASSINATURA","columns":["USERNAME","IMAGEM","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"ATRIBUTO_COMPONENTE","fullName":"ATT_SECURITY.ATRIBUTO_COMPONENTE","columns":["ID","ATRIBUTO_ID","COMPONENTE","TIPO_DEMANDA","JSON_PATH","USUARIO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","AGRUPAMENTO_ID","ORDENACAO"]},{"schema":"ATT_SECURITY","name":"FUNCIONALIDADE_MENU","fullName":"ATT_SECURITY.FUNCIONALIDADE_MENU","columns":["ID","USERNAME","FUNCIONALIDADE_ID","POSICAO_MENU","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_SECURITY","name":"LOTACAO_TEM_MATERIA","fullName":"ATT_SECURITY.LOTACAO_TEM_MATERIA","columns":["LOTACAO_ID","MATERIA_ID"]},{"schema":"ATT_SECURITY","name":"AUTENTICACAO_EXTERNA","fullName":"ATT_SECURITY.AUTENTICACAO_EXTERNA","columns":["ID","INSTITUICAO_ID","TIPO","CLIENT_ID","CLIENT_SECRET","SCOPE","RESPONSE_TYPE","RESPONSE_MODE","GRANT_TYPE","ISSUER","REDIRECT_URI","USER_INFO_ENDPOINT","TOKEN_ENDPOINT","AUTHORIZATION_ENDPOINT","LOGOUT_URI","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_SECURITY","name":"OAUTH_CLIENT_DETAILS","fullName":"ATT_SECURITY.OAUTH_CLIENT_DETAILS","columns":["CLIENT_ID","RESOURCE_IDS","CLIENT_SECRET","SCOPE","AUTHORIZED_GRANT_TYPES","WEB_SERVER_REDIRECT_URI","AUTHORITIES","ACCESS_TOKEN_VALIDITY","REFRESH_TOKEN_VALIDITY","ADDITIONAL_INFORMATION","AUTOAPPROVE"]},{"schema":"ATT_SECURITY","name":"PAPEL_TEM_PRIVILEGIO","fullName":"ATT_SECURITY.PAPEL_TEM_PRIVILEGIO","columns":["PAPEL_ID","PRIVILEGIO"]},{"schema":"ATT_SECURITY","name":"PAPEL_TEM_TIPO_LOCAL","fullName":"ATT_SECURITY.PAPEL_TEM_TIPO_LOCAL","columns":["PAPEL_ID","TIPO_LOCAL_ID"]},{"schema":"ATT_SECURITY","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_SECURITY.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_SECURITY","name":"GRUPO_LOCAL_TEM_LOCAL","fullName":"ATT_SECURITY.GRUPO_LOCAL_TEM_LOCAL","columns":["GRUPO_LOCAL_ID","LOCAL_ID"]},{"schema":"ATT_SECURITY","name":"HISTORICO_AFASTAMENTO","fullName":"ATT_SECURITY.HISTORICO_AFASTAMENTO","columns":["ID","LOTACAO_ORIGEM_ID","LOTACAO_AFASTAMENTO_ID","DATA_VIGENCIA_INICIAL","DATA_VIGENCIA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_SECURITY","name":"PAPEL_TEM_FUNCIONALIDADE","fullName":"ATT_SECURITY.PAPEL_TEM_FUNCIONALIDADE","columns":["PAPEL_ID","FUNCIONALIDADE_ID"]},{"schema":"ATT_SECURITY","name":"FUNCIONALIDADE_PRIVILEGIO","fullName":"ATT_SECURITY.FUNCIONALIDADE_PRIVILEGIO","columns":["PRIVILEGIO","FUNCIONALIDADE_ID"]},{"schema":"ATT_SECURITY","name":"USUARIO_TEM_LEIAUTE_ATIVO","fullName":"ATT_SECURITY.USUARIO_TEM_LEIAUTE_ATIVO","columns":["USUARIO_ID","LEIAUTE_ID"]},{"schema":"ATT_SECURITY","name":"ATRIBUTO_TEM_ATRIBUTO_COMPONENTE","fullName":"ATT_SECURITY.ATRIBUTO_TEM_ATRIBUTO_COMPONENTE","columns":["ATRIBUTO_ID","ATRIBUTO_COMPONENTE_ID"]},{"schema":"ATT_AGENDADOR","name":"SEQUENCE","fullName":"ATT_AGENDADOR.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_LOCKS","fullName":"ATT_AGENDADOR.QRTZ_LOCKS","columns":["SCHED_NAME","LOCK_NAME"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","JOB_NAME","JOB_GROUP","DESCRIPTION","NEXT_FIRE_TIME","PREV_FIRE_TIME","PRIORITY","TRIGGER_STATE","TRIGGER_TYPE","START_TIME","END_TIME","CALENDAR_NAME","MISFIRE_INSTR","JOB_DATA"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_CALENDARS","fullName":"ATT_AGENDADOR.QRTZ_CALENDARS","columns":["SCHED_NAME","CALENDAR_NAME","CALENDAR"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_JOB_DETAILS","fullName":"ATT_AGENDADOR.QRTZ_JOB_DETAILS","columns":["SCHED_NAME","JOB_NAME","JOB_GROUP","DESCRIPTION","JOB_CLASS_NAME","IS_DURABLE","IS_NONCONCURRENT","IS_UPDATE_DATA","REQUESTS_RECOVERY","JOB_DATA"]},{"schema":"ATT_AGENDADOR","name":"BATCH_JOB_INSTANCE","fullName":"ATT_AGENDADOR.BATCH_JOB_INSTANCE","columns":["JOB_INSTANCE_ID","VERSION","JOB_NAME","JOB_KEY"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_BLOB_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_BLOB_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","BLOB_DATA"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_CRON_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_CRON_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","CRON_EXPRESSION","TIME_ZONE_ID"]},{"schema":"ATT_AGENDADOR","name":"BATCH_JOB_EXECUTION","fullName":"ATT_AGENDADOR.BATCH_JOB_EXECUTION","columns":["JOB_EXECUTION_ID","VERSION","JOB_INSTANCE_ID","CREATE_TIME","START_TIME","END_TIME","STATUS","EXIT_CODE","EXIT_MESSAGE","LAST_UPDATED","JOB_CONFIGURATION_LOCATION"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_FIRED_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_FIRED_TRIGGERS","columns":["SCHED_NAME","ENTRY_ID","TRIGGER_NAME","TRIGGER_GROUP","INSTANCE_NAME","FIRED_TIME","SCHED_TIME","PRIORITY","STATE","JOB_NAME","JOB_GROUP","IS_NONCONCURRENT","REQUESTS_RECOVERY"]},{"schema":"ATT_AGENDADOR","name":"BATCH_STEP_EXECUTION","fullName":"ATT_AGENDADOR.BATCH_STEP_EXECUTION","columns":["STEP_EXECUTION_ID","VERSION","STEP_NAME","JOB_EXECUTION_ID","START_TIME","END_TIME","STATUS","COMMIT_COUNT","READ_COUNT","FILTER_COUNT","WRITE_COUNT","READ_SKIP_COUNT","WRITE_SKIP_COUNT","PROCESS_SKIP_COUNT","ROLLBACK_COUNT","EXIT_CODE","EXIT_MESSAGE","LAST_UPDATED"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_SCHEDULER_STATE","fullName":"ATT_AGENDADOR.QRTZ_SCHEDULER_STATE","columns":["SCHED_NAME","INSTANCE_NAME","LAST_CHECKIN_TIME","CHECKIN_INTERVAL"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_SIMPLE_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_SIMPLE_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","REPEAT_COUNT","REPEAT_INTERVAL","TIMES_TRIGGERED"]},{"schema":"ATT_AGENDADOR","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_AGENDADOR.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_SIMPROP_TRIGGERS","fullName":"ATT_AGENDADOR.QRTZ_SIMPROP_TRIGGERS","columns":["SCHED_NAME","TRIGGER_NAME","TRIGGER_GROUP","STR_PROP_1","STR_PROP_2","STR_PROP_3","INT_PROP_1","INT_PROP_2","LONG_PROP_1","LONG_PROP_2","DEC_PROP_1","DEC_PROP_2","BOOL_PROP_1","BOOL_PROP_2"]},{"schema":"ATT_AGENDADOR","name":"QRTZ_PAUSED_TRIGGER_GRPS","fullName":"ATT_AGENDADOR.QRTZ_PAUSED_TRIGGER_GRPS","columns":["SCHED_NAME","TRIGGER_GROUP"]},{"schema":"ATT_AGENDADOR","name":"BATCH_JOB_EXECUTION_PARAMS","fullName":"ATT_AGENDADOR.BATCH_JOB_EXECUTION_PARAMS","columns":["JOB_EXECUTION_ID","TYPE_CD","KEY_NAME","STRING_VAL","DATE_VAL","LONG_VAL","DOUBLE_VAL","IDENTIFYING"]},{"schema":"ATT_AGENDADOR","name":"BATCH_JOB_EXECUTION_CONTEXT","fullName":"ATT_AGENDADOR.BATCH_JOB_EXECUTION_CONTEXT","columns":["JOB_EXECUTION_ID","SHORT_CONTEXT","SERIALIZED_CONTEXT"]},{"schema":"ATT_AGENDADOR","name":"BATCH_STEP_EXECUTION_CONTEXT","fullName":"ATT_AGENDADOR.BATCH_STEP_EXECUTION_CONTEXT","columns":["STEP_EXECUTION_ID","SHORT_CONTEXT","SERIALIZED_CONTEXT"]},{"schema":"ATT_AUDITORIA","name":"ATRIBUTO","fullName":"ATT_AUDITORIA.ATRIBUTO","columns":["ID","ENTIDADE_ID","DESCRICAO","IDENTIFICADOR","IGNORAR","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_AUDITORIA","name":"ENTIDADE","fullName":"ATT_AUDITORIA.ENTIDADE","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_AUDITORIA","name":"SEQUENCE","fullName":"ATT_AUDITORIA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_AUDITORIA","name":"AUDITORIA","fullName":"ATT_AUDITORIA.AUDITORIA","columns":["ID","INSTITUICAO_ID","DATA_TRANSACAO","USUARIO","ACAO","ORIGEM"]},{"schema":"ATT_AUDITORIA","name":"REGISTRO_LOGIN","fullName":"ATT_AUDITORIA.REGISTRO_LOGIN","columns":["ID","USERNAME","IP","DATA"]},{"schema":"ATT_AUDITORIA","name":"AUDITORIA_ATRIBUTO","fullName":"ATT_AUDITORIA.AUDITORIA_ATRIBUTO","columns":["ID","AUDITORIA_ENTIDADE_ID","ATRIBUTO_ID","VALOR_ANTIGO","VALOR_NOVO"]},{"schema":"ATT_AUDITORIA","name":"AUDITORIA_ENTIDADE","fullName":"ATT_AUDITORIA.AUDITORIA_ENTIDADE","columns":["ID","AUDITORIA_ID","OPERACAO","ENTIDADE_ID","INSTITUICAO_ID"]},{"schema":"ATT_AUDITORIA","name":"MIGRACAO_AUDITORIA","fullName":"ATT_AUDITORIA.MIGRACAO_AUDITORIA","columns":["ID","LINHA","DESCRICAO"]},{"schema":"ATT_AUDITORIA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_AUDITORIA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_AUDITORIA","name":"REGISTRO_LOGIN_PORTAL","fullName":"ATT_AUDITORIA.REGISTRO_LOGIN_PORTAL","columns":["ID","USERNAME","TENANT_ID","IP","DATA","REPRESENTACOES","ROLES","USERNAME_EXECUTOR","TIPO_USUARIO"]},{"schema":"ATT_AUDITORIA","name":"AUDITORIA_IDENTIFICACAO","fullName":"ATT_AUDITORIA.AUDITORIA_IDENTIFICACAO","columns":["ID","AUDITORIA_ENTIDADE_ID","ATRIBUTO_ID","VALOR"]},{"schema":"ATT_DOCUMENTO","name":"ANEXO","fullName":"ATT_DOCUMENTO.ANEXO","columns":["DOCUMENTO_PAI_ID","DOCUMENTO_ANEXO_ID"]},{"schema":"ATT_DOCUMENTO","name":"BRASAO","fullName":"ATT_DOCUMENTO.BRASAO","columns":["ID","INSTITUICAO_ID","BRASAO_BASE64","NOME_ARQUIVO","DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"ARQUIVO","fullName":"ATT_DOCUMENTO.ARQUIVO","columns":["ID","INSTITUICAO_ID","DOCUMENTO_ID","NOME","PATH","TOTAL_SPACE","HASH_PARA_INCORPORAR","HASH_PARA_ASSINAR","PAGINA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","MD5","QUANTIDADE_PAGINAS","FATOR_COMPRESSAO","SHA256","SIGNATURE_NAME","PATH_PDF_PARA_ASSINAR","PATH_ASSINATURA_CADES"]},{"schema":"ATT_DOCUMENTO","name":"PARECER","fullName":"ATT_DOCUMENTO.PARECER","columns":["DOCUMENTO_ID","NUMERO","ORGAO_ORIGEM_ID","PARECERISTA","INTERESSADO","DATA_PUBLICACAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","NUMERO_PROCESSO","ANO","BUSINESS_KEY_ORIGEM"]},{"schema":"ATT_DOCUMENTO","name":"ANOTACAO","fullName":"ATT_DOCUMENTO.ANOTACAO","columns":["ID","DESCRICAO","DOCUMENTO_ID","LOCAL_ID","VISIBILIDADE","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"SEQUENCE","fullName":"ATT_DOCUMENTO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_DOCUMENTO","name":"DOCUMENTO","fullName":"ATT_DOCUMENTO.DOCUMENTO","columns":["ID","INSTITUICAO_ID","PROCESSO_ID","DIVIDA_ID","DOCUMENTO_ORIGEM_ID","NOME","TIPO_DOCUMENTO_ID","EXTENSAO","TOTAL_SPACE","LOCK_ID","FILE_STORAGE_SERVICE","PROTOCOLO","DATA_PROTOCOLO","ANDAMENTO_PUBLICACAO_ID","OBSOLETO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ESPECIE","HASH_AUTENTICIDADE","EMENTA","TIPO_DONO","BUSINESS_KEY_ORIGEM","PESSOA_ID","VERIFICACAO_INCONSISTENCIA","DEMANDA_ID","PASTA_ID","MOTIVO_NAO_PROTOCOLO","LOCAL_DISTRIBUICAO_ID","LOCAL_ID","ELABORADO_AUTOMATICAMENTE","DATA_LOCK","IDENTIFICADOR_NA_ORIGEM","NUMERO","ROTULO","MODELO_TIPO_ANDAMENTO_ID","VERSION_DOC_ORIGEM","DATA_CONCLUSAO","POSSUI_CAMPOS_PENDENTE_MESCLAGEM","EM_EDICAO","VERSION_CONCLUSAO","PATH_ORIGINAL","TIPO_ASSINATURA_DOCUMENTO"]},{"schema":"ATT_DOCUMENTO","name":"ASSINATURA","fullName":"ATT_DOCUMENTO.ASSINATURA","columns":["ID","DOCUMENTO_ID","USUARIO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_ASSINATURA","TIPO_ASSINATURA_DOCUMENTO"]},{"schema":"ATT_DOCUMENTO","name":"CREDENCIAL","fullName":"ATT_DOCUMENTO.CREDENCIAL","columns":["ID","INSTITUICAO_ID","CERTIFICADO","SENHA_CERTIFICADO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"ANEXO_MODELO","fullName":"ATT_DOCUMENTO.ANEXO_MODELO","columns":["ID","MODELO_ID","ANEXO_ID","EXERCICIO_DIVIDA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO_ANEXO","TIPO_DOCUMENTO_ID"]},{"schema":"ATT_DOCUMENTO","name":"CAMPO_MODELO","fullName":"ATT_DOCUMENTO.CAMPO_MODELO","columns":["ID","NOME","DESCRICAO"]},{"schema":"ATT_DOCUMENTO","name":"ANEXO_USUARIO","fullName":"ATT_DOCUMENTO.ANEXO_USUARIO","columns":["ID","DOCUMENTO_ID","USUARIO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"MODELO_CLASSE","fullName":"ATT_DOCUMENTO.MODELO_CLASSE","columns":["MODELO_ID","CLASSE_ID"]},{"schema":"ATT_DOCUMENTO","name":"USO_NUMERACAO","fullName":"ATT_DOCUMENTO.USO_NUMERACAO","columns":["ID","INSTITUICAO_ID","TIPO_DOCUMENTO_ID","LOCAL_ID","MASCARA","IDENTIFICADOR_SEQUENCIAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"TIPO_DOCUMENTO","fullName":"ATT_DOCUMENTO.TIPO_DOCUMENTO","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","MANIFESTACAO_JUDICIAL","CLASSE_ID","TIPO_PESQUISA_TEXTUAL","CLASSE_APLICACAO","AGRUPAMENTO_ID","INSTITUICAO_ID"]},{"schema":"ATT_DOCUMENTO","name":"DOCUMENTO_LOCAL","fullName":"ATT_DOCUMENTO.DOCUMENTO_LOCAL","columns":["DOCUMENTO_ID","LOCAL_ID"]},{"schema":"ATT_DOCUMENTO","name":"MODELO_ETIQUETA","fullName":"ATT_DOCUMENTO.MODELO_ETIQUETA","columns":["DOCUMENTO_ID","ETIQUETA"]},{"schema":"ATT_DOCUMENTO","name":"USO_COMPLEMENTO","fullName":"ATT_DOCUMENTO.USO_COMPLEMENTO","columns":["ID","TIPO_DOCUMENTO_ID","TIPO_COMPLEMENTO","EVENTO","OBRIGATORIO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO_LOCAL_ID","PARAMETRO_TIPO_LOCAL","INSTITUICAO_ID","TIPO_ANDAMENTO_ID","PRIVILEGIO"]},{"schema":"ATT_DOCUMENTO","name":"DOCUMENTO_ASSUNTO","fullName":"ATT_DOCUMENTO.DOCUMENTO_ASSUNTO","columns":["DOCUMENTO_ID","ASSUNTO_ID"]},{"schema":"ATT_DOCUMENTO","name":"DOCUMENTO_MATERIA","fullName":"ATT_DOCUMENTO.DOCUMENTO_MATERIA","columns":["MODELO_ID","MATERIA_ID"]},{"schema":"ATT_DOCUMENTO","name":"ASSINATURA_EXTERNA","fullName":"ATT_DOCUMENTO.ASSINATURA_EXTERNA","columns":["ID","CLIENT_ID","CLIENT_SECRET","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","INSTITUICAO_ID","TIPO_ASSINATURA_DOCUMENTO","VERSION","ENDPOINT_URL_CODE","ENDPOINT_URL_CERTIFICADO","ENDPOINT_URL_TOKEN","ENDPOINT_URL_ASSINATURA"]},{"schema":"ATT_DOCUMENTO","name":"HASH_ARQUIVO_AGENT","fullName":"ATT_DOCUMENTO.HASH_ARQUIVO_AGENT","columns":["HASH","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"HASH_AUTENTICIDADE","fullName":"ATT_DOCUMENTO.HASH_AUTENTICIDADE","columns":["ID","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_DOCUMENTO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_DOCUMENTO","name":"DOCUMENTO_COMPARTILHADO","fullName":"ATT_DOCUMENTO.DOCUMENTO_COMPARTILHADO","columns":["ID","DOCUMENTO_ID","USUARIO","SOMENTE_LEITURA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"MODELO_CATEGORIA_DIVIDA","fullName":"ATT_DOCUMENTO.MODELO_CATEGORIA_DIVIDA","columns":["CATEGORIA_DIVIDA_ID","MODELO_ID"]},{"schema":"ATT_DOCUMENTO","name":"MODELO_DOMINIO_ETIQUETA","fullName":"ATT_DOCUMENTO.MODELO_DOMINIO_ETIQUETA","columns":["DOCUMENTO_ID","DOMINIO_ETIQUETA"]},{"schema":"ATT_DOCUMENTO","name":"AGRUPADOR_TIPO_DOCUMENTO","fullName":"ATT_DOCUMENTO.AGRUPADOR_TIPO_DOCUMENTO","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_DOCUMENTO","name":"PARECER_TEM_PALAVRA_CHAVE","fullName":"ATT_DOCUMENTO.PARECER_TEM_PALAVRA_CHAVE","columns":["DOCUMENTO_ID","PALAVRA_CHAVE"]},{"schema":"ATT_DOCUMENTO","name":"TIPO_DOCUMENTO_TIPO_OBJETO","fullName":"ATT_DOCUMENTO.TIPO_DOCUMENTO_TIPO_OBJETO","columns":["TIPO_DOCUMENTO_ID","TIPO_OBJETO"]},{"schema":"ATT_DOCUMENTO","name":"TIPO_DOCUMENTO_TEM_INSTANCIA","fullName":"ATT_DOCUMENTO.TIPO_DOCUMENTO_TEM_INSTANCIA","columns":["TIPO_DOCUMENTO_ID","INSTANCIA"]},{"schema":"ATT_DOCUMENTO","name":"TIPO_DOCUMENTO_TIPO_ANDAMENTO","fullName":"ATT_DOCUMENTO.TIPO_DOCUMENTO_TIPO_ANDAMENTO","columns":["TIPO_DOCUMENTO_ID","TIPO_ANDAMENTO_ID"]},{"schema":"ATT_INTEGRACAO","name":"SERVICO","fullName":"ATT_INTEGRACAO.SERVICO","columns":["ID","INTEGRACAO_ID","NOME","URL","IDENTIFICADOR_SERVICO","ARQUIVO_DE_TRANSFORMACAO_ENVIO","ARQUIVO_DE_TRANSFORMACAO_RETORNO","ARQUIVO_DE_TRANSFORMACAO_RETORNO_ERRO","TIPO_REQUISICAO","HTTP_METHOD","PRODUCES_MEDIA_TYPE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"SEQUENCE","fullName":"ATT_INTEGRACAO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_INTEGRACAO","name":"CREDENCIAL","fullName":"ATT_INTEGRACAO.CREDENCIAL","columns":["ID","INTEGRACAO_ID","INSTITUICAO_ID","USUARIO","SENHA","CERTIFICADO","SENHA_CERTIFICADO","CLIENT_ID","CLIENT_SECRET","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CPF","GRANT_TYPE"]},{"schema":"ATT_INTEGRACAO","name":"INTEGRACAO","fullName":"ATT_INTEGRACAO.INTEGRACAO","columns":["ID","NOME","URL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_JUIZO","fullName":"ATT_INTEGRACAO.DE_PARA_JUIZO","columns":["ID","INTEGRACAO_ID","UNIDADE_JUDICIAL_ID","NOME_JUIZO","IDENTIFICADOR_INTEGRACAO","NOME_INTEGRACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_PESSOA","fullName":"ATT_INTEGRACAO.DE_PARA_PESSOA","columns":["ID","INTEGRACAO_ID","IDENTIFICADOR_INTEGRACAO","NOME_INTEGRACAO","PESSOA_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","NOME_ID"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_NATUREZA","fullName":"ATT_INTEGRACAO.DE_PARA_NATUREZA","columns":["ID","INTEGRACAO_ID","NATUREZA_ID","IDENTIFICADOR_INTEGRACAO","NOME_INTEGRACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_TRIBUNAL","fullName":"ATT_INTEGRACAO.DE_PARA_TRIBUNAL","columns":["ID","INTEGRACAO_ID","IDENTIFICADOR_INTEGRACAO","NOME_INTEGRACAO","TRIBUNAL_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"SERVICO_INSTITUICAO","fullName":"ATT_INTEGRACAO.SERVICO_INSTITUICAO","columns":["ID","SERVICO_ID","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_INTEGRACAO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_TIPO_ANDAMENTO","fullName":"ATT_INTEGRACAO.DE_PARA_TIPO_ANDAMENTO","columns":["ID","TIPO_ANDAMENTO_ID","IDENTIFICADOR_NA_INTEGRACAO","DESCRICAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","SERVICO_ID"]},{"schema":"ATT_INTEGRACAO","name":"PRAZO_TERMINO_CARENCIA","fullName":"ATT_INTEGRACAO.PRAZO_TERMINO_CARENCIA","columns":["ID","TRIBUNAL_ID","INSTANCIA","TIPO_COMUNICACAO","CLASSE_ID","INTEGRACAO_ID","PRAZO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","INSTITUICAO_ID"]},{"schema":"ATT_INTEGRACAO","name":"DE_PARA_UNIDADE_JUDICIAL","fullName":"ATT_INTEGRACAO.DE_PARA_UNIDADE_JUDICIAL","columns":["ID","INTEGRACAO_ID","UNIDADE_JUDICIAL_ID","IDENTIFICADOR_INTEGRACAO","NOME_INTEGRACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRACAO","name":"CREDENCIAL_TEM_PROPRIEDADE","fullName":"ATT_INTEGRACAO.CREDENCIAL_TEM_PROPRIEDADE","columns":["CREDENCIAL_ID","NOME","VALOR"]},{"schema":"ATT_INTEGRACAO","name":"INTEGRACAO_TEM_PROPRIEDADE","fullName":"ATT_INTEGRACAO.INTEGRACAO_TEM_PROPRIEDADE","columns":["INTEGRACAO_ID","NOME","VALOR"]},{"schema":"ATT_INTEGRACAO","name":"JURISDICAO_UNIDADE_JUDICIAL","fullName":"ATT_INTEGRACAO.JURISDICAO_UNIDADE_JUDICIAL","columns":["ID","TRIBUNAL_ID","INSTANCIA","JURISDICAO_ID","ORGAO_JULGADOR_ID","UNIDADE_JUDICIAL_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","INTEGRACAO_ID"]},{"schema":"ATT_INTEGRADOC","name":"ACORDO","fullName":"ATT_INTEGRADOC.ACORDO","columns":["ID","REQUISITORIO_ID","IDENTIFICADOR_NA_INTEGRACAO","DATA_PROTOCOLO","DATA_CANCELAMENTO","DATA_NOTIFICACAO_BPMN_ACORDO_RECEBIDO","DATA_NOTIFICACAO_BPMN_ACORDO_ASSINADO","PESSOA_CREDOR_ID","PESSOA_REPRESENTANTE_ID","GENERO_ACORDO_ID","TIPO_ACORDO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_CONSULTA_INTEGRACAO","RESULTADO","JUSTIFICATIVA","NUMERO_PROTOCOLO","DATA_NOTIFICACAO_BPMN_ACORDO_CANCELADO","PROCESSO_JUDICIAL_ID","DATA_ASSINATURA_TERMO_ACORDO","JUSTIFICATIVA_PROPOSTA","JUSTIFICATIVA_ACOMPANHAMENTO","DATA_DECISAO"]},{"schema":"ATT_INTEGRADOC","name":"SERVICO","fullName":"ATT_INTEGRADOC.SERVICO","columns":["ID","INTEGRACAO_ID","NOME","URL","NOME_BEAN","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","IDENTIFICADOR_SERVICO","ROTA_CAMEL","XSLT_ENVIO","XSLT_RETORNO","XSLT_RETORNO_ERRO","HTTP_METHOD","IDENTIFICADOR_SERVICO_CREDENCIAL","PRODUCES_MEDIA_TYPE"]},{"schema":"ATT_INTEGRADOC","name":"SEQUENCE","fullName":"ATT_INTEGRADOC.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_INTEGRADOC","name":"RELATORIO","fullName":"ATT_INTEGRADOC.RELATORIO","columns":["ID","DATA_INICIAL","DATA_FINAL","INCLUI_ACORDOS_JA_GERADOS","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRADOC","name":"ASSINATURA","fullName":"ATT_INTEGRADOC.ASSINATURA","columns":["ID","DOCUMENTO_INTEGRACAO_ID","DATA_ASSINATURA_ROBO","USUARIO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRADOC","name":"CREDENCIAL","fullName":"ATT_INTEGRADOC.CREDENCIAL","columns":["ID","INTEGRACAO_ID","INSTITUICAO_ID","USUARIO","SENHA","CERTIFICADO","SENHA_CERTIFICADO","TIPO_AUTENTICACAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","USUARIO_INSTITUICAO","SIGLA_SISTEMA","SIGLA_SERVICO_INTEGRACAO","CLIENT_ID","CLIENT_SECRET","IDENTIFICADOR_SERVICO_CREDENCIAL"]},{"schema":"ATT_INTEGRADOC","name":"INTEGRACAO","fullName":"ATT_INTEGRADOC.INTEGRACAO","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","URL","TIPO_CONEXAO","IDENTIFICADOR_PROCESSO_OUTROS_NUMEROS","VERSAO","IDENTIFICADOR_ORIGEM_ANDAMENTO"]},{"schema":"ATT_INTEGRADOC","name":"REQUISITORIO","fullName":"ATT_INTEGRADOC.REQUISITORIO","columns":["ID","IDENTIFICADOR_NA_INTEGRACAO","NUMERO_PROCESSO_REQUISITORIO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NUMERO_PROCESSO_ACAO_PRINCIPAL","NUMERO_PROCESSO_RECURSO","NUMERO_ORDEM","ANO_NUMERO_ORDEM","LOCAL_ENTIDADE_DEVEDORA_ID","TRIBUNAL","COMARCA","VARA"]},{"schema":"ATT_INTEGRADOC","name":"DE_PARA_LOCAL","fullName":"ATT_INTEGRADOC.DE_PARA_LOCAL","columns":["ID","INTEGRACAO_ID","LOCAL_ID","IDENTIFICADOR_NA_INTEGRACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NOME","LOCAL_REPRESENTADO_INSTITUICAO","ATIVO"]},{"schema":"ATT_INTEGRADOC","name":"DE_PARA_CLASSE","fullName":"ATT_INTEGRADOC.DE_PARA_CLASSE","columns":["ID","INTEGRACAO_ID","CLASSE_ID","TIPO_PROCESSO","IDENTIFICADOR_NA_INTEGRACAO","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRADOC","name":"CHAMADA_SERVICO","fullName":"ATT_INTEGRADOC.CHAMADA_SERVICO","columns":["INSTITUICAO_ID","SERVICO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","MENSAGEM_ENVIO","MENSAGEM_RETORNO","MENSAGEM_ERRO","ID"]},{"schema":"ATT_INTEGRADOC","name":"DE_PARA_ASSUNTO","fullName":"ATT_INTEGRADOC.DE_PARA_ASSUNTO","columns":["ID","INTEGRACAO_ID","ASSUNTO_ID","IDENTIFICADOR_NA_INTEGRACAO","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRADOC","name":"MENSAGEM_RETORNO","fullName":"ATT_INTEGRADOC.MENSAGEM_RETORNO","columns":["ID","INTEGRACAO_ID","MENSAGEM_RETORNO_INTEGRACAO","MENSAGEM_TRATADA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRADOC","name":"PROCESSO_RECEBIDO","fullName":"ATT_INTEGRADOC.PROCESSO_RECEBIDO","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","NUMERO","PROCESSO_ID","DATA_DEVOLUCAO","ANDAMENTO_INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_DISPONIBILIZACAO","DATA_SINCRONIZACAO","DATA_ULTIMO_ANDAMENTO_INICIOU_BPMN","DOCUMENTO_INTEGRACAO_ENCABECANTE_ID","IDENTIFICADOR_UNIDADE_INTEGRACAO","IDENTIFICADOR_TRAMITACAO"]},{"schema":"ATT_INTEGRADOC","name":"ANDAMENTO_RECEBIDO","fullName":"ATT_INTEGRADOC.ANDAMENTO_RECEBIDO","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","IDENTIFICADOR_NA_INTEGRACAO","TIPO_OPERACAO","DATA_ANDAMENTO","USUARIO_OPERACAO","IDENTIFICADOR_PROCESSO_NA_INTEGRACAO","DATA_SINCRONIZACAO","ANDAMENTO_INSTITUICAO_ID","IDENTIFICADOR_UNIDADE_INTEGRACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","PROCESSO_ID"]},{"schema":"ATT_INTEGRADOC","name":"DOCUMENTO_INTEGRACAO","fullName":"ATT_INTEGRADOC.DOCUMENTO_INTEGRACAO","columns":["ID","DOCUMENTO_INTEGRACAO_PAI_ID","INSTITUICAO_ID","INTEGRACAO_ID","SERVICO_ENVIO_ID","DOCUMENTO_INSTITUICAO_ID","TIPO_DOCUMENTO_INSTITUICAO_ID","IDENTIFICADOR_NA_INTEGRACAO","TIPO_DOCUMENTO_INTEGRACAO_ID","IDENTIFICADOR_PROCESSO_NA_INTEGRACAO","NUMERO_PROCESSO","PROCESSO_ID","MANTER_PROCESSO_ABERTO","DATA_ENVIO_PROCESSO","ANDAMENTO_INSTITUICAO_ID","ELABORADO_POR_LOCAL_INTEGRACAO","DATA_ELABORACAO_INTEGRACAO","RETORNO_ID","RETORNO_DESCRICAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_EXCLUSAO","DATA_CANCELAMENTO","EXTENSAO_DOCUMENTO_INSTITUICAO","INTEGRACAO_REQUERIMENTO_ID","INTEGRACAO_CLASSE_ID","VALOR_MULTA","POSSUI_MULTA","POSSUI_PENALIDADE_ADICIONAL","DATA_VENCIMENTO","NOVO_PROCESSO_POR_REQUERIMENTO","DATA_REGISTRO_OUTROS_NUMEROS","NOME_DOCUMENTO","IDENTIFICADOR_ORIGEM_JUDICIARIO","DE_PARA_LOCAL_ID_UNIDADE_ORIGEM_ENVIO","IDENTIFICADOR_UNIDADE_INTEGRACAO","FASE_INICIAL_REQUERIMENTO","MOTIVO_ERRO","NUMERO_DOCUMENTO_NA_INTEGRACAO","NOME_NA_ARVORE_NA_INTEGRACAO","TIPO_OPERACAO","MOTIVO_OPERACAO","USUARIO_OPERACAO","INTEGRACAO_TABELA_NOME","FORCAR_REENVIO","JUSTIFICATIVA_REENVIO_FORCADO"]},{"schema":"ATT_INTEGRADOC","name":"RELATORIO_TEM_ACORDO","fullName":"ATT_INTEGRADOC.RELATORIO_TEM_ACORDO","columns":["RELATORIO_ID","ACORDO_ID"]},{"schema":"ATT_INTEGRADOC","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_INTEGRADOC.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_INTEGRADOC","name":"DE_PARA_TIPO_DOCUMENTO","fullName":"ATT_INTEGRADOC.DE_PARA_TIPO_DOCUMENTO","columns":["ID","INTEGRACAO_ID","TIPO_DOCUMENTO_ID","IDENTIFICADOR_NA_INTEGRACAO","SERVICO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_ANDAMENTO_ID","NOME","ELABORADO_POR_LOCAL_INTEGRACAO","INTEGRACAO_CLASSE_ID","NOVO_PROCESSO_POR_REQUERIMENTO","ENVIO_DE_PARA_LOCAL_ID","EXTENSAO"]},{"schema":"ATT_INTEGRADOC","name":"ACORDO_TEM_BUSINESS_KEY","fullName":"ATT_INTEGRADOC.ACORDO_TEM_BUSINESS_KEY","columns":["ACORDO_ID","BUSINESS_KEY"]},{"schema":"ATT_INTEGRADOC","name":"DEMONSTRATIVO_PAGAMENTO","fullName":"ATT_INTEGRADOC.DEMONSTRATIVO_PAGAMENTO","columns":["ID","IDENTIFICADOR_NA_INTEGRACAO","DATA_PAGAMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_PROCESSAMENTO","TIPO_EVENTO","DATA_REGISTRO","DATA_INCLUSAO","EXCEDE_LIMITE_UNIDADE_FISCAL"]},{"schema":"ATT_INTEGRADOC","name":"ANDAMENTO_RECEBIDO_PARAMETROS","fullName":"ATT_INTEGRADOC.ANDAMENTO_RECEBIDO_PARAMETROS","columns":["ANDAMENTO_RECEBIDO_ID","CHAVE","VALOR"]},{"schema":"ATT_INTEGRADOC","name":"DR$IDX_DEPARALOCAL_NOME_CTX$I","fullName":"ATT_INTEGRADOC.DR$IDX_DEPARALOCAL_NOME_CTX$I","columns":["TOKEN_TEXT","TOKEN_TYPE","TOKEN_FIRST","TOKEN_LAST","TOKEN_COUNT","TOKEN_INFO"]},{"schema":"ATT_INTEGRADOC","name":"DR$IDX_DEPARALOCAL_NOME_CTX$K","fullName":"ATT_INTEGRADOC.DR$IDX_DEPARALOCAL_NOME_CTX$K","columns":["DOCID","TEXTKEY"]},{"schema":"ATT_INTEGRADOC","name":"DR$IDX_DEPARALOCAL_NOME_CTX$N","fullName":"ATT_INTEGRADOC.DR$IDX_DEPARALOCAL_NOME_CTX$N","columns":["NLT_DOCID","NLT_MARK"]},{"schema":"ATT_INTEGRADOC","name":"DR$IDX_DEPARALOCAL_NOME_CTX$U","fullName":"ATT_INTEGRADOC.DR$IDX_DEPARALOCAL_NOME_CTX$U","columns":["RID"]},{"schema":"ATT_INTEGRADOC","name":"DEMONSTRATIVO_TEM_BUSINESS_KEY","fullName":"ATT_INTEGRADOC.DEMONSTRATIVO_TEM_BUSINESS_KEY","columns":["DEMONSTRATIVO_ID","BUSINESS_KEY"]},{"schema":"ATT_INTEGRADOC","name":"DOCUMENTO_INTEGRACAO_TEM_PARTE","fullName":"ATT_INTEGRADOC.DOCUMENTO_INTEGRACAO_TEM_PARTE","columns":["ID","DOCUMENTO_INTEGRACAO_ID","PESSOA_ID","MENSAGEM_ERRO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","CNPJ_CPF"]},{"schema":"ATT_INTEGRADOC","name":"CHAMADA_SERVICO_TEM_PROPRIEDADE","fullName":"ATT_INTEGRADOC.CHAMADA_SERVICO_TEM_PROPRIEDADE","columns":["CHAMADA_SERVICO_ID","CHAVE","VALOR"]},{"schema":"ATT_INTEGRADOC","name":"DOCUMENTO_INTEGRACAO_LOCAL_ENVIO","fullName":"ATT_INTEGRADOC.DOCUMENTO_INTEGRACAO_LOCAL_ENVIO","columns":["DOCUMENTO_INTEGRACAO_ID","DE_PARA_LOCAL_ID"]},{"schema":"ATT_INTEGRAJUD","name":"SERVICO","fullName":"ATT_INTEGRAJUD.SERVICO","columns":["ID","INTEGRACAO_ID","TIPO_SERVICO","VERSAO","TIPO_AUTENTICACAO","XSLT_ASSINATURA","XSLT_ENVIO","XSLT_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","URL","PEDIDO_LIMINAR","SIGILO_PETICAO","TIPO_ASSINATURA_DOCUMENTO"]},{"schema":"ATT_INTEGRAJUD","name":"SEQUENCE","fullName":"ATT_INTEGRAJUD.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_INTEGRAJUD","name":"PROTOCOLO","fullName":"ATT_INTEGRAJUD.PROTOCOLO","columns":["DOCUMENTO_ID","MENSAGEM_ID","SERVICO_ID","DATA_PROTOCOLO","PROTOCOLO","CODIGO_RETORNO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_ENVIO","STATUS","PROCESSO_ID","NUMERO_PROCESSO","UNIDADE_JUDICIAL_ID","JUIZO","DEMANDA_ID","DOCUMENTO_PROTOCOLADO_ID","PROCESS_INSTANCE_ID"]},{"schema":"ATT_INTEGRAJUD","name":"CREDENCIAL","fullName":"ATT_INTEGRAJUD.CREDENCIAL","columns":["ID","INSTITUICAO_ID","USUARIO","SENHA","CERTIFICADO","SENHA_CERTIFICADO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO"]},{"schema":"ATT_INTEGRAJUD","name":"INTEGRACAO","fullName":"ATT_INTEGRAJUD.INTEGRACAO","columns":["ID","NOME","TRIBUNAL_ID","URL","TIPO_INTEGRACAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CHARSET_NAME","TIPO_CONEXAO_SSL","USA_PROXY","COOKIE_DESABILITADO","USA_IDENTIFICADOR_AVISO_PETICIONAMENTO","TAMANHO_MAXIMO_MENSAGEM_ENVIO","SIGLA_IDENTIFICADOR_PASTA_DIGITAL"]},{"schema":"ATT_INTEGRAJUD","name":"USO_SIGILO","fullName":"ATT_INTEGRAJUD.USO_SIGILO","columns":["ID","TIPO_SIGILO","INTEGRACAO_ID","TIPO_SERVICO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"PROCESSO_PAI","fullName":"ATT_INTEGRAJUD.PROCESSO_PAI","columns":["ID","UNIDADE_JUDICIAL_ID","NUMERO_PROCESSO_FILHO","NUMERO_PROCESSO_PAI","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"TIPO_ANDAMENTO","fullName":"ATT_INTEGRAJUD.TIPO_ANDAMENTO","columns":["ID","INTEGRACAO_ID","NOME_TIPO_ANDAMENTO_JUDICIARIO","TIPO_ANDAMENTO_INSTITUICAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO_ANDAMENTO_JUDICIARIO"]},{"schema":"ATT_INTEGRAJUD","name":"ANDAMENTO_AUTOS","fullName":"ATT_INTEGRAJUD.ANDAMENTO_AUTOS","columns":["ID","INTEGRACAO_ID","EVENTO_ID","DESCRICAO_EVENTO","TIPO_ANDAMENTO_INTEGRACAO_ID","DATA_PROTOCOLO","COMPLEMENTO","PROCESSO_ID","ANDAMENTO_ATTORNATUS_ID","TIPO_ANDAMENTO_INSTITUICAO_ID","DOCUMENTO_JUDICIAL_ID","BUSINESS_KEY","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"CHAMADA_SERVICO","fullName":"ATT_INTEGRAJUD.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","JURISDICAO_ID","JUIZO_ID","PROCESSO_ID","NUMERO_PROCESSO","MENSAGEM_ERRO","DOCUMENTO_ID","ORIGEM_ID"]},{"schema":"ATT_INTEGRAJUD","name":"JURISDICAO_JUIZO","fullName":"ATT_INTEGRAJUD.JURISDICAO_JUIZO","columns":["ID","INTEGRACAO_ID","JURISDICAO_ID","JURISDICAO_NOME","JUIZO_ID","JUIZO_NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"ANDAMENTO_JUDICIAL","fullName":"ATT_INTEGRAJUD.ANDAMENTO_JUDICIAL","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","ORIGEM_ID","TIPO","DATA_DISPONIBILIZACAO","DATA_TERMINO_CARENCIA","PRAZO","DATA_VENCIMENTO","DATA_CIENCIA","DOCUMENTO_JUDICIAL_ID","TIPO_MOVIMENTO_ID","DESCRICAO_TIPO_MOVIMENTO","NUMERO_PROCESSO","CNPJ_PARTE_REPRESENTADA","NOME_PARTE_REPRESENTADA","CLASSE_ID","ASSUNTO_ID","VALOR_CAUSA","DATA_AJUIZAMENTO","JUIZO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_PRAZO","DOCUMENTO_PROTOCOLADO_ID","COMPLEMENTO","DOCUMENTO_CIENCIA_ID","DESCRICAO_DESCARTE","COMPETENCIA_ID","JURISDICAO_ID","IDENTIFICADOR_PROCESSO_INTEGRACAO","IMPEDIMENTO_BUSCA_TEOR","INSTANCIA","ORGAO_JULGADOR_ID","HASH_COMPLEMENTO","IDENTIFICADOR_ANDAMENTO_PASTA_INTEGRACAO","EVENTO_ID","COMUNICACAO_VINCULADA_ID"]},{"schema":"ATT_INTEGRAJUD","name":"CREDENCIAL_USUARIO","fullName":"ATT_INTEGRAJUD.CREDENCIAL_USUARIO","columns":["ID","CREDENCIAL_ID","USUARIO","USUARIO_INTEGRACAO","SENHA_INTEGRACAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"DOCUMENTO_JUDICIAL","fullName":"ATT_INTEGRAJUD.DOCUMENTO_JUDICIAL","columns":["ID","INTEGRACAO_ID","DOCUMENTO_INTEGRACAO_ID","DOCUMENTO_ATTORNATUS_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","PROCESSO_ID","HASH_DOCUMENTO_INTEGRACAO","DATA_PROTOCOLO","DOCUMENTO_JUDICIAL_VINCULADO_ID","TIPO_ANDAMENTO_ATTORNATUS_ID","TIPO_DOCUMENTO_ATTORNATUS_ID","ANDAMENTO_ATTORNATUS_ID","IGNORADO","PENDENTE_CIENCIA","IDENTIFICADOR_ANDAMENTO_PASTA_INTEGRACAO","TIPO_ANDAMENTO_INTEGRACAO_ID","TIPO_DOCUMENTO_INTEGRACAO_ID","BUSINESS_KEY","DATA_INICIO_BUSCA_TEOR","NOME","ROTULO"]},{"schema":"ATT_INTEGRAJUD","name":"SERVICO_INSTITUICAO","fullName":"ATT_INTEGRAJUD.SERVICO_INSTITUICAO","columns":["ID","SERVICO_ID","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_INTEGRAJUD.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_INTEGRAJUD","name":"PROTOCOLO_FOR_AUDIT01","fullName":"ATT_INTEGRAJUD.PROTOCOLO_FOR_AUDIT01","columns":["DOCUMENTO_ID","MENSAGEM_ID","SERVICO_ID","DATA_PROTOCOLO","PROTOCOLO","CODIGO_RETORNO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_ENVIO","STATUS","PROCESSO_ID","NUMERO_PROCESSO","UNIDADE_JUDICIAL_ID","JUIZO"]},{"schema":"ATT_INTEGRAJUD","name":"PROTOCOLO_FOR_AUDIT02","fullName":"ATT_INTEGRAJUD.PROTOCOLO_FOR_AUDIT02","columns":["DOCUMENTO_ID","MENSAGEM_ID","SERVICO_ID","DATA_PROTOCOLO","PROTOCOLO","CODIGO_RETORNO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_ENVIO","STATUS","PROCESSO_ID","NUMERO_PROCESSO","UNIDADE_JUDICIAL_ID","JUIZO"]},{"schema":"ATT_INTEGRAJUD","name":"BKP_ANDAMENTO_JUDICIAL","fullName":"ATT_INTEGRAJUD.BKP_ANDAMENTO_JUDICIAL","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","ORIGEM_ID","TIPO","DATA_DISPONIBILIZACAO","DATA_TERMINO_CARENCIA","PRAZO","DATA_VENCIMENTO","DATA_CIENCIA","DOCUMENTO_JUDICIAL_ID","MOVIMENTO_ID","DESCRICAO_MOVIMENTO","NUMERO_PROCESSO","CNPJ_PARTE_REPRESENTADA","NOME_PARTE_REPRESENTADA","CLASSE_ID","ASSUNTO_ID","VALOR_CAUSA","DATA_AJUIZAMENTO","JUIZO","DATA_NOTIFICACAO_BPMN_CIENCIA","BUSINESS_KEY","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_PRAZO","PROCESSO_ID","DOCUMENTO_PROTOCOLADO_ID","COMPLEMENTO","DOCUMENTO_CIENCIA_ID","DESCRICAO_DESCARTE","COMPETENCIA_ID","JURISDICAO_ID","IDENTIFICADOR_PROCESSO_INTEGRACAO","IMPEDIMENTO_BUSCA_TEOR","INSTANCIA","ORGAO_JULGADOR_ID"]},{"schema":"ATT_INTEGRAJUD","name":"PRAZO_TERMINO_CARENCIA","fullName":"ATT_INTEGRAJUD.PRAZO_TERMINO_CARENCIA","columns":["ID","INTEGRACAO_ID","TIPO","PRAZO","CIENCIA_AUTOMATICA_ATO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","CLASSE_ID","INSTITUICAO_ID"]},{"schema":"ATT_INTEGRAJUD","name":"ANDAMENTO_JUDICIAL_TEMP","fullName":"ATT_INTEGRAJUD.ANDAMENTO_JUDICIAL_TEMP","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","ORIGEM_ID","TIPO","DATA_DISPONIBILIZACAO","DATA_TERMINO_CARENCIA","PRAZO","DATA_VENCIMENTO","DATA_CIENCIA","DOCUMENTO_JUDICIAL_ID","MOVIMENTO_ID","DESCRICAO_MOVIMENTO","NUMERO_PROCESSO","CNPJ_PARTE_REPRESENTADA","NOME_PARTE_REPRESENTADA","CLASSE_ID","ASSUNTO_ID","VALOR_CAUSA","DATA_AJUIZAMENTO","JUIZO","DATA_NOTIFICACAO_BPMN_CIENCIA","BUSINESS_KEY","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","DATA_INICIO_PRAZO","PROCESSO_ID","DOCUMENTO_PROTOCOLADO_ID","COMPLEMENTO","DOCUMENTO_CIENCIA_ID","DESCRICAO_DESCARTE","COMPETENCIA_ID","JURISDICAO_ID","IDENTIFICADOR_PROCESSO_INTEGRACAO","IMPEDIMENTO_BUSCA_TEOR","INSTANCIA","ORGAO_JULGADOR_ID"]},{"schema":"ATT_INTEGRAJUD","name":"CLASSE_TIPO_PARTICIPACAO","fullName":"ATT_INTEGRAJUD.CLASSE_TIPO_PARTICIPACAO","columns":["ID","INTEGRACAO_ID","CLASSE_ID","NOME_TIPO_PARTICIPACAO","POLO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"INTEGRACAO_TEM_INSTANCIA","fullName":"ATT_INTEGRAJUD.INTEGRACAO_TEM_INSTANCIA","columns":["INTEGRACAO_ID","INSTANCIA"]},{"schema":"ATT_INTEGRAJUD","name":"CREDENCIAL_TEM_INTEGRACAO","fullName":"ATT_INTEGRAJUD.CREDENCIAL_TEM_INTEGRACAO","columns":["CREDENCIAL_ID","INTEGRACAO_ID"]},{"schema":"ATT_INTEGRAJUD","name":"COMPETENCIA_PETICIONAMENTO","fullName":"ATT_INTEGRAJUD.COMPETENCIA_PETICIONAMENTO","columns":["ID","INTEGRACAO_ID","UNIDADE_JUDICIAL_ID","JUIZADO_ESPECIAL","ABRANGENCIA_INSTITUICAO","MATERIA_ID","JURISDICAO_ID","COMPETENCIA_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ASSUNTO_CNJ_ID","CLASSE_ID"]},{"schema":"ATT_INTEGRAJUD","name":"TRANSICAO_SISTEMA_JUDICIAL","fullName":"ATT_INTEGRAJUD.TRANSICAO_SISTEMA_JUDICIAL","columns":["ID","INTEGRACAO_ID","IDENTIFICADOR_SISTEMA","ETAPA_TRANSICAO","DATA_INICIAL","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"ANDAMENTO_JUDICIAL_PROCESSO","fullName":"ATT_INTEGRAJUD.ANDAMENTO_JUDICIAL_PROCESSO","columns":["ID","ANDAMENTO_JUDICIAL_ID","PROCESSO_ID","DATA_NOTIFICACAO_BPMN_CIENCIA","BUSINESS_KEY","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"CHAMADA_SERVICO_FOR_AUDIT01","fullName":"ATT_INTEGRAJUD.CHAMADA_SERVICO_FOR_AUDIT01","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"CHAMADA_SERVICO_FOR_AUDIT02","fullName":"ATT_INTEGRAJUD.CHAMADA_SERVICO_FOR_AUDIT02","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAJUD","name":"JURISDICAO_UNIDADE_JUDICIAL","fullName":"ATT_INTEGRAJUD.JURISDICAO_UNIDADE_JUDICIAL","columns":["ID","INTEGRACAO_ID","JURISDICAO_ID","UNIDADE_JUDICIAL_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ORGAO_JULGADOR_ID"]},{"schema":"ATT_INTEGRAJUD","name":"TIPO_DOCUMENTO_TIPO_SERVICO","fullName":"ATT_INTEGRAJUD.TIPO_DOCUMENTO_TIPO_SERVICO","columns":["ID","INTEGRACAO_ID","TIPO_DOCUMENTO_INSTITUICAO","CLASSE_ID","TIPO_SERVICO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO_ANDAMENTO_INSTITUICAO","SINCRONIZAR_MESMO_PENDENTE_CIENCIA","TIPO_DOCUMENTO_JUDICIARIO"]},{"schema":"ATT_INTEGRAJUD","name":"UNIDADE_JUDICIAL_INTEGRACAO","fullName":"ATT_INTEGRAJUD.UNIDADE_JUDICIAL_INTEGRACAO","columns":["UNIDADE_JUDICIAL_ID","INTEGRACAO_ID","ID"]},{"schema":"ATT_INTEGRAJUD","name":"INTEGRACAO_TEM_COMPETENCIA_JUIZADO_ESPECIAL","fullName":"ATT_INTEGRAJUD.INTEGRACAO_TEM_COMPETENCIA_JUIZADO_ESPECIAL","columns":["ID","INTEGRACAO_ID","COMPETENCIA_ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIQUERY","fullName":"ATT_JASPER_APP.HT_JIQUERY","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIDATATYPE","fullName":"ATT_JASPER_APP.HT_JIDATATYPE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIOLAPUNIT","fullName":"ATT_JASPER_APP.HT_JIOLAPUNIT","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIRESOURCE","fullName":"ATT_JASPER_APP.HT_JIRESOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIREPORTUNIT","fullName":"ATT_JASPER_APP.HT_JIREPORTUNIT","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_FAKEJIRESOURCE","fullName":"ATT_JASPER_APP.HT_FAKEJIRESOURCE","columns":["ID","NAME","PARENT_FOLDER"]},{"schema":"ATT_JASPER_APP","name":"HT_JIFILERESOURCE","fullName":"ATT_JASPER_APP.HT_JIFILERESOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIINPUTCONTROL","fullName":"ATT_JASPER_APP.HT_JIINPUTCONTROL","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JILISTOFVALUES","fullName":"ATT_JASPER_APP.HT_JILISTOFVALUES","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIAWSDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIAWSDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIBEANDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIBEANDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIJDBCDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIJDBCDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIXMLACONNECTION","fullName":"ATT_JASPER_APP.HT_JIXMLACONNECTION","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JICONTENTRESOURCE","fullName":"ATT_JASPER_APP.HT_JICONTENTRESOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JICUSTOMDATASOURCE","fullName":"ATT_JASPER_APP.HT_JICUSTOMDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIREPORTJOBTRIGGER","fullName":"ATT_JASPER_APP.HT_JIREPORTJOBTRIGGER","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIVIRTUALDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIVIRTUALDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_FAKEJIRESOURCEFOLDER","fullName":"ATT_JASPER_APP.HT_FAKEJIRESOURCEFOLDER","columns":["ID","NAME","PARENT_FOLDER"]},{"schema":"ATT_JASPER_APP","name":"HT_JIAZURESQLDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIAZURESQLDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIJNDIJDBCDATASOURCE","fullName":"ATT_JASPER_APP.HT_JIJNDIJDBCDATASOURCE","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIMONDRIANCONNECTION","fullName":"ATT_JASPER_APP.HT_JIMONDRIANCONNECTION","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_REPORESOURCEITEMBASE","fullName":"ATT_JASPER_APP.HT_REPORESOURCEITEMBASE","columns":["ID","NAME","PARENT_FOLDER"]},{"schema":"ATT_JASPER_APP","name":"HT_JIOLAPCLIENTCONNECTION","fullName":"ATT_JASPER_APP.HT_JIOLAPCLIENTCONNECTION","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIMONDRIANXMLADEFINITION","fullName":"ATT_JASPER_APP.HT_JIMONDRIANXMLADEFINITION","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIREPORTJOBSIMPLETRIGGER","fullName":"ATT_JASPER_APP.HT_JIREPORTJOBSIMPLETRIGGER","columns":["ID"]},{"schema":"ATT_JASPER_APP","name":"HT_JIREPORTJOBCALENDARTRIGGER","fullName":"ATT_JASPER_APP.HT_JIREPORTJOBCALENDARTRIGGER","columns":["ID"]},{"schema":"ATT_PUBLICACAO","name":"SEQUENCE","fullName":"ATT_PUBLICACAO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_PUBLICACAO","name":"PUBLICACAO","fullName":"ATT_PUBLICACAO.PUBLICACAO","columns":["ID","INSTITUICAO_ID","DATA_PUBLICACAO","NUMERO","PAGINA","TRIBUNAL_ID","INSTANCIA","UNIDADE_JUDICIAL","NUMERO_PROCESSO","NOVA_DISTRIBUICAO","HASH_MENSAGEM_ORIGEM","HASH","NUMERO_PROCESSO_ORIGEM","CLASSE","PARTE_ATIVA","PARTE_PASSIVA","DESPACHO","DATA_RECEBIMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","REGRA_DESCARTE_ID","DATA_DESCARTE","DESCARTADO_POR","DATA_PROCESSAMENTO","OBSERVACAO"]},{"schema":"ATT_PUBLICACAO","name":"REGRA_DESCARTE","fullName":"ATT_PUBLICACAO.REGRA_DESCARTE","columns":["ID","INSTITUICAO_ID","NOME","TRIBUNAL_ID","NUMERO_INVALIDO","MATERIA_ID","INSTANCIA","ELETRONICO","DUPLICIDADE_DIARIA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","PARTES_REPRESENTADAS_NAO_HABILITADAS","CLASSE","CNPJ_PARTES_REPRESENTADAS_NAO_HABILITADAS","NOME_PARTES_REPRESENTADAS_NAO_HABILITADAS","PROCESSO_NAO_MIGRADO"]},{"schema":"ATT_PUBLICACAO","name":"CHAMADA_SERVICO","fullName":"ATT_PUBLICACAO.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","MENSAGEM_RECEBIDA","MENSAGEM_RESPONDIDA"]},{"schema":"ATT_PUBLICACAO","name":"DE_PARA_TRIBUNAL","fullName":"ATT_PUBLICACAO.DE_PARA_TRIBUNAL","columns":["ID","IDENTIFICADOR_INTEGRACAO","TRIBUNAL_ID","NOME_INTEGRACAO","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PUBLICACAO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_PUBLICACAO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_PUBLICACAO","name":"PUBLICACAO_PROCURADOR","fullName":"ATT_PUBLICACAO.PUBLICACAO_PROCURADOR","columns":["ID","PUBLICACAO_ID","OAB","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_PUBLICACAO","name":"PUBLICACAO_TEM_BUSINESS_KEY","fullName":"ATT_PUBLICACAO.PUBLICACAO_TEM_BUSINESS_KEY","columns":["PUBLICACAO_ID","BUSINESS_KEY"]},{"schema":"ATT_COMUNICACAO","name":"SEQUENCE","fullName":"ATT_COMUNICACAO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_COMUNICACAO","name":"COMUNICACAO","fullName":"ATT_COMUNICACAO.COMUNICACAO","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","IDENTIFICADOR_NA_INTEGRACAO","TIPO","DATA_COMUNICACAO","PRAZO","TIPO_PRAZO","AVISO_ID","MOVIMENTO_ID","DATA_CIENCIA","DATA_TERMINO_CARENCIA","DATA_INICIO_PRAZO","DATA_VENCIMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DOCUMENTO_PROTOCOLADO_ID","ANDAMENTO_JUDICIAL_VINCULADO_ID","MOTIVO_IMPEDIMENTO_GERACAO_DEMANDA","IMPEDIMENTO_BUSCA_TEOR"]},{"schema":"ATT_COMUNICACAO","name":"OUTRO_NUMERO","fullName":"ATT_COMUNICACAO.OUTRO_NUMERO","columns":["ID","PROCESSO_INTEGRACAO_ID","TIPO","NUMERO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_COMUNICACAO","name":"CHAMADA_SERVICO","fullName":"ATT_COMUNICACAO.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","MENSAGEM_ERRO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_COMUNICACAO","name":"PROCESSO_INTEGRACAO","fullName":"ATT_COMUNICACAO.PROCESSO_INTEGRACAO","columns":["ID","COMUNICACAO_ID","NUMERO","INSTANCIA","VARA_JUDICIAL","ASSUNTO","TRIBUNAL_INSTITUICAO_ID","CLASSE_INSTITUICAO_ID","DATA_AJUIZAMENTO","SEGREDO_JUSTICA","VALOR_CAUSA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_COMUNICACAO","name":"COMUNICACAO_PROCESSO","fullName":"ATT_COMUNICACAO.COMUNICACAO_PROCESSO","columns":["ID","COMUNICACAO_ID","PROCESSO_ID","BUSINESS_KEY","DATA_NOTIFICACAO_BPMN_CIENCIA","DOCUMENTO_INSTITUICAO_TEOR_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_COMUNICACAO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_COMUNICACAO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_COMUNICACAO","name":"PARTICIPACAO_INTEGRACAO","fullName":"ATT_COMUNICACAO.PARTICIPACAO_INTEGRACAO","columns":["ID","PROCESSO_INTEGRACAO_ID","POLO","NOME","TIPO_DOCUMENTO","NUMERO_DOCUMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_COMUNICACAO","name":"CHAMADA_SERVICO_TEM_PROPRIEDADE","fullName":"ATT_COMUNICACAO.CHAMADA_SERVICO_TEM_PROPRIEDADE","columns":["CHAMADA_SERVICO_ID","CHAVE","VALOR"]},{"schema":"ATT_DISTRIBUICAO","name":"SEQUENCE","fullName":"ATT_DISTRIBUICAO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_DISTRIBUICAO","name":"PONTUACAO","fullName":"ATT_DISTRIBUICAO.PONTUACAO","columns":["ID","INSTITUICAO_ID","LOCAL_DISTRIBUICAO_ID","TIPO_DEMANDA","TIPO_ANDAMENTO_ID","CLASSE_ID","QUANTIDADE_PONTOS","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","ASSUNTO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"DISTRIBUICAO","fullName":"ATT_DISTRIBUICAO.DISTRIBUICAO","columns":["ID","INSTITUICAO_ID","TIPO_OBJETO","OBJETO_ID","LOCAL_DISTRIBUICAO_ID","PASTA_PROCESSO_ID","NUMERO_SORTEADO","PONTUACAO_APLICADA","REGRA_RECEBIMENTO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","TIPO_DEMANDA","MODALIDADE","JUSTIFICATIVA","PROCESSO_ID","BUSINESS_KEY","DISTRIBUICAO_ANTERIOR_ID","MATERIA_ID","CLASSE_ID","UNIDADE_JUDICIAL_ID","JUIZO_ID","VALOR_PROCESSO","ASSUNTOS","PESSOA_CONTRARIA_ID","TIPO_ANDAMENTO_ID","USUARIO_SOLICITANTE","PERMISSAO","ETIQUETAS","PESSOA_REPRESENTADA_ID","MODO_REDISTRIBUICAO_DEMANDAS_PROCESSO","DATA_ESTORNO","TIPO_ESTORNO","TIPO_PROTOCOLO","MODO_DISTRIUICAO_LOCAL_DISTRIBUICAO_ID","DISTRIBUICAO_ORIGEM_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"GRUPO_CLASSE","fullName":"ATT_DISTRIBUICAO.GRUPO_CLASSE","columns":["ID","NOME","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DISTRIBUICAO","name":"PARTICIPANTE","fullName":"ATT_DISTRIBUICAO.PARTICIPANTE","columns":["ID","DISTRIBUICAO_ID","LOCAL_ID","USUARIO","TIPO_PARTICIPACAO_ID","PONTUACAO","QUANTIDADE_PROCESSOS","NUMERO_PARTICIPACAO","QUANTIDADE_DEMADAS_PROXIMO_VENCIMENTO","REDUCAO_RECEBIMENTO","LOCAL_DISTRIBUICAO_ID","PONTUACAO_CONSIDERADA","QUANTIDADE_PROCESSOS_CONSIDERADO","MESA","RESUMO_RECEBIMENTO_ID","DATA_ATUALIZACAO_RESUMO_RECEBIMENTO"]},{"schema":"ATT_DISTRIBUICAO","name":"V_DISTRIBUICAO","fullName":"ATT_DISTRIBUICAO.V_DISTRIBUICAO","columns":["DISTRIBUICAO_ID","PARTICIPANTE_ID","TIPO_PARTICIPACAO_ID","TIPO_PARTICIPACAO_NOME","DATA_ESTORNO","DISTRIBUICAO_ANTERIOR_ID","LOCAL_ID","LOCAL_DISTRIBUICAO_ID","USUARIO","PONTUACAO_CONSIDERADA","QUANTIDADE_PROCESSOS_CONSIDERADO","TIPO_OBJETO","TIPO_DEMANDA","MODALIDADE","JUSTIFICATIVA","PONTUACAO_APLICADA","REGRA_RECEBIMENTO_ID","NUMERO_SORTEADO","PROCESSO_ID","PASTA_PROCESSO_ID","OBJETO_ID","BUSINESS_KEY","INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_JUIZO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_JUIZO","columns":["REGRA_RECEBIMENTO_ID","JUIZO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_CLASSE","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_CLASSE","columns":["REGRA_RECEBIMENTO_ID","CLASSE_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_AFASTAMENTO","fullName":"ATT_DISTRIBUICAO.REGRA_AFASTAMENTO","columns":["ID","TIPO_REDISTRIBUICAO_DEMANDA","UNIDADE_DESTINO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","RECEBE_PROCESSO","APLICACAO_REGRA","LOTACAO_ID","DATA_VIGENCIA_INICIAL","DATA_VIGENCIA_FINAL"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_RECEBIMENTO","fullName":"ATT_DISTRIBUICAO.REGRA_RECEBIMENTO","columns":["ID","INSTITUICAO_ID","NOME","TIPO","LOCAL_ID","DATA_INICIAL","DATA_FINAL","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION","REDISTRIBUIR_PASTA","VALOR_PROCESSO_MINIMO","VALOR_PROCESSO_MAXIMO","USUARIO","ESPECIALIDADE_EXCLUSIVA","DOCUMENTO_AUTOMATICO","REDISTRIBUIR_PROCESSO","JUIZADO_ESPECIAL","BPMN"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_ASSUNTO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_ASSUNTO","columns":["REGRA_RECEBIMENTO_ID","ASSUNTO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_MATERIA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_MATERIA","columns":["REGRA_RECEBIMENTO_ID","MATERIA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_USUARIO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_USUARIO","columns":["REGRA_RECEBIMENTO_ID","USUARIO"]},{"schema":"ATT_DISTRIBUICAO","name":"TIPO_PARTICIPACAO","fullName":"ATT_DISTRIBUICAO.TIPO_PARTICIPACAO","columns":["ID","NOME","CONTEMPLATORIA","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_ETIQUETA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_ETIQUETA","columns":["IDENTIFICADOR_ETIQUETA","REGRA_RECEBIMENTO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_PASTA_ID","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_PASTA_ID","columns":["REGRA_RECEBIMENTO_ID","PASTA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TRIBUNAL","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TRIBUNAL","columns":["REGRA_RECEBIMENTO_ID","TRIBUNAL_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"HISTORICO_PONTUACAO","fullName":"ATT_DISTRIBUICAO.HISTORICO_PONTUACAO","columns":["ID","LOCAL_ID","USUARIO","COMPETENCIA","QUANTIDADE_DEMANDAS","PONTUACAO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DISTRIBUICAO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_DISTRIBUICAO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TIPO_OBJETO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TIPO_OBJETO","columns":["REGRA_RECEBIMENTO_ID","TIPO_OBJETO"]},{"schema":"ATT_DISTRIBUICAO","name":"MODALIDADE_COMPETENCIA","fullName":"ATT_DISTRIBUICAO.MODALIDADE_COMPETENCIA","columns":["ID","GRUPO_CLASSE_ID","INSTITUICAO_ID","LOCAL_ID","MODALIDADE","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_GRUPO_CLASSE","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_GRUPO_CLASSE","columns":["REGRA_RECEBIMENTO_ID","GRUPO_CLASSE_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_LOCAL_ORIGEM","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_LOCAL_ORIGEM","columns":["REGRA_RECEBIMENTO_ID","LOCAL_ORIGEM_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TIPO_DEMANDA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TIPO_DEMANDA","columns":["REGRA_RECEBIMENTO_ID","TIPO_DEMANDA"]},{"schema":"ATT_DISTRIBUICAO","name":"GRUPO_CLASSE_TEM_CLASSE","fullName":"ATT_DISTRIBUICAO.GRUPO_CLASSE_TEM_CLASSE","columns":["GRUPO_CLASSE_ID","CLASSE_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TIPO_ANDAMENTO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TIPO_ANDAMENTO","columns":["REGRA_RECEBIMENTO_ID","TIPO_ANDAMENTO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TIPO_DOCUMENTO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TIPO_DOCUMENTO","columns":["REGRA_RECEBIMENTO_ID","TIPO_DOCUMENTO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_TIPO_PROTOCOLO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_TIPO_PROTOCOLO","columns":["REGRA_RECEBIMENTO_ID","TIPO_PROTOCOLO"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_PARTE_CONTRARIA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_PARTE_CONTRARIA","columns":["REGRA_RECEBIMENTO_ID","PARTE_CONTRARIA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_AFASTAMENTO_TEM_MESA","fullName":"ATT_DISTRIBUICAO.REGRA_AFASTAMENTO_TEM_MESA","columns":["REGRA_AFASTAMENTO_ID","MESA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_RECEBIMENTO_TEM_MESA","fullName":"ATT_DISTRIBUICAO.REGRA_RECEBIMENTO_TEM_MESA","columns":["REGRA_RECEBIMENTO_ID","MESA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_UNIDADE_JUDICIAL","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_UNIDADE_JUDICIAL","columns":["REGRA_RECEBIMENTO_ID","UNIDADE_JUDICIAL_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_PARTE_REPRESENTADA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_PARTE_REPRESENTADA","columns":["REGRA_RECEBIMENTO_ID","PARTE_REPRESENTADA_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_QUALIFICACAO_PASTA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_QUALIFICACAO_PASTA","columns":["REGRA_RECEBIMENTO_ID","QUALIFICACAO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_LOCAL_ORIGEM_PROCESSO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_LOCAL_ORIGEM_PROCESSO","columns":["REGRA_RECEBIMENTO_ID","LOCAL_ORIGEM_PROCESSO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_LOCAL_DISTRIBUICAO_ORIGEM","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_LOCAL_DISTRIBUICAO_ORIGEM","columns":["REGRA_RECEBIMENTO_ID","LOCAL_DISTRIBUICAO_ORIGEM_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_USUARIO_CRIADOR_ANDAMENTO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_USUARIO_CRIADOR_ANDAMENTO","columns":["REGRA_RECEBIMENTO_ID","USUARIO_CRIADOR_ANDAMENTO"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_QUALIFICACAO_PARTE_CONTRARIA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_QUALIFICACAO_PARTE_CONTRARIA","columns":["REGRA_RECEBIMENTO_ID","QUALIFICACAO_ID"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_CATEGORIA_SITUACAO_PARTE_CONTRARIA","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_CATEGORIA_SITUACAO_PARTE_CONTRARIA","columns":["REGRA_RECEBIMENTO_ID","CATEGORIA_SITUACAO"]},{"schema":"ATT_DISTRIBUICAO","name":"REGRA_TEM_LOCAL_DISTRIBUICAO_ORIGEM_INTEGRACAO","fullName":"ATT_DISTRIBUICAO.REGRA_TEM_LOCAL_DISTRIBUICAO_ORIGEM_INTEGRACAO","columns":["REGRA_RECEBIMENTO_ID","LOCAL_DISTRIBUICAO_ORIGEM_INTEGRACAO_ID"]},{"schema":"ATT_REQUISITORIO","name":"CONTA","fullName":"ATT_REQUISITORIO.CONTA","columns":["ID","OFICIO_ID","TIPO","PARTICIPACAO_ID","ASSUNTO_ID","MOVIMENTO_CONTA_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_SITUACAO_ID","ORIGEM"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO","fullName":"ATT_REQUISITORIO.ACORDO","columns":["ID","INSTITUICAO_ID","NUMERO","TIPO","CLASSE_ID","OFICIO_ID","BENEFICIARIO_PESSOA_ID","PROCESSO_ADMINISTRATIVO_ID","BUSINESS_KEY","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","DATA_NOTIFICACAO_PROCESSO_JUDICIAL","CONTA_BANCARIA_ID","TIPO_SITUACAO","DATA_SITUACAO","PARECER","TERMO_ACORDO_ID","PERCENTUAL_DESAGIO","DATA_CONCLUSAO_CADASTRO","PESSOA_REPRESENTANTE_ID","PREFERENCIA_CONSTITUCIONAL","PERCENTUAL","USAR_NOVA_ESTRUTURA","REQUISITORIO_ID","DATA_PARECER"]},{"schema":"ATT_REQUISITORIO","name":"OFICIO","fullName":"ATT_REQUISITORIO.OFICIO","columns":["ID","REQUISITORIO_ID","SEQUENCIA","DATA_BASE","VALOR_REQUISITADO","NUMERO","DATA","DATA_RECEBIMENTO_TRIBUNAL","CONTA_OFICIO_ID","CONTA_PENDENTE_REGULARIZACAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","COMPLEMENTAR","ARTIGO_MORATORIA","DATA_VALIDACAO","DATA_CANCELAMENTO","ORIGEM"]},{"schema":"ATT_REQUISITORIO","name":"NATUREZA","fullName":"ATT_REQUISITORIO.NATUREZA","columns":["ID","INSTITUICAO_ID","DESCRICAO","PRIORIDADE","SIGLA","AGRUPADOR","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"SEQUENCE","fullName":"ATT_REQUISITORIO.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_REQUISITORIO","name":"MOVIMENTO","fullName":"ATT_REQUISITORIO.MOVIMENTO","columns":["ID","CONTA_ID","TIPO","DATA","MOVIMENTO_PAI_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","OFICIO_MOVIMENTO_ID"]},{"schema":"ATT_REQUISITORIO","name":"RELATORIO","fullName":"ATT_REQUISITORIO.RELATORIO","columns":["ID","TIPO","DATA_INICIAL","DATA_FINAL","INCLUI_ACORDOS_JA_GERADOS","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"TIPO_VERBA","fullName":"ATT_REQUISITORIO.TIPO_VERBA","columns":["ID","NOME","TIPO_VALOR","CATEGORIA","NOME_BEAN","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","ENDPOINT","ATRIBUTO_DISPLAY","SEARCH_SPECIFICATION","CHAVE_COMPARACAO","TIPO_VERBA_REFERENCIA_ID"]},{"schema":"ATT_REQUISITORIO","name":"JURO_OFICIO","fullName":"ATT_REQUISITORIO.JURO_OFICIO","columns":["ID","OFICIO_ID","TIPO","REGIME","PERIODICIDADE","FONTE","TAXA","INCIDENCIA_TIPO_VERBA_ID","DATA_INICIAL","DATA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"PARTICIPACAO","fullName":"ATT_REQUISITORIO.PARTICIPACAO","columns":["ID","OFICIO_ID","PESSOA_ID","NOME_ID","NUMERO_RRA","RRA_ND","ISENTA_OFICIO","VINCULO_EMPREGATICIO_ID","TIPO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","CONTA_IRRF_ID","PREFERENCIA_CONSTITUCIONAL","DOCUMENTO_PRINCIPAL_ID","INFORMACAO_COMPLEMENTAR","CONTA_BANCARIA_ID","DOCUMENTO_TITULAR_CONTA_BANCARIA"]},{"schema":"ATT_REQUISITORIO","name":"REQUISITORIO","fullName":"ATT_REQUISITORIO.REQUISITORIO","columns":["ID","INSTITUICAO_ID","PROCESSO_ORIGEM_ID","NATUREZA_ID","CLASSE_ID","ASSUNTO_PRINCIPAL_ID","ENTIDADE_DEVEDORA_ID","ENTIDADE_DEVEDORA_NOME_ID","ENTIDADE_PAGADORA_ID","IDENTIFICADOR_NA_INTEGRACAO","NUMERO_PROTOCOLO","NUMERO_JUDICIAL","NUMERO_OFICIO_REQUISITORIO","DATA_OFICIO_REQUISITORIO","DATA_RECEBIMENTO_ENTIDADE","DATA_TRANSITO_JULGADO","NUMERO_ORDEM","ANO_ORDEM","MES_ORDEM","LETRA_ORDEM","NUMERO_ORDEM_PESQUISA","OBSERVACAO","TRIBUNAL_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_ADMINISTRACAO","NUMERO_JUDICIAL_PESQUISA","NUMERO_JUDICIAL_ADMINISTRATIVO","NUMERO_JUDICIAL_ADMINISTRATIVO_PESQUISA","DATA_CANCELAMENTO","MATERIA_ID","ENTIDADE_PAGADORA_NOME_ID"]},{"schema":"ATT_REQUISITORIO","name":"INDEXADOR_TEMA","fullName":"ATT_REQUISITORIO.INDEXADOR_TEMA","columns":["ID","TEMA","TIPO_SUGESTAO","INDEXADOR_ID","MES_ORDEM","ANO_ORDEM","MATERIA_ID","CLASSE_ID","TRIBUNAL_ID","DATA_INICIAL","DATA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"LEI_LIMITE_RPV","fullName":"ATT_REQUISITORIO.LEI_LIMITE_RPV","columns":["ID","INSTITUICAO_ID","NOME","DATA_INICIAL","INDICE_ID","LIMITE","OBSOLETO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_SUGESTAO","fullName":"ATT_REQUISITORIO.REGRA_SUGESTAO","columns":["ID","NOME_BEAN","ORDENACAO","DATA_INICIAL","DATA_FINAL","PERCENTUAL_APLICAVEL","FONTE_APLICAVEL","PERIODICIDADE_APLICAVEL","REGIME_APLICAVEL","TIPO_JURO","MATERIAS","ARTIGO_MORATORIA","CLASSE_ID","REGRA_HABILITADA","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_REGRA_SUGESTAO","INDEXADOR_ID","DESCRICAO_REGRA_INDEXADOR","DATA_ORDEM","SEGMENTOS_JUDICIAIS"]},{"schema":"ATT_REQUISITORIO","name":"USO_TIPO_VERBA","fullName":"ATT_REQUISITORIO.USO_TIPO_VERBA","columns":["ID","INSTITUICAO_ID","ORDENACAO","TIPO_VERBA_ID","TIPO_VISIBILIDADE","OBRIGATORIO","SOMENTE_LEITURA","VALOR","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TAMANHO_CAMPO_FX"]},{"schema":"ATT_REQUISITORIO","name":"VALOR_MOVIMENTO","fullName":"ATT_REQUISITORIO.VALOR_MOVIMENTO","columns":["ID","MOVIMENTO_ID","TIPO_VERBA_ID","VALOR","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","STRING","PERCENTUAL","VALOR_BASE_CORRECAO_SIMPLES","JUROS_ADICIONADO_CORRECAO_SIMPLES"]},{"schema":"ATT_REQUISITORIO","name":"ANO_ORCAMENTARIO","fullName":"ATT_REQUISITORIO.ANO_ORCAMENTARIO","columns":["ID","DATA_INICIO","TRIBUNAL_ID","DIA_CORTE","MES_CORTE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"INDEXADOR_OFICIO","fullName":"ATT_REQUISITORIO.INDEXADOR_OFICIO","columns":["ID","OFICIO_ID","INDICE_ID","DATA_INICIAL","DATA_FINAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_SUGESTAO"]},{"schema":"ATT_REQUISITORIO","name":"DOMINIO_TIPO_VERBA","fullName":"ATT_REQUISITORIO.DOMINIO_TIPO_VERBA","columns":["ID","TIPO_VERBA_ID","VALOR","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"FORMULA_TIPO_VERBA","fullName":"ATT_REQUISITORIO.FORMULA_TIPO_VERBA","columns":["ID","INSTITUICAO_ID","NOME","TIPO_VERBA_ID","MOVIMENTO_PAI_CONTA_DIFERENTE","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"ITEM_PROCESSAMENTO","fullName":"ATT_REQUISITORIO.ITEM_PROCESSAMENTO","columns":["ID","LOTE_PROCESSAMENTO_ID","REQUISITORIO_ID","OFICIO_ID","CONTA_ID","MOVIMENTO_ID","PARTICIPACAO_ID","MENSAGEM_ERRO","OBSERVACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","LAYOUT_PAGAMENTO","FORMA_PAGAMENTO","DATA_IMPORTACAO_PREVIA"]},{"schema":"ATT_REQUISITORIO","name":"LOTE_PROCESSAMENTO","fullName":"ATT_REQUISITORIO.LOTE_PROCESSAMENTO","columns":["ID","ACTION","ESTRATEGIA_EXECUCAO","NUMERO_LOTE","INSTITUICAO_ID","QUANTIDADE","QUANTIDADE_SUCESSOS","QUANTIDADE_ERROS","DATA_TERMINO_PROCESSAMENTO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","TIPO_SITUACAO","DATA_ACAO"]},{"schema":"ATT_REQUISITORIO","name":"PERCENTUAL_DESAGIO","fullName":"ATT_REQUISITORIO.PERCENTUAL_DESAGIO","columns":["ID","ANO_ORDEM","DATA_INICIO","DATA_FINAL","PERCENTUAL","PREFERENCIA_CONSTITUCIONAL","INSTITUICAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"TIPO_SITUACAO_CONTA","fullName":"ATT_REQUISITORIO.TIPO_SITUACAO_CONTA","columns":["ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","CATEGORIA","BEAN_REGRA"]},{"schema":"ATT_REQUISITORIO","name":"RELATORIO_TEM_ACORDO","fullName":"ATT_REQUISITORIO.RELATORIO_TEM_ACORDO","columns":["RELATORIO_ID","ACORDO_ID"]},{"schema":"ATT_REQUISITORIO","name":"VINCULO_PARTICIPACAO","fullName":"ATT_REQUISITORIO.VINCULO_PARTICIPACAO","columns":["ID","PARTICIPACAO_ID","PARTICIPACAO_VINCULADA_ID","TIPO_VINCULO","PERCENTUAL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_REQUISITORIO.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_REQUISITORIO","name":"INDEXADOR_TEMA_ASSUNTO","fullName":"ATT_REQUISITORIO.INDEXADOR_TEMA_ASSUNTO","columns":["ID","TEMA","ASSUNTO_ID"]},{"schema":"ATT_REQUISITORIO","name":"ITEM_ARQUIVO_PAGAMENTO","fullName":"ATT_REQUISITORIO.ITEM_ARQUIVO_PAGAMENTO","columns":["NUMERO_GUIA","LINHA_ARQUIVO_IMPORTACAO","DATA_IMPORTACAO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","VALOR_PAGAMENTO","LINHA_ARQUIVO_GERACAO","ERRO","DEPOSITO_ID"]},{"schema":"ATT_REQUISITORIO","name":"REQUISITORIO_TEM_ASSUNTO","fullName":"ATT_REQUISITORIO.REQUISITORIO_TEM_ASSUNTO","columns":["REQUISITORIO_ID","ASSUNTO_ID"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_BENEFICIARIO_CONTA","fullName":"ATT_REQUISITORIO.ACORDO_BENEFICIARIO_CONTA","columns":["ID","ACORDO_BENEFICIARIO_PARTICIPACAO_ID","CONTA_ID","MOVIMENTO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"F_ESTOQUE_DIVIDA_SINTETICO","fullName":"ATT_REQUISITORIO.F_ESTOQUE_DIVIDA_SINTETICO","columns":["TIPO_ADM","AGRUPADOR_NATUREZA","NATUREZA_DESCRICAO","DATA_ATUALIZACAO_MOVIMENTO","DATA_ATUALIZACAO_TRUNCADA","ANO_ORDEM","ENTIDADE_PAGADORA_ID","ENTIDADE_DEVEDORA_ID","QTDE_REQUISITORIOS","QTDE_CREDORES","SOMA_VALOR","TOTAL_CREDOR","TOTAL_CONTRIBUICAO_PATRONAL","TOTAL_CONTRIBUICAO","TOTAL_IRRF","TOTAL_IRRF_HONORARIO_CONTRATUAL","INSTITUICAO_ID","DATA_ATUALIZACAO"]},{"schema":"ATT_REQUISITORIO","name":"MOVIMENTO_TEM_BUSINESS_KEY","fullName":"ATT_REQUISITORIO.MOVIMENTO_TEM_BUSINESS_KEY","columns":["MOVIMENTO_ID","BUSINESS_KEY"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_HONORARIO_CONTRATUAL","fullName":"ATT_REQUISITORIO.ACORDO_HONORARIO_CONTRATUAL","columns":["ID","ACORDO_ID","ORIGEM","PERCENTUAL","VINCULO_PARTICIPACAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"FORMULA_TIPO_VERBA_OPERACAO","fullName":"ATT_REQUISITORIO.FORMULA_TIPO_VERBA_OPERACAO","columns":["ID","FORMULA_TIPO_VERBA_ID","OPERACAO","TIPO_VERBA_ID","TIPO_REFERENCIA","VALOR_FIXO","VALOR_REFERENCIA_OBRIGATORIO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","CONDICAO_TIPO_VERBA_ID","VALOR_REFERENCIA_DEFAULT"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_ASSUNTO","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_ASSUNTO","columns":["ID","INSTITUICAO_ID","ORDENACAO","ASSUNTO_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_MATERIA","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_MATERIA","columns":["ID","INSTITUICAO_ID","ORDENACAO","MATERIA_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_ENTIDADE","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_ENTIDADE","columns":["ID","INSTITUICAO_ID","ORDENACAO","ENTIDADE_ID","NOME","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","NOME_ID"]},{"schema":"ATT_REQUISITORIO","name":"USO_TIPO_VERBA_USO_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.USO_TIPO_VERBA_USO_CHAVE_VALOR","columns":["USO_TIPO_VERBA_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_BENEFICIARIO_PARTICIPACAO","fullName":"ATT_REQUISITORIO.ACORDO_BENEFICIARIO_PARTICIPACAO","columns":["ID","ACORDO_ID","PARTICIPACAO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_HONORARIO_CONTRATUAL_CONTA","fullName":"ATT_REQUISITORIO.ACORDO_HONORARIO_CONTRATUAL_CONTA","columns":["ID","ACORDO_HONORARIO_CONTRATUAL_PARTICIPACAO_ID","CONTA_ID","MOVIMENTO_ID","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"FORMULA_TIPO_VERBA_USO_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.FORMULA_TIPO_VERBA_USO_CHAVE_VALOR","columns":["FORMULA_TIPO_VERBA_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"LOTE_PROCESSAMENTO_LOTE_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.LOTE_PROCESSAMENTO_LOTE_CHAVE_VALOR","columns":["LOTE_PROCESSAMENTO_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_HONORARIO_CONTRATUAL_PARTICIPACAO","fullName":"ATT_REQUISITORIO.ACORDO_HONORARIO_CONTRATUAL_PARTICIPACAO","columns":["ID","ACORDO_HONORARIO_CONTRATUAL_ID","PARTICIPACAO_ID","PAPEL","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_TEM_BUSINESS_KEY_PROCESSO_JUDICIAL","fullName":"ATT_REQUISITORIO.ACORDO_TEM_BUSINESS_KEY_PROCESSO_JUDICIAL","columns":["ACORDO_ID","PROCESSO_ID","BUSINESS_KEY"]},{"schema":"ATT_REQUISITORIO","name":"ACORDO_TEM_PERCENTUAL_HONORARIO_CONTRATUAL","fullName":"ATT_REQUISITORIO.ACORDO_TEM_PERCENTUAL_HONORARIO_CONTRATUAL","columns":["ACORDO_ID","PESSOA_ID","PERCENTUAL"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_ASSUNTO_USO_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_ASSUNTO_USO_CHAVE_VALOR","columns":["REGRA_CLASSIFICACAO_ASSUNTO_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_MATERIA_USO_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_MATERIA_USO_CHAVE_VALOR","columns":["REGRA_CLASSIFICACAO_MATERIA_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"REGRA_CLASSIFICACAO_ENTIDADE_USO_CHAVE_VALOR","fullName":"ATT_REQUISITORIO.REGRA_CLASSIFICACAO_ENTIDADE_USO_CHAVE_VALOR","columns":["REGRA_CLASSIFICACAO_ENTIDADE_ID","CHAVE","VALOR"]},{"schema":"ATT_REQUISITORIO","name":"ITEM_ARQUIVO_PAGAMENTO_TEM_ITEM_PROCESSAMENTO","fullName":"ATT_REQUISITORIO.ITEM_ARQUIVO_PAGAMENTO_TEM_ITEM_PROCESSAMENTO","columns":["NUMERO_GUIA","ITEM_PROCESSAMENTO_ID"]},{"schema":"ATT_INTEGRAREQJUD","name":"SEQUENCE","fullName":"ATT_INTEGRAREQJUD.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_INTEGRAREQJUD","name":"CHAMADA_SERVICO","fullName":"ATT_INTEGRAREQJUD.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","MENSAGEM_ERRO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAREQJUD","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_INTEGRAREQJUD.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_INTEGRAREQJUD","name":"REQUISITORIO_INTEGRACAO","fullName":"ATT_INTEGRAREQJUD.REQUISITORIO_INTEGRACAO","columns":["ID","INSTITUICAO_ID","INTEGRACAO_ID","IDENTIFICADOR_NA_INTEGRACAO","DATA_RECEBIMENTO","NUMERO_PROCESSO_ORIGEM","NUMERO_PROCESSO_REQUISITORIO","NUMERO_PROCESSO_RECURSO","TIPO_REQUISITORIO","PROCESSO_ID","REQUISITORIO_ID","DOCUMENTO_INSTITUICAO_ID","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAREQJUD","name":"REQUISITORIO_INTEGRACAO_LOG","fullName":"ATT_INTEGRAREQJUD.REQUISITORIO_INTEGRACAO_LOG","columns":["ID","REQUISITORIO_INTEGRACAO_ID","TIPO","MENSAGEM","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRAREQJUD","name":"CHAMADA_SERVICO_TEM_PROPRIEDADE","fullName":"ATT_INTEGRAREQJUD.CHAMADA_SERVICO_TEM_PROPRIEDADE","columns":["CHAMADA_SERVICO_ID","CHAVE","VALOR"]},{"schema":"ATT_INTEGRARECEITA","name":"SEQUENCE","fullName":"ATT_INTEGRARECEITA.SEQUENCE","columns":["SEQ_NAME","SEQ_COUNT"]},{"schema":"ATT_INTEGRARECEITA","name":"LOTE_ENVIO","fullName":"ATT_INTEGRARECEITA.LOTE_ENVIO","columns":["ID","PERIODO_APURACAO","PROTOCOLO_RECEITA","STATUS","DATA_ENVIO","DATA_CONSULTA","QUANTIDADE_EVENTOS","MENSAGEM_RETORNO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"EVENTO_DIRF","fullName":"ATT_INTEGRARECEITA.EVENTO_DIRF","columns":["ID","MOVIMENTO_ID","ANO_CALENDARIO","DATA_PAGAMENTO","DOCUMENTO_BENEFICIARIO","NOME_BENEFICIARIO","TIPO_BENEFICIARIO","CODIGO_RECEITA","NUMERO_PROCESSO","TIPO_ADVOGADO","DOCUMENTO_ADVOGADO","NOME_ADVOGADO","VALOR_PAGO_ADVOGADO","VALOR_RENDIMENTO_TRIBUTAVEL","VALOR_IMPOSTO_RETIDO","VALOR_CONTRIBUICOES","INDICADOR_RRA","IDENTIFICADOR_RRA","NATUREZA_RRA","QUANTIDADE_MESES_RRA","STATUS","DATA_PROCESSAMENTO","MENSAGEM_ERRO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"EVENTO_REINF","fullName":"ATT_INTEGRARECEITA.EVENTO_REINF","columns":["ID","MOVIMENTO_ID","EVENTO_ID","TIPO_EVENTO","DOCUMENTO_BENEFICIARIO","PERIODO_APURACAO","NATUREZA_RENDIMENTO","DATA_FATO_GERADOR","VALOR_RENDIMENTO_BRUTO","VALOR_RENDIMENTO_TRIBUTAVEL","VALOR_IR","NUMERO_PROCESSO","IDENTIFICADOR_ADICIONAL_EVENTO","INDICADOR_JUDICIAL","INDICADOR_FECHAMENTO_ABERTURA","TIPO_AMBIENTE","INDICADOR_RETIFICACAO","NUMERO_RECIBO","TIPO_INSCRICAO_ADVOGADO","NUMERO_INSCRICAO_ADVOGADO","TIPO_ISENCAO","VLR_ISENTO","INDICADOR_RRA","TIPO_PROCESSO_RRA","QUANTIDADE_MESES_RRA","STATUS","XML_ORIGINAL","SEQUENCIAL","DATA_PROCESSAMENTO","MENSAGEM_ERRO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION","OBSERVACAO"]},{"schema":"ATT_INTEGRARECEITA","name":"CHAMADA_SERVICO","fullName":"ATT_INTEGRARECEITA.CHAMADA_SERVICO","columns":["ID","INSTITUICAO_ID","SERVICO_ID","MENSAGEM_ENVIO","MENSAGEM_RETORNO","MENSAGEM_ERRO","CREATED_DATE","CREATED_BY","MODIFIED_DATE","MODIFIED_BY","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"LOTE_ENVIO_EVENTO","fullName":"ATT_INTEGRARECEITA.LOTE_ENVIO_EVENTO","columns":["LOTE_ENVIO_ID","EVENTO_REINF_ID"]},{"schema":"ATT_INTEGRARECEITA","name":"DIRF_EXCLUSAO_MANUAL","fullName":"ATT_INTEGRARECEITA.DIRF_EXCLUSAO_MANUAL","columns":["ID","ANO_CALENDARIO","MOVIMENTO_ID","DOCUMENTO_BENEFICIARIO","NUMERO_PROCESSO","DATA_PAGAMENTO","CODIGO_RECEITA","DATA_REGISTRO","MOTIVO","STATUS","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"FLYWAY_SCHEMA_HISTORY","fullName":"ATT_INTEGRARECEITA.FLYWAY_SCHEMA_HISTORY","columns":["installed_rank","version","description","type","script","checksum","installed_by","installed_on","execution_time","success"]},{"schema":"ATT_INTEGRARECEITA","name":"DIRF_SOLICITACAO_GERACAO","fullName":"ATT_INTEGRARECEITA.DIRF_SOLICITACAO_GERACAO","columns":["ID","SOLICITACAO_ID","ANO_CALENDARIO","DOCUMENTOS","CNPJ_DECLARANTE","NOME_DECLARANTE","NATUREZA_DECLARANTE","CPF_RESPONSAVEL_CNPJ","NOME_RESPONSAVEL","CPF_RESPONSAVEL","DDD_RESPONSAVEL","TELEFONE_RESPONSAVEL","EMAIL_RESPONSAVEL","RETIFICADORA","NUMERO_RECIBO","INDICADOR_SOCIO_OSTENSIVO","INDICADOR_DEPOSITARIO_CREDITO","INDICADOR_FUNDO_CLUBE","INDICADOR_PAGOU_EXTERIOR","INDICADOR_PLANO_SAUDE","INDICADOR_ENTIDADE_UNIAO","INDICADOR_FUNDACAO_PUBLICA","INDICADOR_SITUACAO_ESPECIAL","STATUS","DATA_SOLICITACAO","DATA_ATUALIZACAO","ERRO","ARQUIVO_TXT","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"DIRF_CARGA_BENEFICIARIO_ANO","fullName":"ATT_INTEGRARECEITA.DIRF_CARGA_BENEFICIARIO_ANO","columns":["ID","ANO_CALENDARIO","DOCUMENTO_BENEFICIARIO","STATUS","DATA_ATUALIZACAO","MENSAGEM_ERRO","CREATED_BY","CREATED_DATE","MODIFIED_BY","MODIFIED_DATE","VERSION"]},{"schema":"ATT_INTEGRARECEITA","name":"CHAMADA_SERVICO_TEM_PROPRIEDADE","fullName":"ATT_INTEGRARECEITA.CHAMADA_SERVICO_TEM_PROPRIEDADE","columns":["CHAMADA_SERVICO_ID","CHAVE","VALOR"]}]};

  function normalizeSqlName(value) {
    return String(value || "").replace(/^["'`\[]|["'`\]]$/g, "").trim();
  }

  function upperSqlName(value) {
    return normalizeSqlName(value).toUpperCase();
  }

  function normalizeColumnList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return normalizeSqlName(typeof item === "string" ? item : (item.name || item.column || item.columnName || item.nome));
      }).filter(Boolean);
    }
    if (typeof value === "object") return Object.keys(value).map(normalizeSqlName).filter(Boolean);
    return [];
  }

  function pushCatalogTable(out, schema, name, columns) {
    schema = normalizeSqlName(schema);
    name = normalizeSqlName(name);
    if (!name) return;
    var cols = normalizeColumnList(columns);
    out.push({ schema: schema, name: name, fullName: schema ? schema + "." + name : name, columns: cols });
  }

  function normalizeSchemaCatalog(input) {
    var source = input;
    var tables = [];
    if (!source || typeof source !== "object") throw new Error("JSON do catalogo invalido.");
    if (Array.isArray(source)) source = { tables: source };

    if (source.schemas && typeof source.schemas === "object") {
      Object.keys(source.schemas).forEach(function (schemaName) {
        var schemaValue = source.schemas[schemaName];
        if (Array.isArray(schemaValue)) {
          schemaValue.forEach(function (table) {
            pushCatalogTable(tables, schemaName, table.name || table.table || table.tableName || table.nome, table.columns || table.colunas);
          });
          return;
        }
        if (schemaValue && typeof schemaValue === "object") {
          Object.keys(schemaValue).forEach(function (tableName) {
            pushCatalogTable(tables, schemaName, tableName, schemaValue[tableName]);
          });
        }
      });
    }

    if (Array.isArray(source.tables)) {
      source.tables.forEach(function (table) {
        if (typeof table === "string") {
          var parts = table.split(".");
          pushCatalogTable(tables, parts.length > 1 ? parts[0] : "", parts.length > 1 ? parts.slice(1).join(".") : table, []);
          return;
        }
        if (!table || typeof table !== "object") return;
        pushCatalogTable(
          tables,
          table.schema || table.owner || table.esquema,
          table.name || table.table || table.tableName || table.nome,
          table.columns || table.colunas || table.fields || table.campos
        );
      });
    }

    var seen = {};
    tables = tables.filter(function (table) {
      var key = upperSqlName(table.fullName);
      if (!key || seen[key]) return false;
      seen[key] = true;
      var columnSeen = {};
      table.columns = table.columns.filter(function (column) {
        var columnKey = upperSqlName(column);
        if (!columnKey || columnSeen[columnKey]) return false;
        columnSeen[columnKey] = true;
        return true;
      });
      return true;
    }).sort(function (a, b) {
      return upperSqlName(a.fullName).localeCompare(upperSqlName(b.fullName));
    });

    if (!tables.length) throw new Error("Nenhuma tabela encontrada no JSON.");
    return { version: 1, importedAt: new Date().toISOString(), tables: tables };
  }

  function getSchemaCatalog() {
    var catalog = storage.getJson(KEYS.schemaCatalog);
    if (!catalog || !Array.isArray(catalog.tables)) return null;
    return catalog;
  }

  function getDefaultSchemaCatalog() {
    return JSON.parse(JSON.stringify(DEFAULT_SCHEMA_CATALOG));
  }

  function saveDefaultSchemaCatalog() {
    var catalog = getDefaultSchemaCatalog();
    storage.setJson(KEYS.schemaCatalog, catalog);
    storage.set(KEYS.schemaCatalogDefaultVersion, DEFAULT_SCHEMA_CATALOG_VERSION);
    syncSchemaCatalogInfo();
    return catalog;
  }

  function ensureDefaultSchemaCatalog() {
    if (getSchemaCatalog()) return;
    if (storage.get(KEYS.schemaCatalogDefaultVersion) === "cleared:" + DEFAULT_SCHEMA_CATALOG_VERSION) return;
    saveDefaultSchemaCatalog();
  }

  function saveSchemaCatalog(catalog) {
    storage.setJson(KEYS.schemaCatalog, catalog);
    storage.set(KEYS.schemaCatalogDefaultVersion, "custom");
    syncSchemaCatalogInfo();
  }

  function clearSchemaCatalog() {
    storage.remove(KEYS.schemaCatalog);
    storage.set(KEYS.schemaCatalogDefaultVersion, "cleared:" + DEFAULT_SCHEMA_CATALOG_VERSION);
    syncSchemaCatalogInfo();
  }

  function getSchemaCatalogSummary() {
    var catalog = getSchemaCatalog();
    if (!catalog) return "Nenhum catalogo carregado";
    var columns = catalog.tables.reduce(function (total, table) {
      return total + (Array.isArray(table.columns) ? table.columns.length : 0);
    }, 0);
    return catalog.tables.length + " tabelas, " + columns + " colunas";
  }

  function syncSchemaCatalogInfo() {
    if (state.schemaCatalogInfoEl) state.schemaCatalogInfoEl.textContent = getSchemaCatalogSummary();
  }

  function importSchemaCatalogFile(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name || "")) return alert("Selecione um arquivo .json.");
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var catalog = normalizeSchemaCatalog(JSON.parse(String(reader.result || "{}")));
        saveSchemaCatalog(catalog);
        showToast("Catalogo importado: " + getSchemaCatalogSummary());
      } catch (exception) {
        alert(exception.message || "JSON de catalogo invalido.");
      }
    };
    reader.onerror = function () { alert("Nao foi possivel ler o catalogo JSON."); };
    reader.readAsText(file, "UTF-8");
  }

  function exportSchemaCatalog() {
    var catalog = getSchemaCatalog();
    if (!catalog) return alert("Nenhum catalogo carregado para exportar.");
    downloadBlob("editor-query-catalogo-sql.json", new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json;charset=utf-8" }));
  }

  function createSchemaCatalogControls() {
    var wrap = document.createElement("div");
    wrap.className = "tm-schema-tools";
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", function () {
      importSchemaCatalogFile(fileInput.files && fileInput.files[0]);
      fileInput.value = "";
    }, true);

    function btn(label, handler, className) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener("click", handler, true);
      return button;
    }

    wrap.appendChild(fileInput);
    wrap.appendChild(btn("Importar JSON", function () { fileInput.click(); }));
    wrap.appendChild(btn("Exportar", exportSchemaCatalog));
    wrap.appendChild(btn("Restaurar padrao", function () {
      saveDefaultSchemaCatalog();
      showToast("Catalogo padrao restaurado");
    }));
    wrap.appendChild(btn("Limpar", function () {
      if (confirm("Remover o catalogo de autocomplete importado?")) {
        clearSchemaCatalog();
        showToast("Catalogo removido");
      }
    }, "danger"));
    return wrap;
  }

  function buildSqlAliasMap(sql) {
    var aliases = {};
    var keyword = /^(where|join|left|right|inner|outer|full|cross|on|group|order|having|union)$/i;
    String(sql || "").replace(/\b(from|join)\s+([A-Za-z0-9_$#"]+(?:\.[A-Za-z0-9_$#"]+)?)(?:\s+(?:as\s+)?([A-Za-z0-9_$#"]+))?/gi, function (_, clause, tableName, alias) {
      tableName = normalizeSqlName(tableName);
      alias = normalizeSqlName(alias);
      if (tableName) aliases[upperSqlName(tableName)] = tableName;
      if (alias && !keyword.test(alias)) aliases[upperSqlName(alias)] = tableName;
      return _;
    });
    return aliases;
  }

  function findCatalogTable(catalog, name, aliases) {
    var target = upperSqlName((aliases && aliases[upperSqlName(name)]) || name);
    if (!target) return null;
    return catalog.tables.find(function (table) {
      return upperSqlName(table.fullName) === target || upperSqlName(table.name) === target;
    }) || null;
  }

  function showSqlAutocomplete(cm) {
    if (!cm || typeof CodeMirror === "undefined" || !CodeMirror.showHint) {
      showToast("Autocomplete ainda nao carregou");
      return typeof CodeMirror !== "undefined" ? CodeMirror.Pass : null;
    }

    var catalog = getSchemaCatalog();
    var cursor = cm.getCursor();
    var line = cm.getLine(cursor.line) || "";
    var before = line.slice(0, cursor.ch);
    var dotMatch = before.match(/([A-Za-z0-9_$#"]+(?:\.[A-Za-z0-9_$#"]+)?)\.([A-Za-z0-9_$#"]*)$/);
    var token = cm.getTokenAt(cursor);
    var tokenText = (token && /^[A-Za-z0-9_$#]+$/.test(token.string || "")) ? token.string : "";
    var from = CodeMirror.Pos(cursor.line, dotMatch ? cursor.ch - dotMatch[2].length : (token ? token.start : cursor.ch));
    var to = CodeMirror.Pos(cursor.line, cursor.ch);
    var list = [];

    if (catalog && dotMatch) {
      var left = dotMatch[1];
      var prefix = upperSqlName(dotMatch[2]);
      var aliases = buildSqlAliasMap(cm.getValue());
      var table = findCatalogTable(catalog, left, aliases);
      if (table) {
        list = table.columns.filter(function (column) {
          return !prefix || upperSqlName(column).indexOf(prefix) === 0;
        }).map(function (column) {
          return { text: column, displayText: column, className: "tm-hint-column" };
        });
      } else {
        list = catalog.tables.filter(function (item) {
          return upperSqlName(item.schema) === upperSqlName(left) && (!prefix || upperSqlName(item.name).indexOf(prefix) === 0);
        }).map(function (item) {
          return { text: item.name, displayText: item.name, className: "tm-hint-table" };
        });
      }
    } else {
      var prefixText = upperSqlName(tokenText);
      SQL_HINT_KEYWORDS.forEach(function (word) {
        if (!prefixText || word.indexOf(prefixText) === 0) list.push({ text: word, displayText: word, className: "tm-hint-keyword" });
      });
      if (catalog) {
        catalog.tables.forEach(function (table) {
          if (!prefixText || upperSqlName(table.fullName).indexOf(prefixText) === 0 || upperSqlName(table.name).indexOf(prefixText) === 0) {
            list.push({ text: table.fullName, displayText: table.fullName, className: "tm-hint-table" });
          }
        });
      }
    }

    CodeMirror.showHint(cm, function () {
      return { list: list.slice(0, 80), from: from, to: to };
    }, { completeSingle: false });
    return null;
  }

  // ===================================================================
  // CSS
  // ===================================================================
  function injectCSSOnce() {
    if (state.cssInjected) return;
    state.cssInjected = true;

    var css = [
      /* Editor container */
      ".sql-editor-container-pro{position:relative;overflow:hidden;min-height:240px;border:1px solid #ccc;padding:4px;background:#fff;box-sizing:border-box;border-radius:8px;}",
      /* Toolbar */
      ".sql-toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;padding:5px 7px;background:linear-gradient(#f8fbff,#eaf1f9);border-top:1px solid #d7e0eb;border-bottom:1px solid #cfdbe8;box-shadow:inset 0 1px 0 rgba(255,255,255,.8);}",
      ".sql-toolbar.hidden{display:none !important;}",
      ".sql-ribbon-group{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:0;padding:16px 6px 5px 6px;position:relative;border:1px solid #d6e0eb;border-radius:6px;background:linear-gradient(#ffffff,#f8fbff);box-shadow:inset 0 1px 0 rgba(255,255,255,.9);}",
      ".sql-ribbon-group::before{content:attr(data-title);position:absolute;left:7px;top:2px;font-size:10px !important;line-height:12px;font-weight:700;letter-spacing:.45px;color:#40506a;text-transform:uppercase;}",
      ".sql-toolbar input[type='button'],.sql-toolbar button,.sql-toolbar select{height:28px !important;min-height:0 !important;padding:3px 9px !important;font-size:12px !important;line-height:18px !important;cursor:pointer;border-radius:6px;border:1px solid #b7c5d8;background:linear-gradient(#fff,#f7fbff);color:#20385f;}",
      ".sql-toolbar input[type='button']:hover,.sql-toolbar button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}",
      ".sql-toolbar select{min-width:128px;}",
      ".sql-icon-btn{display:inline-flex;align-items:center;gap:8px;color:#20385f;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);white-space:nowrap;}",
      ".sql-icon-btn .sql-btn-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:0!important;}",
      ".sql-icon-btn .sql-btn-icon svg{width:20px;height:20px;display:block;stroke:#17365f;fill:none;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round;}",
      ".sql-toolbar.sql-hide-icons .sql-btn-icon{display:none !important;}",
      ".sql-icon-btn.sql-icon-export .sql-btn-icon svg,.sql-icon-btn.sql-icon-import .sql-btn-icon svg{stroke:#0f56c8;}",
      ".sql-icon-btn.sql-icon-run .sql-btn-icon svg{stroke:#107c10;}",
      ".sql-icon-btn.sql-icon-clear .sql-btn-icon svg{stroke:#ca5010;}",
      ".sql-icon-btn.sql-icon-lint .sql-btn-icon svg{stroke:#5c2d91;}",
      ".sql-icon-btn.sql-icon-selection .sql-btn-icon svg,.sql-icon-btn.sql-icon-block .sql-btn-icon svg,.sql-icon-btn.sql-icon-settings .sql-btn-icon svg,.sql-icon-btn.sql-icon-snippets .sql-btn-icon svg{stroke:#17365f;}",
      ".sql-toolbar .tm-sep{opacity:.55;padding:0 6px;}",
      ".sql-editor-stats,.sql-lint-warning{font-size:11px;margin-top:3px;}",
      ".sql-lint-warning{color:#a00000;}",
      ".sql-editor-container-pro .CodeMirror{height:300px;}",
      ".sql-editor-container-pro .CodeMirror-scroll{overflow:auto !important;}",
      ".sql-editor-container-pro .CodeMirror-vscrollbar{z-index:80;}",
      ".sql-editor-container-pro .CodeMirror-hscrollbar{z-index:80;}",
      ".CodeMirror-gutter-sql-lint-gutter{width:.6em;}",
      /* Handles de redimensionamento do editor */
      ".cm-resize-handle{position:absolute;left:0;right:18px;bottom:0;height:8px;cursor:ns-resize;z-index:40;background:rgba(120,120,120,.25);}",
      ".cm-resize-handle-x{position:absolute;top:0;bottom:18px;right:18px;width:6px;cursor:ew-resize;z-index:40;background:rgba(120,120,120,.14);}",
      ".cm-resize-handle-diag{position:absolute;right:18px;bottom:0;width:12px;height:12px;cursor:nwse-resize;z-index:40;background:linear-gradient(135deg,rgba(120,120,120,.45),rgba(120,120,120,.05) 60%);}",
      /* Accordion */
      ".tm-query-accordion{border:1px solid #cfdbe8;border-radius:8px;overflow:hidden;background:#fff;margin-bottom:10px;box-shadow:0 1px 2px rgba(32,56,95,.08);}",
      ".tm-query-acc-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 10px;background:linear-gradient(#f7fbff,#eef4fb);cursor:pointer;user-select:none;color:#20385f;}",
      ".tm-query-acc-hd .left{display:flex;align-items:center;gap:8px;min-width:200px;}",
      ".tm-query-acc-hd .ttl{font-size:12px !important;line-height:16px;font-weight:700;letter-spacing:.1px;}",
      ".tm-query-acc-hd .meta{font-size:11px !important;line-height:15px;opacity:.75;white-space:nowrap;}",
      ".tm-query-acc-hd .chev{font-size:12px !important;line-height:16px;opacity:.8;transition:transform .15s ease;}",
      ".tm-query-acc-hd.tm-open .chev{transform:rotate(90deg);}",
      ".tm-query-acc-hd .right{display:flex;align-items:center;gap:6px;}",
      ".tm-query-acc-hd .right button{font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid #b7c5d8;background:linear-gradient(#fff,#f7fbff);color:#20385f;cursor:pointer;}",
      ".tm-query-acc-hd .right button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}",
      ".tm-query-acc-bd{padding:8px 8px 10px 8px;}",
      ".tm-query-acc-bd.tm-hidden{display:none !important;}",
      /* Modal */
      ".tm-modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999998;display:flex;align-items:center;justify-content:center;}",
      ".tm-query-modal-ov{z-index:2147483000 !important;}",
      ".tm-modal-win{background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column;}",
      ".tm-modal-hd{padding:10px 12px;background:#f3f3f3;display:flex;align-items:center;justify-content:space-between;gap:10px;}",
      ".tm-modal-hd .left{display:flex;align-items:center;gap:10px;}",
      ".tm-modal-hd .ttl{font-size:12px;font-weight:800;}",
      ".tm-modal-hd select,.tm-modal-hd button{font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid #aaa;background:#fff;cursor:pointer;}",
      ".tm-modal-bd{padding:10px;overflow:auto;}",
      ".tm-modal-bd:has(.tm-query-accordion){display:flex;flex:1;min-height:0;overflow:hidden;}",
      ".tm-modal-bd .tm-query-accordion{display:flex;flex:1;min-height:0;flex-direction:column;margin-bottom:0;}",
      ".tm-modal-bd .tm-query-acc-bd{display:flex;flex:1;min-height:0;overflow:hidden;}",
      ".tm-modal-bd .sql-editor-container-pro{display:flex;flex:1;min-height:0;flex-direction:column;width:100%;}",
      ".tm-modal-bd .sql-editor-container-pro .CodeMirror{flex:1;min-height:180px;width:100% !important;height:auto !important;}",
      ".tm-modal-bd .sql-editor-container-pro .CodeMirror-scroll{min-height:0;}",
      /* Painel de configurações */
      ".tm-snippets-win{width:min(1120px,96vw);height:min(800px,92vh);background:#f8fbff;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;color:#1f2937;}.tm-snippets-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#eaf1f9;border-bottom:1px solid #cfdae7;}.tm-snippets-head>div{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;}.tm-snippets-head button,.tm-snippets-settings button,.tm-snippet-card button{padding:5px 9px;border:1px solid #b7c5d8;border-radius:5px;background:#fff;color:#20385f;cursor:pointer;}.tm-snippets-tools{display:grid;grid-template-columns:1fr 220px auto;gap:8px;padding:9px;background:#fff;border-bottom:1px solid #dce5ef;}.tm-snippets-tools input,.tm-snippets-tools select{min-width:0;padding:6px;border:1px solid #b7c5d8;border-radius:5px;}.tm-snippets-tools label{display:flex;align-items:center;white-space:nowrap;}.tm-snippets-settings{padding:12px;background:#f7faff;border-bottom:1px solid #cfdbe8;}.tm-snippets-settings[hidden]{display:none;}.tm-snippets-settings-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#20385f;}.tm-snippets-settings-grid{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;}.tm-snippets-settings-grid label{display:grid;gap:4px;font-size:12px;font-weight:700;}.tm-snippets-settings-grid select{width:100%;padding:6px;border:1px solid #b7c5d8;border-radius:5px;background:#fff;}.tm-snippets-settings-grid input[type=checkbox]{justify-self:start;width:18px;height:18px;}.tm-snippets-settings-danger{display:flex;justify-content:flex-end;gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid #d9e2ec;}.tm-snippets-settings .danger{border-color:#c43b3b;color:#a12626;background:#fff7f7;}.tm-snippets-list{padding:10px;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-content:start;}.tm-snippets-list[data-density=compact]{gap:5px;}.tm-snippet-card{min-width:0;background:#fff;border:1px solid #d6e0eb;border-radius:6px;padding:9px;display:grid;gap:7px;align-content:start;}.tm-snippets-list[data-density=compact] .tm-snippet-card{padding:6px;gap:4px;}.tm-snippet-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}.tm-snippet-card-head strong{font-size:13px;color:#20385f;}.tm-snippet-card-head span{font-size:10px;color:#64748b;text-align:right;}.tm-snippet-card-description{margin:0;color:#526176;font-size:11px;line-height:1.35;}.tm-snippet-card-tags{display:flex;gap:4px;flex-wrap:wrap;}.tm-snippet-card-tags span{padding:2px 5px;border-radius:4px;background:#eaf1f9;color:#35547a;font-size:10px;}.tm-snippet-card pre{margin:0;overflow:auto;background:#f7f9fc;padding:6px;font:11px/16px Consolas,monospace;white-space:pre;}.tm-snippet-card-actions{display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap;margin-top:auto;}.tm-snippet-card .favorite{margin-right:auto;}.tm-snippet-card .favorite.active{border-color:#d49b16;background:#fff8db;color:#795500;}.tm-snippets-empty{grid-column:1/-1;padding:36px 16px;text-align:center;color:#64748b;background:#fff;border:1px dashed #b9c7d8;border-radius:6px;}.sql-snippet-placeholder{background:#fff2a8;border-bottom:1px solid #d19a00;}@media(max-width:900px){.tm-snippets-settings-grid{grid-template-columns:repeat(2,minmax(130px,1fr));}}@media(max-width:760px){.tm-snippets-list{grid-template-columns:1fr!important}.tm-snippets-tools{grid-template-columns:1fr}.tm-snippets-settings-grid{grid-template-columns:1fr}}",
      ".tm-snippet-editor{width:min(760px,94vw);max-height:90vh;background:#fff;border-radius:9px;box-shadow:0 14px 46px rgba(0,0,0,.38);display:flex;flex-direction:column;overflow:hidden;color:#1f2937;}",
      ".tm-snippet-editor-head{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:linear-gradient(#f7fbff,#eaf1f9);border-bottom:1px solid #cfdbe8;color:#20385f;}",
      ".tm-snippet-editor-head button,.tm-snippet-editor-footer button{padding:5px 10px;border:1px solid #b7c5d8;border-radius:6px;background:#fff;color:#20385f;cursor:pointer;}",
      ".tm-snippet-editor-form{padding:13px 15px;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;}",
      ".tm-snippet-editor-form label{display:grid;gap:4px;font-size:12px;font-weight:700;color:#374151;}.tm-snippet-editor-form label:nth-of-type(n+3){grid-column:1/-1;}",
      ".tm-snippet-editor-form input,.tm-snippet-editor-form select,.tm-snippet-editor-form textarea{width:100%;box-sizing:border-box;padding:7px;border:1px solid #b7c5d8;border-radius:6px;background:#fff;color:#20385f;font:12px Arial,sans-serif;}",
      ".tm-snippet-editor-form .tm-snippet-favorite-field{display:flex;align-items:center;gap:6px;grid-column:1/-1;}.tm-snippet-editor-form .tm-snippet-favorite-field input{width:18px;height:18px;margin:0;}",
      ".tm-snippet-editor-form textarea{resize:vertical;}.tm-snippet-description{min-height:62px;}.tm-snippet-code{min-height:260px;font-family:Consolas,monospace!important;line-height:1.4;}",
      ".tm-snippet-editor-help{grid-column:1/-1;padding:7px 9px;background:#f4f7fb;border:1px solid #dce5ef;border-radius:5px;color:#607089;font-size:11px;}",
      ".tm-snippet-editor-footer{display:flex;justify-content:flex-end;gap:7px;padding:10px 14px;border-top:1px solid #d6e0eb;background:#f8fbff;}.tm-snippet-editor-footer .primary{background:#185abd;color:#fff;border-color:#185abd;}",
      ".tm-snippet-json-editor{width:min(980px,96vw);height:min(820px,92vh);background:#fff;border-radius:9px;box-shadow:0 14px 46px rgba(0,0,0,.38);display:flex;flex-direction:column;overflow:hidden;color:#1f2937;}.tm-snippet-json-body{min-height:0;flex:1;display:flex;flex-direction:column;gap:8px;padding:12px 14px;}.tm-snippet-json-body p{margin:0;color:#607089;font-size:12px;}.tm-snippet-json-body details{font-size:11px;color:#526176;}.tm-snippet-json-body summary{cursor:pointer;font-weight:700;color:#35547a;}.tm-snippet-json-categories{margin-top:5px;padding:7px;background:#f4f7fb;border:1px solid #dce5ef;border-radius:5px;line-height:1.45;}.tm-snippet-json-body textarea{min-height:0;flex:1;width:100%;box-sizing:border-box;resize:none;padding:10px;border:1px solid #aebed1;border-radius:6px;background:#101827;color:#dbeafe;font:12px/1.45 Consolas,monospace;tab-size:2;}.tm-snippet-json-error{padding:7px 9px;border:1px solid #e1a4a4;border-radius:5px;background:#fff3f3;color:#9f2020;font-size:12px;}.tm-snippet-json-error[hidden]{display:none;}",
      "@media(max-width:650px){.tm-snippet-editor-form{grid-template-columns:1fr;}.tm-snippet-editor-form label{grid-column:1!important;}}",
      ".tm-settings-win{width:min(920px,94vw);max-height:88vh;background:#fff;border-radius:10px;box-shadow:0 12px 44px rgba(0,0,0,.32);overflow:hidden;display:flex;flex-direction:column;color:#1f2937;}",
      ".tm-settings-hd{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:linear-gradient(#f7fbff,#eaf1f9);border-bottom:1px solid #cfdbe8;}",
      ".tm-settings-hd .ttl{font-size:13px;font-weight:800;color:#20385f;}",
      ".tm-settings-hd .sub{font-size:11px;color:#607089;margin-top:2px;}",
      ".tm-settings-hd button,.tm-settings-ft button{font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;cursor:pointer;}",
      ".tm-settings-bd{padding:12px;overflow:auto;display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:12px;background:#fbfdff;}",
      ".tm-settings-card{border:1px solid #d6e0eb;border-radius:8px;background:#fff;padding:11px;}",
      ".tm-settings-card.tm-wide{grid-column:1 / -1;}",
      ".tm-settings-card h3{margin:0;font-size:12px;color:#20385f;text-transform:uppercase;letter-spacing:.4px;}",
      ".tm-settings-card .hint{margin:3px 0 9px 0;font-size:11px;line-height:1.35;color:#68758a;}",
      ".tm-setting-row{display:grid;grid-template-columns:1fr minmax(145px,auto);align-items:center;gap:12px;margin:7px 0;font-size:12px;}",
      ".tm-setting-row label{font-weight:600;color:#374151;line-height:1.25;}",
      ".tm-setting-row select,.tm-setting-row input[type='text']{width:100%;min-width:145px;font-size:12px;padding:4px 7px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;box-sizing:border-box;}",
      ".tm-setting-row input[type='checkbox']{width:16px;height:16px;}",
      ".tm-setting-row.tm-toggle{grid-template-columns:1fr 22px;}",
      ".tm-schema-tools{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}",
      ".tm-schema-tools button{font-size:12px;padding:4px 9px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;cursor:pointer;}",
      ".tm-schema-tools button:hover{background:#f4f8ff;border-color:#8fb0d8;}",
      ".tm-schema-tools button.danger{border-color:#d59a9a;color:#9f2020;background:#fff8f8;}",
      ".CodeMirror-hints{z-index:2147483600!important;border:1px solid #b7c5d8!important;border-radius:6px!important;box-shadow:0 8px 24px rgba(15,23,42,.18)!important;font:12px Consolas,monospace!important;}",
      ".CodeMirror-hint-active{background:#eaf3ff!important;color:#20385f!important;}",
      ".tm-toggle-grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:2px 14px;}",
      ".tm-toggle-grid .tm-setting-row{margin:4px 0;}",
      ".tm-bar-groups{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:10px;}",
      ".tm-settings-subgroup{border:1px solid #e0e7f0;border-radius:7px;background:#fbfdff;padding:9px;}",
      ".tm-settings-subgroup h4{margin:0 0 6px 0;font-size:11px;line-height:14px;color:#40506a;text-transform:uppercase;letter-spacing:.35px;}",
      ".tm-settings-subgroup .tm-toggle-grid{grid-template-columns:repeat(2,minmax(140px,1fr));gap:1px 12px;}",
      ".tm-settings-subgroup .tm-setting-row{margin:3px 0;}",
      ".tm-settings-ft{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border-top:1px solid #d6e0eb;background:#f8fbff;}",
      "@media(max-width:820px){.tm-settings-bd{grid-template-columns:1fr;}.tm-settings-card.tm-wide{grid-column:auto;}.tm-toggle-grid,.tm-bar-groups,.tm-settings-subgroup .tm-toggle-grid{grid-template-columns:1fr;}}",
      /* Caixa de execução */
      ".sql-exec-box{position:fixed;background:rgba(30,30,30,.95);color:#fff;padding:8px 12px;border-radius:10px;font-size:12px;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,.35);max-width:360px;min-width:230px;}",
      ".sql-exec-box.sql-pos-bottom-left{bottom:16px;left:20px;}",
      ".sql-exec-box.sql-pos-bottom-right{bottom:16px;right:20px;}",
      ".sql-exec-box.sql-pos-top-left{top:16px;left:20px;}",
      ".sql-exec-box.sql-pos-top-right{top:16px;right:20px;}",
      ".sql-exec-box.sql-pos-top-center{top:16px;left:50%;transform:translateX(-50%);}",
      ".sql-exec-box.sql-pos-bottom-center{bottom:16px;left:50%;transform:translateX(-50%);}",
      ".sql-exec-box.sql-toast-light{background:rgba(255,255,255,.98);color:#20385f;border:1px solid #cfdbe8;}",
      ".sql-exec-box.sql-toast-office{background:linear-gradient(#f7fbff,#eaf1f9);color:#20385f;border:1px solid #b7c5d8;}",
      ".sql-exec-box.sql-size-compact{font-size:11px;min-width:190px;max-width:300px;padding:6px 9px;border-radius:8px;}",
      ".sql-exec-box.sql-size-large{font-size:13px;min-width:300px;max-width:460px;padding:11px 14px;border-radius:12px;}",
      ".sql-exec-box-ok{border-left:4px solid #107c10;}",
      ".sql-exec-box-slow{background:rgba(130,88,0,.96);border-left:4px solid #f2c94c;}",
      ".sql-exec-box-slow.sql-toast-light{background:#fff9e8;border-color:#e0b341;color:#6b3d00;}",
      ".sql-exec-box-slow.sql-toast-office{background:linear-gradient(#fffaf0,#fff1c9);border-color:#e0b341;color:#6b3d00;}",
      ".sql-exec-box-warn{background:rgba(160,90,0,.95);}",
      ".sql-exec-box-warn.sql-toast-light{background:#fff7e6;border-color:#d99a31;color:#6b3d00;}",
      ".sql-exec-box-warn.sql-toast-office{background:linear-gradient(#fff7e6,#ffe9bf);border-color:#d99a31;color:#6b3d00;}",
      ".sql-exec-box-persistent{box-shadow:0 0 0 2px rgba(217,154,49,.22),0 6px 18px rgba(0,0,0,.35);}",
      ".sql-exec-main{font-weight:700;margin-bottom:4px;}",
      ".sql-exec-detail{font-size:11px;opacity:.9;margin-bottom:4px;line-height:1.35;}",
      ".sql-exec-close{position:absolute;top:5px;right:7px;border:0;background:transparent;color:inherit;font-size:16px;line-height:16px;cursor:pointer;opacity:.72;padding:0;}",
      ".sql-exec-close:hover{opacity:1;}",
      ".sql-exec-box.sql-hide-detail .sql-exec-detail{display:none;}",
      ".sql-exec-box.sql-hide-progress .sql-exec-progress{display:none;}",
      ".sql-exec-progress{height:3px;background:rgba(255,255,255,.18);overflow:hidden;border-radius:2px;}",
      ".sql-toast-light .sql-exec-progress,.sql-toast-office .sql-exec-progress{background:rgba(32,56,95,.15);}",
      ".sql-exec-progress-bar{height:100%;width:40%;background:#20c0ff;animation:sql-exec-progress 1.1s linear infinite;}",
      "@keyframes sql-exec-progress{0%{transform:translateX(-100%);}50%{transform:translateX(0);}100%{transform:translateX(100%);}}",
      /* Temas */
      ".sql-theme-system{}",
      ".sql-theme-darkpro{background:#1e1e1e !important;border-color:#444 !important;}",
      ".sql-theme-lightsql{background:#fff !important;}",
      ".sql-theme-dracula{background:#282a36 !important;border-color:#3a3d55 !important;}",
      ".sql-theme-monokai{background:#272822 !important;border-color:#3d3f34 !important;}"
    ].join("\n");

    var styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ===================================================================
  // CARREGAMENTO DE TEMA DO CODEMIRROR
  // ===================================================================
  function ensureThemeCssLoaded(cmThemeName) {
    if (!cmThemeName) return;
    var href = CM_THEME_CSS[cmThemeName];
    if (!href) return;
    var id = "tm-cm-theme-" + cmThemeName;
    if (document.getElementById(id)) return;
    var link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  // ===================================================================
  // VISIBILIDADE DA TOOLBAR
  // ===================================================================
  function setToolbarVisible(visible) {
    state.toolbarVisible = !!visible;
    storage.set(KEYS.toolbar, state.toolbarVisible ? "on" : "off");
    if (state.toolbarEl) state.toolbarEl.classList.toggle("hidden", !state.toolbarVisible);
    syncHeaderButtons();
  }

  function toggleToolbar() {
    setToolbarVisible(!state.toolbarVisible);
    // Se a toolbar foi ativada mas o accordion está fechado, abre-o para que seja visível
    if (state.toolbarVisible && !state.accordionOpen) setAccordionOpen(true);
    showToast(state.toolbarVisible ? "Toolbar: ON" : "Toolbar: OFF");
  }

  // ===================================================================
  // ACCORDION
  // ===================================================================
  function setAccordionOpen(open) {
    state.accordionOpen = !!open;
    storage.set(KEYS.accordionOpen, state.accordionOpen ? "on" : "off");

    if (state.accordionHeaderEl) state.accordionHeaderEl.classList.toggle("tm-open", state.accordionOpen);
    if (state.accordionBodyEl)   state.accordionBodyEl.classList.toggle("tm-hidden", !state.accordionOpen);
    if (state.accordionMetaEl)   state.accordionMetaEl.textContent = state.accordionOpen ? "Expandido" : "Oculto";

    if (state.accordionOpen && state.sqlEditor) {
      setTimeout(function () { try { state.sqlEditor.refresh(); } catch (_) {} }, 0);
    }
  }

  function toggleAccordion() {
    setAccordionOpen(!state.accordionOpen);
  }

  function loadAccordionState() {
    var raw = storage.get(KEYS.accordionOpen);
    // Padrão: aberto (true) se não houver valor salvo
    return raw === null ? true : raw === "on";
  }

  // ===================================================================
  // MODAL (MAXIMIZAR EDITOR)
  // ===================================================================
  function loadModalSize() {
    return storage.get(KEYS.modalSize) || "large";
  }

  function applyModalSize(size) {
    if (!state.modalWindowEl) return;
    var sizes = {
      small:  { w: "70vw", h: "70vh" },
      medium: { w: "80vw", h: "80vh" },
      large:  { w: "92vw", h: "90vh" },
      full:   { w: "98vw", h: "96vh" }
    };
    var s = sizes[size] || sizes.large;
    state.modalWindowEl.style.width  = s.w;
    state.modalWindowEl.style.height = s.h;
  }

  function ensureModal() {
    if (state.modalOverlayEl) return;

    state.modalOverlayEl = document.createElement("div");
    state.modalOverlayEl.className = "tm-modal-ov tm-query-modal-ov";
    state.modalOverlayEl.style.display = "none";

    state.modalWindowEl = document.createElement("div");
    state.modalWindowEl.className = "tm-modal-win";

    // Cabeçalho do modal
    var hd = document.createElement("div");
    hd.className = "tm-modal-hd";

    var left = document.createElement("div");
    left.className = "left";

    var ttl = document.createElement("div");
    ttl.className = "ttl";
    ttl.textContent = "Editor SQL — Modo Janela";

    state.modalSizeSelectEl = document.createElement("select");
    state.modalSizeSelectEl.innerHTML =
      "<option value='small'>Tamanho: Pequeno</option>" +
      "<option value='medium'>Tamanho: Médio</option>" +
      "<option value='large'>Tamanho: Grande</option>" +
      "<option value='full'>Tamanho: Tela quase cheia</option>";
    state.modalSizeSelectEl.value = loadModalSize();
    state.modalSizeSelectEl.addEventListener("change", function () {
      storage.set(KEYS.modalSize, state.modalSizeSelectEl.value);
      applyModalSize(state.modalSizeSelectEl.value);
      if (state.sqlEditor) setTimeout(function () { try { state.sqlEditor.refresh(); } catch (_) {} }, 0);
    }, true);

    left.appendChild(ttl);
    left.appendChild(state.modalSizeSelectEl);

    var right = document.createElement("div");
    Object.assign(right.style, { display: "flex", alignItems: "center", gap: "8px" });

    var btnRestore = document.createElement("button");
    btnRestore.type = "button";
    btnRestore.textContent = "Restaurar";
    btnRestore.addEventListener("click", closeModal, true);
    right.appendChild(btnRestore);

    hd.appendChild(left);
    hd.appendChild(right);

    state.modalBodyEl = document.createElement("div");
    state.modalBodyEl.className = "tm-modal-bd";

    state.modalWindowEl.appendChild(hd);
    state.modalWindowEl.appendChild(state.modalBodyEl);
    state.modalOverlayEl.appendChild(state.modalWindowEl);
    var textarea = PageAdapter.getTextarea();
    var pageForm = textarea ? textarea.closest("form") : null;
    (pageForm || document.body).appendChild(state.modalOverlayEl);

    // Fechar ao clicar fora da janela
    state.modalOverlayEl.addEventListener("mousedown", function (e) {
      if (e.target === state.modalOverlayEl) closeModal();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (state.modalIsOpen && e.key === "Escape") closeModal();
    }, true);

    applyModalSize(state.modalSizeSelectEl.value);
  }

  function openModal() {
    ensureModal();
    if (!state.accordionRootEl) return alert("Accordion ainda não foi criado.");
    if (state.modalIsOpen) return;

    var textarea = PageAdapter.getTextarea();
    var pageForm = textarea ? textarea.closest("form") : null;
    if (pageForm && state.modalOverlayEl.parentNode !== pageForm) {
      pageForm.appendChild(state.modalOverlayEl);
    }

    state.modalIsOpen = true;
    storage.set(KEYS.modalOpen, "on");

    // Salva a posição original do accordion no DOM para restauração posterior
    state.origAccordionParent = state.accordionRootEl.parentNode;
    state.origAccordionNext   = state.accordionRootEl.nextSibling;

    state.modalBodyEl.appendChild(state.accordionRootEl);
    setAccordionOpen(true);

    state.modalOverlayEl.style.display = "flex";
    applyModalSize(loadModalSize());
    syncHeaderButtons();

    if (state.sqlEditor) {
      setTimeout(function () {
        try {
          state.sqlEditor.refresh();
          state.sqlEditor.focus();
        } catch (_) {}
      }, 0);
    }
  }

  function closeModal() {
    if (!state.modalIsOpen) return;

    state.modalIsOpen = false;
    storage.set(KEYS.modalOpen, "off");

    try {
      if (state.origAccordionParent) {
        if (state.origAccordionNext) {
          state.origAccordionParent.insertBefore(state.accordionRootEl, state.origAccordionNext);
        } else {
          state.origAccordionParent.appendChild(state.accordionRootEl);
        }
      }
    } catch (_) {}

    if (state.modalOverlayEl) state.modalOverlayEl.style.display = "none";
    syncHeaderButtons();

    if (state.sqlEditor) setTimeout(function () { try { state.sqlEditor.refresh(); } catch (_) {} }, 0);
  }

  function closeSettingsPanel() {
    if (state.settingsOverlayEl) state.settingsOverlayEl.style.display = "none";
  }

  function resetSettingsPanel() {
    storage.set(KEYS.execWarn, CFG.execWarnThresholdSeconds);
    storage.set(KEYS.execFallback, CFG.execFallbackTimeoutSeconds);
    storage.set(KEYS.execCollapse, CFG.autoCollapseQueryAfterExecDefault ? "on" : "off");
    storage.set(KEYS.execToastPos, "bottom-center");
    storage.set(KEYS.execToastTheme, "dark");
    storage.set(KEYS.execToastSize, "large");
    storage.set(KEYS.execToastHide, "2");
    storage.set(KEYS.execToastDetail, "on");
    storage.set(KEYS.execToastProgress, "on");
    storage.set(KEYS.ribbonIcons, "off");
    storage.setJson(KEYS.ribbonItems, DEFAULT_RIBBON_ITEMS_VISIBLE);
    saveDefaultSchemaCatalog();
    setToolbarVisible(true);
    setLintEnabled(true);
    state.themeMode = "system";
    storage.set(KEYS.theme, state.themeMode);
    applyTheme();
    syncRibbonControls();
    if (state.settingsOverlayEl) {
      state.settingsOverlayEl.parentNode.removeChild(state.settingsOverlayEl);
      state.settingsOverlayEl = null;
      state.settingsWindowEl = null;
    }
    ensureSettingsPanel();
    openSettingsPanel();
    showToast("Configurações restauradas");
  }

  function ensureSettingsPanel() {
    if (state.settingsOverlayEl) return;

    state.settingsOverlayEl = document.createElement("div");
    state.settingsOverlayEl.className = "tm-modal-ov";
    state.settingsOverlayEl.style.display = "none";

    state.settingsWindowEl = document.createElement("div");
    state.settingsWindowEl.className = "tm-settings-win";

    var hd = document.createElement("div");
    hd.className = "tm-settings-hd";
    var titleBox = document.createElement("div");
    var ttl = document.createElement("div");
    ttl.className = "ttl";
    ttl.textContent = "Configurações";
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "Ajuste execução, visual do toast, editor e comandos da barra.";
    titleBox.appendChild(ttl);
    titleBox.appendChild(sub);
    var btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = "Fechar";
    btnClose.addEventListener("click", closeSettingsPanel, true);
    hd.appendChild(titleBox);
    hd.appendChild(btnClose);

    var body = document.createElement("div");
    body.className = "tm-settings-bd";

    var warnSelect = createSelect([
      { value: 5, label: "5 segundos" }, { value: 10, label: "10 segundos" },
      { value: 15, label: "15 segundos" }, { value: 30, label: "30 segundos" },
      { value: 60, label: "60 segundos" }, { value: 120, label: "120 segundos" }
    ], getExecWarnThresholdSeconds());
    warnSelect.addEventListener("change", function () {
      storage.set(KEYS.execWarn, warnSelect.value);
      syncRibbonControls();
    }, true);

    var fallbackSelect = createSelect([
      { value: 0, label: "Desligado" }, { value: 30, label: "30 segundos" },
      { value: 60, label: "60 segundos" }, { value: 120, label: "120 segundos" },
      { value: 300, label: "5 minutos" }
    ], getExecFallbackTimeoutSeconds());
    fallbackSelect.addEventListener("change", function () {
      storage.set(KEYS.execFallback, fallbackSelect.value);
      syncRibbonControls();
    }, true);

    var collapseCheck = document.createElement("input");
    collapseCheck.type = "checkbox";
    collapseCheck.checked = getAutoCollapseQueryAfterExec();
    collapseCheck.addEventListener("change", function () {
      storage.set(KEYS.execCollapse, collapseCheck.checked ? "on" : "off");
      syncRibbonControls();
    }, true);

    var toastPosSelect = createSelect([
      { value: "bottom-left", label: "Inferior esquerda" },
      { value: "bottom-right", label: "Inferior direita" },
      { value: "bottom-center", label: "Inferior centro" },
      { value: "top-left", label: "Superior esquerda" },
      { value: "top-right", label: "Superior direita" },
      { value: "top-center", label: "Superior centro" }
    ], getExecToastPosition());
    toastPosSelect.addEventListener("change", function () {
      storage.set(KEYS.execToastPos, toastPosSelect.value);
      applyExecToastOptions();
    }, true);

    var toastThemeSelect = createSelect([
      { value: "dark", label: "Escuro" },
      { value: "light", label: "Claro" },
      { value: "office", label: "Office" }
    ], getExecToastTheme());
    toastThemeSelect.addEventListener("change", function () {
      storage.set(KEYS.execToastTheme, toastThemeSelect.value);
      applyExecToastOptions();
    }, true);

    var toastSizeSelect = createSelect([
      { value: "compact", label: "Compacto" },
      { value: "normal", label: "Normal" },
      { value: "large", label: "Grande" }
    ], getExecToastSize());
    toastSizeSelect.addEventListener("change", function () {
      storage.set(KEYS.execToastSize, toastSizeSelect.value);
      applyExecToastOptions();
    }, true);

    var toastHideSelect = createSelect([
      { value: 0, label: "Não ocultar" },
      { value: 1, label: "1 segundo" },
      { value: 2, label: "2 segundos" },
      { value: 4, label: "4 segundos" },
      { value: 8, label: "8 segundos" }
    ], getExecToastHideSeconds());
    toastHideSelect.addEventListener("change", function () {
      storage.set(KEYS.execToastHide, toastHideSelect.value);
    }, true);

    var toastDetailCheck = document.createElement("input");
    toastDetailCheck.type = "checkbox";
    toastDetailCheck.checked = getExecToastDetailsVisible();
    toastDetailCheck.addEventListener("change", function () {
      storage.set(KEYS.execToastDetail, toastDetailCheck.checked ? "on" : "off");
      applyExecToastOptions();
    }, true);

    var toastProgressCheck = document.createElement("input");
    toastProgressCheck.type = "checkbox";
    toastProgressCheck.checked = getExecToastProgressVisible();
    toastProgressCheck.addEventListener("change", function () {
      storage.set(KEYS.execToastProgress, toastProgressCheck.checked ? "on" : "off");
      applyExecToastOptions();
    }, true);

    var toolbarCheck = document.createElement("input");
    toolbarCheck.type = "checkbox";
    toolbarCheck.checked = state.toolbarVisible;
    toolbarCheck.addEventListener("change", function () {
      setToolbarVisible(toolbarCheck.checked);
    }, true);

    var lintCheck = document.createElement("input");
    lintCheck.type = "checkbox";
    lintCheck.checked = state.lintEnabled;
    lintCheck.addEventListener("change", function () {
      setLintEnabled(lintCheck.checked);
    }, true);

    var iconsCheck = document.createElement("input");
    iconsCheck.type = "checkbox";
    iconsCheck.checked = getRibbonIconsVisible();
    iconsCheck.addEventListener("change", function () {
      storage.set(KEYS.ribbonIcons, iconsCheck.checked ? "on" : "off");
      applyRibbonDisplaySettings();
    }, true);

    var visibleMap = getRibbonItemsVisibleMap();
    var ribbonItemsByKey = {};
    RIBBON_ITEMS.forEach(function (item) {
      ribbonItemsByKey[item.key] = item;
    });
    function createRibbonItemRow(key) {
      var item = ribbonItemsByKey[key];
      if (!item) return null;
      var chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = visibleMap[item.key];
      chk.addEventListener("change", function () {
        setRibbonItemVisible(item.key, chk.checked);
      }, true);
      return createSettingRow(item.label, chk);
    }
    function createRibbonRows(keys) {
      return keys.map(createRibbonItemRow).filter(function (row) { return !!row; });
    }
    var ribbonGroups = [
      createSettingsSubgroup("Aparencia", [
        createSettingRow("Mostrar icones", iconsCheck)
      ]),
      createSettingsSubgroup("Execucao", createRibbonRows(["exec", "execSel", "selectBlock"])),
      createSettingsSubgroup("Timer e comportamento", createRibbonRows(["timerWarn", "timerRestore", "autoCollapse"])),
      createSettingsSubgroup("Editor e arquivos", createRibbonRows(["clear", "importSql", "exportSql", "snippets"])),
      createSettingsSubgroup("Revisao e visual", createRibbonRows(["lint", "theme"])),
      createSettingsSubgroup("Configuracao", createRibbonRows(["settings"]))
    ];

    var themeSelect = createSelect(THEMES.map(function (t) {
      return { value: t.id, label: t.label };
    }), state.themeMode);
    themeSelect.addEventListener("change", function () {
      state.themeMode = themeSelect.value;
      storage.set(KEYS.theme, state.themeMode);
      applyTheme();
      syncRibbonControls();
    }, true);

    body.appendChild(createSettingsCard("Execução", [
      createSettingRow("Alerta de execução lenta", warnSelect),
      createSettingRow("Restaurar seleção após", fallbackSelect),
      createSettingRow("Ocultar query após executar", collapseCheck)
    ], "Comportamento da execução e proteção ao executar apenas uma seleção."));

    body.appendChild(createSettingsCard("Toast", [
      createSettingRow("Posição do toast", toastPosSelect),
      createSettingRow("Tema do toast", toastThemeSelect),
      createSettingRow("Tamanho do toast", toastSizeSelect),
      createSettingRow("Ocultar toast concluído", toastHideSelect),
      createSettingRow("Mostrar detalhes", toastDetailCheck),
      createSettingRow("Mostrar progresso", toastProgressCheck)
    ], "Aparência e persistência da caixa que acompanha a execução."));

    state.schemaCatalogInfoEl = document.createElement("span");
    state.schemaCatalogInfoEl.className = "tm-schema-summary";
    syncSchemaCatalogInfo();

    body.appendChild(createSettingsCard("Editor", [
      createSettingRow("Tema", themeSelect),
      createSettingRow("Mostrar toolbar", toolbarCheck),
      createSettingRow("Lint SQL", lintCheck)
    ], "Preferências gerais do editor SQL."));

    body.appendChild(createSettingsCard("Autocomplete", [
      createSettingRow("Catalogo carregado", state.schemaCatalogInfoEl),
      createSettingRow("Catalogo JSON", createSchemaCatalogControls())
    ], "Importe um JSON com schemas, tabelas e colunas. Use Ctrl+Espaco no editor."));

    body.appendChild(createSettingsCard(
      "Barra",
      [createSettingsGroup(ribbonGroups, "tm-bar-groups")],
      "Escolha quais comandos aparecem na ribbon. O botão Config do cabeçalho permanece disponível.",
      "tm-wide"
    ));

    var ft = document.createElement("div");
    ft.className = "tm-settings-ft";
    var btnReset = document.createElement("button");
    btnReset.type = "button";
    btnReset.textContent = "Restaurar padrões";
    btnReset.addEventListener("click", function () {
      if (confirm("Restaurar configurações padrão do Editor de Query?")) resetSettingsPanel();
    }, true);
    var btnDone = document.createElement("button");
    btnDone.type = "button";
    btnDone.textContent = "Concluir";
    btnDone.addEventListener("click", closeSettingsPanel, true);
    ft.appendChild(btnReset);
    ft.appendChild(btnDone);

    state.settingsWindowEl.appendChild(hd);
    state.settingsWindowEl.appendChild(body);
    state.settingsWindowEl.appendChild(ft);
    state.settingsOverlayEl.appendChild(state.settingsWindowEl);
    document.body.appendChild(state.settingsOverlayEl);
    state.settingsOverlayEl.addEventListener("mousedown", function (e) {
      if (e.target === state.settingsOverlayEl) closeSettingsPanel();
    }, true);
  }

  function openSettingsPanel() {
    if (state.settingsOverlayEl) {
      state.settingsOverlayEl.parentNode.removeChild(state.settingsOverlayEl);
      state.settingsOverlayEl = null;
      state.settingsWindowEl = null;
    }
    ensureSettingsPanel();
    state.settingsOverlayEl.style.display = "flex";
  }

  // ===================================================================
  // BOTÕES DO HEADER DO ACCORDION
  // ===================================================================
  function syncHeaderButtons() {
    if (state.btnHdrToolbar) state.btnHdrToolbar.textContent = state.toolbarVisible ? "Toolbar: ON" : "Toolbar: OFF";
    if (state.btnHdrMax)     state.btnHdrMax.textContent     = state.modalIsOpen ? "Restaurar Editor" : "Maximizar Editor";
  }

  function ensureAccordionHeaderButtons(rightEl) {
    if (!rightEl) return;

    // Evita duplicação de botões
    var existing = rightEl.querySelector("button[data-tm='hdr-toolbar']");
    if (existing) {
      state.btnHdrToolbar = existing;
      state.btnHdrMax     = rightEl.querySelector("button[data-tm='hdr-max']");
      syncHeaderButtons();
      return;
    }

    state.btnHdrToolbar = document.createElement("button");
    state.btnHdrToolbar.type = "button";
    state.btnHdrToolbar.dataset.tm = "hdr-toolbar";
    state.btnHdrToolbar.textContent = state.toolbarVisible ? "Toolbar: ON" : "Toolbar: OFF";
    state.btnHdrToolbar.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      toggleToolbar();
    }, true);

    state.btnHdrMax = document.createElement("button");
    state.btnHdrMax.type = "button";
    state.btnHdrMax.dataset.tm = "hdr-max";
    state.btnHdrMax.textContent = "Maximizar Editor";
    state.btnHdrMax.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (state.modalIsOpen) closeModal();
      else openModal();
    }, true);

    var btnHdrSettings = document.createElement("button");
    btnHdrSettings.type = "button";
    btnHdrSettings.dataset.tm = "hdr-settings";
    btnHdrSettings.textContent = "Config";
    btnHdrSettings.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      openSettingsPanel();
    }, true);

    rightEl.appendChild(state.btnHdrToolbar);
    rightEl.appendChild(state.btnHdrMax);
    rightEl.appendChild(btnHdrSettings);
    syncHeaderButtons();
  }

  // ===================================================================
  // EDITOR — ACCORDION
  // ===================================================================
  function ensureQueryAccordion(container) {
    if (!container || container.closest(".tm-query-accordion")) return;

    state.accordionOpen = loadAccordionState();

    state.accordionRootEl = document.createElement("div");
    state.accordionRootEl.className = "tm-query-accordion";

    state.accordionHeaderEl = document.createElement("div");
    state.accordionHeaderEl.className = "tm-query-acc-hd";
    state.accordionHeaderEl.classList.toggle("tm-open", state.accordionOpen);

    var left = document.createElement("div");
    left.className = "left";

    var chev = document.createElement("span");
    chev.className = "chev";
    chev.textContent = "▶";

    var ttl = document.createElement("span");
    ttl.className = "ttl";
    ttl.textContent = "Query (Editor SQL)";

    left.appendChild(chev);
    left.appendChild(ttl);

    var right = document.createElement("div");
    right.className = "right";

    state.accordionMetaEl = document.createElement("span");
    state.accordionMetaEl.className = "meta";
    state.accordionMetaEl.textContent = state.accordionOpen ? "Expandido" : "Oculto";

    ensureAccordionHeaderButtons(right);

    state.accordionHeaderEl.appendChild(left);
    state.accordionHeaderEl.appendChild(state.accordionMetaEl);
    state.accordionHeaderEl.appendChild(right);

    state.accordionBodyEl = document.createElement("div");
    state.accordionBodyEl.className = "tm-query-acc-bd";
    state.accordionBodyEl.classList.toggle("tm-hidden", !state.accordionOpen);

    var parent = container.parentNode;
    parent.insertBefore(state.accordionRootEl, container);
    state.accordionRootEl.appendChild(state.accordionHeaderEl);
    state.accordionRootEl.appendChild(state.accordionBodyEl);
    state.accordionBodyEl.appendChild(container);

    // O clique no header alterna o accordion, mas não propaga para os botões internos
    state.accordionHeaderEl.addEventListener("click", function (e) {
      // Ignora cliques em botões dentro do header
      if (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
      e.preventDefault();
      toggleAccordion();
    }, true);

    setAccordionOpen(state.accordionOpen);
    syncHeaderButtons();
  }

  // ===================================================================
  // EDITOR — TOOLBAR E INICIALIZAÇÃO
  // ===================================================================

  function getOfficeIconSvg(iconName) {
    var icons = {
      run:       "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 5v14l11-7z'></path></svg>",
      selection: "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='5' y='4' width='14' height='16' rx='2'></rect><path d='M8 8h8M8 12h6M8 16h8'></path></svg>",
      block:     "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='16' height='16' rx='2'></rect><path d='M8 8h8M8 12h8M8 16h5'></path></svg>",
      clear:     "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M3 6h18'></path><path d='M8 6V4h8v2'></path><path d='M7 10v10h10V10'></path><path d='m10 13 4 4M14 13l-4 4'></path></svg>",
      lint:      "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3 22 20H2z'></path><path d='M12 9v5'></path><path d='M12 17h.01'></path></svg>",
      import:    "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path><path d='M14 2v6h6'></path><path d='M12 18V10'></path><path d='m8 14 4-4 4 4'></path></svg>",
      export:    "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path><path d='M14 2v6h6'></path><path d='M12 10v8'></path><path d='m8 14 4 4 4-4'></path></svg>",
      snippets:  "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='m10 8-4 4 4 4'></path><path d='m14 8 4 4-4 4'></path><path d='m13 4-2 16'></path></svg>",
      settings:  "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'></path><path d='M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.36.45.62.6 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z'></path></svg>",
      copy:      "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='8' y='7' width='11' height='13' rx='2'></rect><path d='M5 16V6a2 2 0 0 1 2-2h8'></path></svg>",
      download:  "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3v12'></path><path d='m7 10 5 5 5-5'></path><path d='M5 21h14'></path></svg>",
      layout:    "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='16' height='16' rx='2'></rect><path d='M4 10h16M10 4v16'></path></svg>"
    };
    return icons[iconName] || icons.copy;
  }

  function setButtonLabel(button, label) {
    var labelEl = button.querySelector(".sql-btn-label");
    if (labelEl) labelEl.textContent = label;
    else button.textContent = label;
    button.title = label;
  }

  /** Cria um botão com ícone para a toolbar do editor. */
  function createInputButton(label, iconName) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sql-icon-btn";
    if (iconName) b.classList.add("sql-icon-" + iconName);

    var icon = document.createElement("span");
    icon.className = "sql-btn-icon";
    icon.innerHTML = getOfficeIconSvg(iconName);

    var text = document.createElement("span");
    text.className = "sql-btn-label";

    b.appendChild(icon);
    b.appendChild(text);
    setButtonLabel(b, label);
    return b;
  }

  /** Cria um separador visual para a toolbar. */
  function createSeparator() {
    var sep = document.createElement("span");
    sep.className = "tm-sep";
    sep.textContent = "|";
    return sep;
  }

  function createRibbonGroup(title, items) {
    var group = document.createElement("div");
    group.className = "sql-ribbon-group";
    group.setAttribute("data-title", title);
    items.forEach(function (el) { group.appendChild(el); });
    return group;
  }

  function createSelect(options, value) {
    var sel = document.createElement("select");
    sel.innerHTML = options.map(function (opt) {
      return "<option value='" + opt.value + "'>" + opt.label + "</option>";
    }).join("");
    sel.value = String(value);
    return sel;
  }

  function createSettingRow(labelText, control) {
    var row = document.createElement("div");
    row.className = "tm-setting-row";
    if (control && control.type === "checkbox") row.classList.add("tm-toggle");
    var label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(control);
    return row;
  }

  function createSettingsCard(title, rows, hint, extraClass) {
    var card = document.createElement("section");
    card.className = "tm-settings-card";
    if (extraClass) card.classList.add(extraClass);
    var h = document.createElement("h3");
    h.textContent = title;
    card.appendChild(h);
    if (hint) {
      var p = document.createElement("div");
      p.className = "hint";
      p.textContent = hint;
      card.appendChild(p);
    }
    rows.forEach(function (row) { card.appendChild(row); });
    return card;
  }

  function createSettingsGroup(rows, className) {
    var group = document.createElement("div");
    if (className) group.className = className;
    rows.forEach(function (row) { group.appendChild(row); });
    return group;
  }

  function createSettingsSubgroup(title, rows) {
    var group = document.createElement("section");
    group.className = "tm-settings-subgroup";
    var h = document.createElement("h4");
    h.textContent = title;
    group.appendChild(h);
    group.appendChild(createSettingsGroup(rows, "tm-toggle-grid"));
    return group;
  }

  function syncRibbonControls() {
    if (state.ribbonThemeSelect) state.ribbonThemeSelect.value = state.themeMode;
    if (state.ribbonWarnSelect) state.ribbonWarnSelect.value = String(getExecWarnThresholdSeconds());
    if (state.ribbonFallbackSelect) state.ribbonFallbackSelect.value = String(getExecFallbackTimeoutSeconds());
    if (state.btnRibbonLint) setButtonLabel(state.btnRibbonLint, state.lintEnabled ? "Lint: ON" : "Lint: OFF");
    if (state.btnRibbonCollapse) setButtonLabel(state.btnRibbonCollapse, getAutoCollapseQueryAfterExec() ? "Ocultar: ON" : "Ocultar: OFF");
    applyRibbonDisplaySettings();
  }

  function setLintEnabled(enabled) {
    state.lintEnabled = !!enabled;
    storage.set(KEYS.lint, state.lintEnabled ? "on" : "off");
    if (!state.lintEnabled) {
      if (state.lintInfoEl) state.lintInfoEl.textContent = "";
      clearLintMarkers();
    } else {
      scheduleLint();
    }
    syncRibbonControls();
  }

  function applyTheme() {
    if (!state.editorContainerEl) return;

    // Remove todas as classes de tema antes de aplicar a nova
    THEMES.forEach(function (t) { state.editorContainerEl.classList.remove(t.containerClass); });

    var def = getThemeDef(state.themeMode);
    if (def.cm) ensureThemeCssLoaded(def.cm);
    state.editorContainerEl.classList.add(def.containerClass);

    if (state.sqlEditor) {
      state.sqlEditor.setOption("theme", def.cm || "default");
      setTimeout(function () { try { state.sqlEditor.refresh(); } catch (_) {} }, 0);
    }
  }

  // ===================================================================
  // LINT SQL
  // ===================================================================
  function lintSql(text) {
    if (!state.lintEnabled || !text) return { messages: [], markers: [] };

    var messages = [];
    var markers  = [];
    var lines    = text.split(/\r?\n/);

    function lineFromIndex(index) {
      return text.slice(0, index).split(/\r?\n/).length - 1;
    }

    function addMarker(lineIndex, message) {
      if (lineIndex >= 0 && lineIndex < lines.length) {
        markers.push({ line: lineIndex, message: message });
      }
    }

    // Verifica parênteses desequilibrados
    var openCount  = (text.match(/\(/g) || []).length;
    var closeCount = (text.match(/\)/g) || []).length;
    if (openCount !== closeCount) {
      messages.push("Parênteses desequilibrados.");
      lines.forEach(function (line, i) {
        if (line.indexOf("(") >= 0 || line.indexOf(")") >= 0) {
          addMarker(i, "Parênteses possivelmente desequilibrados.");
        }
      });
    }

    // Verifica SELECT sem FROM
    if (/SELECT/i.test(text) && !/FROM/i.test(text)) {
      messages.push("SELECT sem FROM.");
      var idxSel = text.toUpperCase().indexOf("SELECT");
      if (idxSel >= 0) addMarker(lineFromIndex(idxSel), "SELECT sem FROM.");
    }

    // Verifica JOIN sem ON
    var joinRegex = /\bJOIN\b([\s\S]*?)(?=\bJOIN\b|\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|\bUNION\b|;|$)/gi;
    var mj;
    while ((mj = joinRegex.exec(text)) !== null) {
      if (!/\bON\b/i.test(mj[0])) {
        var msg = "JOIN sem ON.";
        messages.push(msg);
        addMarker(lineFromIndex(mj.index), msg);
      }
    }

    // Deduplica mensagens mantendo a ordem de aparição
    var seen = {};
    var uniq = messages.filter(function (m) {
      if (seen[m]) return false;
      seen[m] = true;
      return true;
    });

    return { messages: uniq, markers: markers };
  }

  function clearLintMarkers() {
    if (!state.sqlEditor || !state.lintMarkers.length) return;
    state.lintMarkers.forEach(function (line) {
      state.sqlEditor.setGutterMarker(line, "sql-lint-gutter", null);
    });
    state.lintMarkers = [];
  }

  function applyLintMarkers(markers) {
    if (!state.sqlEditor) return;
    clearLintMarkers();

    var used = {};
    markers.forEach(function (m) {
      if (used[m.line]) return;
      used[m.line] = true;

      var el = document.createElement("div");
      el.textContent = "●";
      el.title = m.message;
      Object.assign(el.style, { color: "#ff5555", fontSize: "10px", cursor: "pointer" });
      state.sqlEditor.setGutterMarker(m.line, "sql-lint-gutter", el);
    });

    state.lintMarkers = Object.keys(used).map(Number);
  }

  function scheduleLint() {
    if (!state.sqlEditor || !state.lintInfoEl || !state.lintEnabled) return;
    clearTimeout(state.lintTimeout);
    state.lintTimeout = setTimeout(function () {
      if (!state.sqlEditor || !state.lintEnabled) return;
      var res = lintSql(state.sqlEditor.getDoc().getValue());
      state.lintInfoEl.textContent = res.messages.join(" | ");
      applyLintMarkers(res.markers);
    }, 300);
  }

  function updateStats() {
    if (!state.sqlEditor || !state.editorStatsEl) return;
    var doc        = state.sqlEditor.getDoc();
    var totalLines = doc.lineCount();
    var totalChars = doc.getValue().length;
    var cursor     = doc.getCursor();

    storage.setJson(KEYS.cursor, cursor);

    var text = "Linhas: " + totalLines +
               " | Caracteres: " + totalChars +
               " | Ln " + (cursor.line + 1) + ", Col " + cursor.ch;
    if (state.lastExecElapsed   != null) text += " | Última execução: "         + state.lastExecElapsed.toFixed(3)   + "s";
    if (state.lastExecInterval  != null) text += " | Desde o último Executar: " + state.lastExecInterval.toFixed(3)  + "s";
    var historySummary = getExecHistorySummary();
    if (historySummary) text += " | " + historySummary;
    state.editorStatsEl.textContent = text;

    if (!state.lintInfoEl) return;
    if (!state.lintEnabled) {
      state.lintInfoEl.textContent = "";
      clearLintMarkers();
      return;
    }
    scheduleLint();
  }

  // ===================================================================
  // REDIMENSIONAMENTO DO EDITOR
  // ===================================================================
  function persistEditorSize(width, height) {
    storage.setJson(KEYS.size, { width: width, height: height });
  }

  function setupResizeHandlesForEditor() {
    if (!state.editorContainerEl) return;
    var cmWrapper = state.editorContainerEl.querySelector(".CodeMirror");
    if (!cmWrapper) return;
    var scroll = cmWrapper.querySelector(".CodeMirror-scroll");
    cmWrapper.style.position = "relative";

    // Restaura tamanho salvo
    var saved = storage.getJson(KEYS.size);
    if (saved) {
      if (saved.width)  cmWrapper.style.width  = saved.width  + "px";
      if (saved.height) {
        cmWrapper.style.height = saved.height + "px";
        if (scroll) scroll.style.height = saved.height + "px";
      }
    }

    if (cmWrapper.querySelector(".cm-resize-handle")) return;

    var vHandle = document.createElement("div");
    var hHandle = document.createElement("div");
    var dHandle = document.createElement("div");
    vHandle.className = "cm-resize-handle";
    hHandle.className = "cm-resize-handle-x";
    dHandle.className = "cm-resize-handle-diag";
    cmWrapper.appendChild(vHandle);
    cmWrapper.appendChild(hHandle);
    cmWrapper.appendChild(dHandle);

    var resizingV = false, resizingH = false;
    var startY = 0, startH = 0, startX = 0, startW = 0;

    function claimEditorResize(e) {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "editor") return false;
      window.__tmActiveResizeSurface = "editor";
      document.body.style.userSelect = "none";
      if (e) {
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.preventDefault();
      }
      return true;
    }

    function startVertical(e) {
      if (!claimEditorResize(e)) return;
      resizingV = true; startY = e.clientY; startH = cmWrapper.offsetHeight;
    }
    function startHorizontal(e) {
      if (!claimEditorResize(e)) return;
      resizingH = true; startX = e.clientX; startW = cmWrapper.offsetWidth;
    }

    vHandle.addEventListener("mousedown", startVertical, true);
    hHandle.addEventListener("mousedown", startHorizontal, true);
    dHandle.addEventListener("mousedown", function (e) {
      if (!claimEditorResize(e)) return;
      resizingV = true; startY = e.clientY; startH = cmWrapper.offsetHeight;
      resizingH = true; startX = e.clientX; startW = cmWrapper.offsetWidth;
    }, true);

    window.addEventListener("mousemove", function (e) {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "editor") return;
      if (!resizingV && !resizingH) return;
      if (resizingV) {
        var newH = Math.max(150, Math.min(window.innerHeight * 0.9, startH + (e.clientY - startY)));
        cmWrapper.style.height = newH + "px";
        if (scroll) scroll.style.height = newH + "px";
      }
      if (resizingH) {
        var newW = Math.max(350, Math.min(window.innerWidth * 0.95, startW + (e.clientX - startX)));
        cmWrapper.style.width = newW + "px";
      }
      if (state.sqlEditor) state.sqlEditor.refresh();
      persistEditorSize(cmWrapper.offsetWidth, cmWrapper.offsetHeight);
      e.preventDefault();
    }, true);

    window.addEventListener("mouseup", function () {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "editor") return;
      if (!resizingV && !resizingH) return;
      resizingV = false; resizingH = false;
      if (window.__tmActiveResizeSurface === "editor") window.__tmActiveResizeSurface = null;
      document.body.style.userSelect = "";
      persistEditorSize(cmWrapper.offsetWidth, cmWrapper.offsetHeight);
    }, true);
  }

  // ===================================================================
  // BOTÃO EXECUTAR
  // ===================================================================
  function findExecuteButton() {
    return PageAdapter.getExecuteButton();
  }

  function removeSemicolonsFromSql(text) {
    return String(text || "").replace(/;/g, "");
  }

  function captureEditorSnapshotForExecution() {
    if (!state.modalIsOpen || !state.sqlEditor) {
      state.execEditorSnapshot = null;
      return;
    }

    try {
      var doc = state.sqlEditor.getDoc();
      var scroll = state.sqlEditor.getScrollInfo();
      var partial = state.restoreAfterExec;
      state.execEditorSnapshot = {
        text: partial ? partial.original : doc.getValue(),
        cursor: partial ? partial.cursor : doc.getCursor(),
        selections: partial ? [{ anchor: partial.sel.from, head: partial.sel.to }] : (doc.listSelections ? doc.listSelections() : null),
        scrollLeft: scroll.left,
        scrollTop: scroll.top
      };
      saveExecutionDraft(state.execEditorSnapshot);
    } catch (_) {
      state.execEditorSnapshot = null;
    }
  }

  function restoreEditorSnapshotAfterExecution() {
    var snapshot = state.execEditorSnapshot;
    state.execEditorSnapshot = null;
    if (!snapshot || !state.sqlEditor) return false;

    try {
      var doc = state.sqlEditor.getDoc();
      if (doc.getValue() !== snapshot.text) doc.setValue(snapshot.text);
      if (snapshot.selections && doc.setSelections) {
        doc.setSelections(snapshot.selections);
      } else if (snapshot.cursor) {
        doc.setCursor(snapshot.cursor);
      }
      state.sqlEditor.save();
      state.sqlEditor.refresh();
      state.sqlEditor.scrollTo(snapshot.scrollLeft || 0, snapshot.scrollTop || 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  function keepModalEditorContentVisible() {
    var snapshot = state.execEditorSnapshot;
    if (!state.modalIsOpen || !snapshot || !state.sqlEditor) return;
    try {
      var doc = state.sqlEditor.getDoc();
      if (!doc.getValue() && snapshot.text) {
        doc.setValue(snapshot.text);
        if (snapshot.selections && doc.setSelections) doc.setSelections(snapshot.selections);
        state.sqlEditor.refresh();
        state.sqlEditor.scrollTo(snapshot.scrollLeft || 0, snapshot.scrollTop || 0);
      }
    } catch (_) {}
  }

  function prepareQueryForExecution() {
    var changed = false;
    var semicolonRemoved = false;
    var overrideText = state.execOverrideText;
    var hasOverride = overrideText !== null && overrideText !== undefined;
    var overrideSanitized = hasOverride ? removeSemicolonsFromSql(overrideText) : null;

    if (state.sqlEditor) {
      try {
        var doc = state.sqlEditor.getDoc();
        var editorText = doc.getValue();
        var editorSanitized = hasOverride ? overrideSanitized : removeSemicolonsFromSql(editorText);
        if (editorSanitized !== editorText) {
          var cursor = doc.getCursor();
          var selFrom = doc.getCursor("from");
          var selTo = doc.getCursor("to");
          doc.setValue(editorSanitized);
          if (hasOverride) {
            var lastLine = Math.max(doc.lineCount() - 1, 0);
            doc.setCursor({ line: lastLine, ch: (doc.getLine(lastLine) || "").length });
          } else {
            doc.setCursor(cursor);
            doc.setSelection(selFrom, selTo);
          }
          changed = true;
          semicolonRemoved = hasOverride ? (overrideSanitized !== String(overrideText || "")) : true;
        }
        state.sqlEditor.save();
      } catch (_) {}
    }

    var ta = PageAdapter.getTextarea();
    if (!ta) return;

    var original = ta.value || "";
    var source = hasOverride ? overrideText : original;
    var sanitized = hasOverride ? overrideSanitized : removeSemicolonsFromSql(source);
    if (sanitized !== String(source || "")) {
      semicolonRemoved = true;
    }
    if (sanitized !== original) {
      ta.value = sanitized;
      try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
      try { ta.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
      changed = true;
    }

    if (changed && semicolonRemoved) {
      showToast("Ponto e vírgula removido antes da execução");
    }
  }

  function triggerExecuteButton() {
    prepareQueryForExecution();
    var btn = findExecuteButton();
    if (!btn) {
      alert("Botão Executar não encontrado.");
      state.execOverrideText = null;
      return false;
    }
    btn.click();
    if (state.restoreAfterExec) {
      if (state.partialRestoreTimer) clearTimeout(state.partialRestoreTimer);
      state.partialRestoreTimer = setTimeout(function () {
        state.partialRestoreTimer = null;
        restoreEditorAfterPartialExec("Selecao enviada (editor restaurado)");
      }, 150);
    } else {
      state.execOverrideText = null;
    }
    return true;
  }

  // ===================================================================
  // SELEÇÃO DE BLOCO SQL
  // ===================================================================
  function setEditorValueFromExternal(text) {
    var value = String(text || "");
    if (state.sqlEditor) {
      try {
        var doc = state.sqlEditor.getDoc();
        doc.setValue(value);
        var lastLine = Math.max(doc.lineCount() - 1, 0);
        var lastCh = (doc.getLine(lastLine) || "").length;
        doc.setCursor({ line: lastLine, ch: lastCh });
        state.sqlEditor.save();
        state.sqlEditor.focus();
        updateStats();
        return true;
      } catch (_) {}
    }

    var ta = PageAdapter.getTextarea();
    if (!ta) return false;
    ta.value = value;
    try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
    try { ta.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
    try { ta.focus(); } catch (_) {}
    return true;
  }

  window.__SQL_EDITOR_QUERY_API__ = {
    setValue: setEditorValueFromExternal,
    execute: triggerExecuteButton,
    setValueAndExecute: function (text) {
      if (!setEditorValueFromExternal(text)) return false;
      return triggerExecuteButton();
    },
    getValue: function () {
      if (state.sqlEditor) {
        try { return state.sqlEditor.getDoc().getValue(); } catch (_) {}
      }
      var ta = PageAdapter.getTextarea();
      return ta ? (ta.value || "") : "";
    }
  };

  function selectSqlBlockHeuristic() {
    if (!state.sqlEditor) return;
    var doc   = state.sqlEditor.getDoc();
    var text  = doc.getValue();
    if (!text.trim()) return;

    var cur   = doc.getCursor();
    var lines = text.split(/\r?\n/);
    var i     = cur.line;

    // Expande para cima até encontrar uma linha vazia
    var start = i;
    while (start > 0 && String(lines[start]).trim() !== "") start--;
    if (String(lines[start]).trim() === "") start++;

    // Expande para baixo até encontrar uma linha vazia
    var end = i;
    while (end < lines.length - 1 && String(lines[end]).trim() !== "") end++;
    if (String(lines[end]).trim() === "") end--;

    doc.setSelection({ line: start, ch: 0 }, { line: end, ch: (lines[end] || "").length });
    showToast("Bloco selecionado");
  }

  // ===================================================================
  // CRIAÇÃO DA TOOLBAR E INICIALIZAÇÃO DO EDITOR
  // ===================================================================
  function createToolbar(textarea) {
    var container = textarea.parentElement;
    state.editorContainerEl = container;
    container.classList.add("sql-editor-container-pro");

    ensureQueryAccordion(container);

    state.toolbarEl = document.createElement("div");
    state.toolbarEl.className = "sql-toolbar";
    state.toolbarEl.classList.toggle("hidden", !state.toolbarVisible);

    var btnExec        = createInputButton("Executar Query", "run");
    var btnExecSel     = createInputButton("Executar Seleção", "selection");
    var btnSelectBlock = createInputButton("Selecionar Bloco", "block");
    var btnClear       = createInputButton("Limpar", "clear");
    var btnToggleLint  = createInputButton(state.lintEnabled ? "Lint: ON" : "Lint: OFF", "lint");
    var btnImportSql   = createInputButton("Importar .sql", "import");
    var btnExportSql   = createInputButton("Exportar .sql", "export");
    var btnSnippets    = createInputButton("Snippets", "snippets");
    var btnAutoCollapse = createInputButton(getAutoCollapseQueryAfterExec() ? "Ocultar: ON" : "Ocultar: OFF", "block");
    var btnSettings    = createInputButton("Config", "settings");
    state.btnRibbonLint = btnToggleLint;
    state.btnRibbonCollapse = btnAutoCollapse;

    var themeSelect = document.createElement("select");
    themeSelect.innerHTML = THEMES.map(function (t) {
      return "<option value='" + t.id + "'>" + t.label + "</option>";
    }).join("");
    themeSelect.value = state.themeMode;
    state.ribbonThemeSelect = themeSelect;

    var warnSelect = createSelect([
      { value: 5,   label: "Alerta: 5s" },
      { value: 10,  label: "Alerta: 10s" },
      { value: 15,  label: "Alerta: 15s" },
      { value: 30,  label: "Alerta: 30s" },
      { value: 60,  label: "Alerta: 60s" },
      { value: 120, label: "Alerta: 120s" }
    ], getExecWarnThresholdSeconds());
    state.ribbonWarnSelect = warnSelect;

    var fallbackSelect = createSelect([
      { value: 0,   label: "Restaurar: OFF" },
      { value: 30,  label: "Restaurar: 30s" },
      { value: 60,  label: "Restaurar: 60s" },
      { value: 120, label: "Restaurar: 120s" },
      { value: 300, label: "Restaurar: 5min" }
    ], getExecFallbackTimeoutSeconds());
    state.ribbonFallbackSelect = fallbackSelect;
    state.ribbonControls = {
      exec: btnExec,
      execSel: btnExecSel,
      selectBlock: btnSelectBlock,
      timerWarn: warnSelect,
      timerRestore: fallbackSelect,
      autoCollapse: btnAutoCollapse,
      clear: btnClear,
      importSql: btnImportSql,
      exportSql: btnExportSql,
      snippets: btnSnippets,
      lint: btnToggleLint,
      theme: themeSelect,
      settings: btnSettings
    };

    [
      createRibbonGroup("Executar", [btnExec, btnExecSel, btnSelectBlock]),
      createRibbonGroup("Timer", [warnSelect, fallbackSelect, btnAutoCollapse]),
      createRibbonGroup("Editar", [btnClear, btnImportSql, btnExportSql, btnSnippets]),
      createRibbonGroup("Revisão", [btnToggleLint]),
      createRibbonGroup("Tema", [themeSelect]),
      createRibbonGroup("Config", [btnSettings])
    ].forEach(function (el) { state.toolbarEl.appendChild(el); });

    if (state.accordionRootEl && state.accordionBodyEl) {
      state.accordionRootEl.insertBefore(state.toolbarEl, state.accordionBodyEl);
    } else {
      container.insertBefore(state.toolbarEl, container.firstChild);
    }
    applyRibbonDisplaySettings();

    // Eventos da toolbar
    btnExec.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      triggerExecuteButton();
    }, true);

    btnExecSel.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!state.sqlEditor) return;
      var doc = state.sqlEditor.getDoc();
      var sel = doc.getSelection();
      if (!sel || !sel.trim()) return alert("Selecione um trecho antes.");

      // Salva o estado completo do editor para restauração após execução
      state.restoreAfterExec = {
        original: doc.getValue(),
        cursor:   doc.getCursor(),
        sel:      { from: doc.getCursor("from"), to: doc.getCursor("to") }
      };
      state.execOverrideText = sel;
      if (!triggerExecuteButton()) {
        restoreEditorAfterPartialExec("Falha ao executar seleção (editor restaurado)");
      }
    }, true);

    btnSelectBlock.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      selectSqlBlockHeuristic();
    }, true);

    btnClear.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!state.sqlEditor) return;
      if (!confirm("Limpar editor?")) return;
      state.sqlEditor.getDoc().setValue("");
      state.sqlEditor.focus();
      var ta = PageAdapter.getTextarea();
      if (ta) ta.value = "";
      try { state.sqlEditor.save(); } catch (_) {}
      showToast("Editor limpo");
    }, true);

    btnToggleLint.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      setLintEnabled(!state.lintEnabled);
    }, true);

    btnImportSql.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".sql,application/sql,text/sql,text/plain";
      input.style.display = "none";
      input.addEventListener("change", function () {
        importQueryFromSqlFile(input.files && input.files[0]);
        if (input.parentNode) input.parentNode.removeChild(input);
      }, true);
      document.body.appendChild(input);
      input.click();
    }, true);

    btnExportSql.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      exportQueryAsSql();
    }, true);

    btnSnippets.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      openSnippets();
    }, true);

    warnSelect.addEventListener("change", function () {
      storage.set(KEYS.execWarn, warnSelect.value);
      showToast("Alerta do timer: " + warnSelect.value + "s");
    }, true);

    fallbackSelect.addEventListener("change", function () {
      storage.set(KEYS.execFallback, fallbackSelect.value);
      showToast(fallbackSelect.value === "0" ? "Restauração automática: OFF" : "Restauração automática: " + fallbackSelect.value + "s");
    }, true);

    btnAutoCollapse.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var next = !getAutoCollapseQueryAfterExec();
      storage.set(KEYS.execCollapse, next ? "on" : "off");
      setButtonLabel(btnAutoCollapse, next ? "Ocultar: ON" : "Ocultar: OFF");
      showToast(next ? "Ocultar query após executar: ON" : "Ocultar query após executar: OFF");
    }, true);

    btnSettings.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      openSettingsPanel();
    }, true);

    themeSelect.addEventListener("change", function () {
      state.themeMode = themeSelect.value;
      storage.set(KEYS.theme, state.themeMode);
      applyTheme();
      showToast("Tema aplicado");
    }, true);

    state.editorStatsEl = document.createElement("div");
    state.editorStatsEl.className = "sql-editor-stats";
    container.appendChild(state.editorStatsEl);

    state.lintInfoEl = document.createElement("div");
    state.lintInfoEl.className = "sql-lint-warning";
    container.appendChild(state.lintInfoEl);
  }

  function initEditor(textarea) {
    if (state.editorInited) return;
    state.editorInited = true;

    var execDraft = consumeExecutionDraft();
    if (execDraft && !(textarea.value || "").trim() && execDraft.text) {
      textarea.value = execDraft.text;
    }

    createToolbar(textarea);

    var def = getThemeDef(state.themeMode);
    if (def.cm) ensureThemeCssLoaded(def.cm);

    state.sqlEditor = CodeMirror.fromTextArea(textarea, {
      mode:              "text/x-sql",
      lineNumbers:       true,
      lineWrapping:      true,
      indentUnit:        4,
      smartIndent:       true,
      autoCloseBrackets: true,
      foldGutter:        true,
      gutters:           ["CodeMirror-linenumbers", "CodeMirror-foldgutter", "sql-lint-gutter"],
      theme:             def.cm || "default",
      extraKeys: {
        "Ctrl-Enter": triggerExecuteButton,
        "Ctrl-S":     function (cm) { try { cm.save(); } catch (_) {} },
        "Ctrl-Space": function (cm) { return showSqlAutocomplete(cm); },
        "Ctrl-Alt-S": function () { openSnippets(); },
        "Tab":        function (cm) { return snippetTab(cm, false); },
        "Shift-Tab":  function (cm) { return snippetTab(cm, true); }
      }
    });

    state.sqlEditor.on("change", updateStats);
    state.sqlEditor.on("cursorActivity", updateStats);
    state.sqlEditor.on("inputRead", function (cm, change) {
      if (change && change.text && change.text.length === 1 && change.text[0] === ".") {
        setTimeout(function () { showSqlAutocomplete(cm); }, 0);
      }
    });

    if (execDraft) {
      try {
        var draftDoc = state.sqlEditor.getDoc();
        if (execDraft.selections && draftDoc.setSelections) {
          draftDoc.setSelections(execDraft.selections);
        } else if (execDraft.cursor) {
          draftDoc.setCursor(execDraft.cursor);
        }
        setTimeout(function () {
          try {
            state.sqlEditor.refresh();
            state.sqlEditor.scrollTo(execDraft.scrollLeft || 0, execDraft.scrollTop || 0);
          } catch (_) {}
        }, 0);
      } catch (_) {}
    }

    applyTheme();
    setupResizeHandlesForEditor();
    updateStats();

    ensureModal();
    if ((storage.get(KEYS.modalOpen) || "off") === "on") {
      setTimeout(function () { try { openModal(); } catch (_) {} }, 200);
    }

    showToast("Editor SQL Pro carregado");
  }

  // ===================================================================
  // CAIXA DE EXECUÇÃO (EXEC BOX)
  // ===================================================================
  function applyExecToastOptions() {
    if (!state.execBox) return;

    var classes = state.execBox.className.split(/\s+/).filter(function (c) {
      return c &&
        c.indexOf("sql-pos-") !== 0 &&
        c.indexOf("sql-toast-") !== 0 &&
        c.indexOf("sql-size-") !== 0 &&
        c !== "sql-hide-detail" &&
        c !== "sql-hide-progress";
    });

    classes.push("sql-pos-" + getExecToastPosition());
    classes.push("sql-toast-" + getExecToastTheme());
    classes.push("sql-size-" + getExecToastSize());
    if (!getExecToastDetailsVisible()) classes.push("sql-hide-detail");
    if (!getExecToastProgressVisible()) classes.push("sql-hide-progress");
    state.execBox.className = classes.join(" ");
  }

  function createExecBox() {
    state.execBox = document.createElement("div");
    state.execBox.className = "sql-exec-box";
    state.execBox.style.display = "none";

    state.execMain   = document.createElement("div");
    state.execMain.className = "sql-exec-main";

    state.execDetail = document.createElement("div");
    state.execDetail.className = "sql-exec-detail";

    state.execCloseBtn = document.createElement("button");
    state.execCloseBtn.type = "button";
    state.execCloseBtn.className = "sql-exec-close";
    state.execCloseBtn.textContent = "x";
    state.execCloseBtn.title = "Fechar aviso de execucao";
    state.execCloseBtn.addEventListener("click", function () {
      if (state.execHideTimer) { clearTimeout(state.execHideTimer); state.execHideTimer = null; }
      if (state.execBox) state.execBox.style.display = "none";
    }, true);

    var progress = document.createElement("div");
    progress.className = "sql-exec-progress";
    state.execProgressEl = progress;

    state.execProgressBar = document.createElement("div");
    state.execProgressBar.className = "sql-exec-progress-bar";

    progress.appendChild(state.execProgressBar);
    state.execBox.appendChild(state.execCloseBtn);
    state.execBox.appendChild(state.execMain);
    state.execBox.appendChild(state.execDetail);
    state.execBox.appendChild(progress);
    document.body.appendChild(state.execBox);
    applyExecToastOptions();
  }

  function startExecBox() {
    if (!state.execBox) createExecBox();
    applyExecToastOptions();
    if (state.execHideTimer) { clearTimeout(state.execHideTimer); state.execHideTimer = null; }
    state.execBox.style.display = "block";
    applyExecTimeClass(0);
    state.execMain.textContent = "Executando... 0.000s";
    state.execDetail.textContent = getExecHistorySummary();
    state.execProgressBar.style.animationPlayState = "running";
    state.execProgressBar.style.width = "40%";

    if (state.execIntervalId) clearInterval(state.execIntervalId);
    state.execIntervalId = setInterval(function () {
      if (!state.lastExecStart) return;
      var elapsed = (performance.now() - state.lastExecStart) / 1000;
      var warnAfter = getExecWarnThresholdSeconds();
      state.execMain.textContent = "Executando... " + elapsed.toFixed(3) + "s";
      applyExecTimeClass(elapsed);
      if (elapsed >= warnAfter) {
        state.execBox.classList.add("sql-exec-box-persistent");
        state.execDetail.textContent = "Execucao longa: acima de " + warnAfter + "s" + (getExecHistorySummary() ? " | " + getExecHistorySummary() : "");
      }
    }, 100);
  }

  function stopExecBox(elapsedSeconds) {
    if (!state.execBox) return;
    if (state.execIntervalId) { clearInterval(state.execIntervalId); state.execIntervalId = null; }

    state.execMain.textContent = "Execucao concluida em " + elapsedSeconds.toFixed(3) + "s";

    var detailParts = [];
    var warnAfter = getExecWarnThresholdSeconds();
    var history = recordExecDuration(elapsedSeconds);
    if (state.lastExecInterval != null) detailParts.push("Tempo desde o ultimo Executar: " + state.lastExecInterval.toFixed(3) + "s");
    applyExecTimeClass(elapsedSeconds);
    if (elapsedSeconds >= warnAfter) {
      detailParts.push("Execucao longa: > " + warnAfter + "s");
      state.execBox.classList.add("sql-exec-box-persistent");
    }
    detailParts.push(getExecHistorySummary(history));
    state.execDetail.textContent = detailParts.join(" | ");

    state.execProgressBar.style.animationPlayState = "paused";
    state.execProgressBar.style.transform = "translateX(0)";
    state.execProgressBar.style.width = "100%";

    if (elapsedSeconds >= warnAfter) return;
    var hideSeconds = getExecToastHideSeconds();
    if (hideSeconds === 0) return;
    var hideDelay = hideSeconds * 1000;
    state.execHideTimer = setTimeout(function () {
      if (!state.execBox) return;
      state.execBox.style.display = "none";
      state.execProgressBar.style.animationPlayState = "running";
      state.execProgressBar.style.width = "40%";
      state.execProgressBar.style.transform = "";
      state.execHideTimer = null;
    }, hideDelay);
  }

  function restoreEditorAfterPartialExec(message) {
    if (!state.restoreAfterExec || !state.sqlEditor) return false;

    var st = state.restoreAfterExec;
    state.restoreAfterExec = null;
    state.execOverrideText = null;
    if (state.partialRestoreTimer) {
      clearTimeout(state.partialRestoreTimer);
      state.partialRestoreTimer = null;
    }

    try {
      var doc = state.sqlEditor.getDoc();
      doc.setValue(st.original);
      doc.setCursor(st.cursor);
      doc.setSelection(st.sel.from, st.sel.to);
      state.sqlEditor.save();
      showToast(message || "Seleção executada (editor restaurado)");
      return true;
    } catch (_) {
      return false;
    }
  }

  function refreshResultUiAfterExec() {
    if (state.accordionMetaEl) {
      state.accordionMetaEl.textContent =
        (state.accordionOpen ? "Expandido" : "Oculto") + " • última execução " + nowTime();
    }

    if (getAutoCollapseQueryAfterExec() && !state.modalIsOpen) {
      try { setAccordionOpen(false); } catch (_) {}
    }
  }

  function finishExecution() {
    if (!state.lastExecStart) return;

    if (state.execFallbackTimer) {
      clearTimeout(state.execFallbackTimer);
      state.execFallbackTimer = null;
    }

    var elapsed = (performance.now() - state.lastExecStart) / 1000;
    state.lastExecElapsed = elapsed;
    stopExecBox(elapsed);
    updateStats();
    state.lastExecStart = null;

    restoreEditorAfterPartialExec();
    restoreEditorSnapshotAfterExecution();
    refreshResultUiAfterExec();
  }

  // ===================================================================
  // TIMER DE EXECUÇÃO
  // ===================================================================
  function attachExecutionTimer() {
    var btn = findExecuteButton();
    if (btn && !btn.dataset.tmExecHook) {
      btn.dataset.tmExecHook = "1";
      btn.addEventListener("click", function () {
        prepareQueryForExecution();
        captureEditorSnapshotForExecution();

        var now = performance.now();
        state.lastExecInterval = (state.lastExecStart !== null) ? (now - state.lastExecStart) / 1000 : null;
        state.lastExecStart    = now;
        startExecBox();
        setTimeout(keepModalEditorContentVisible, 0);
        setTimeout(keepModalEditorContentVisible, 100);

        if (state.execFallbackTimer) clearTimeout(state.execFallbackTimer);
        state.execFallbackTimer = null;
        var fallbackSeconds = getExecFallbackTimeoutSeconds();
        if (fallbackSeconds > 0) {
          state.execFallbackTimer = setTimeout(function () {
            restoreEditorAfterPartialExec("Tempo limite atingido (editor restaurado)");
            restoreEditorSnapshotAfterExecution();
            state.execFallbackTimer = null;
          }, fallbackSeconds * 1000);
        }
      }, true);
    }

  }

  // ===================================================================
  // CARREGADOR DO CODEMIRROR
  // ===================================================================
  function loadCodeMirror(callback) {
    if (state.cmReady) return callback();
    state.cmCallbacks.push(callback);
    if (state.cmLoading) return;
    state.cmLoading = true;

    function flushCallbacks() {
      state.cmReady = true;
      state.cmLoading = false;
      var callbacks = state.cmCallbacks.splice(0);
      callbacks.forEach(function (cb) {
        try { cb(); } catch (_) {}
      });
    }

    function ensureBaseCss() {
      loadCssOnce("tm-cm-core-css", "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.css");
      loadCssOnce("tm-cm-fold-css", "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/foldgutter.min.css");
      loadCssOnce("tm-cm-hint-css", "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.css");
    }

    function loadCssOnce(id, href) {
      if (document.getElementById(id)) return;
      var css = document.createElement("link");
      css.id   = id;
      css.rel  = "stylesheet";
      css.href = href;
      document.head.appendChild(css);
    }

    function loadScriptOnce(id, src, onLoad) {
      var existing = document.getElementById(id);
      if (existing) {
        existing.addEventListener("load", onLoad, { once: true });
        if (existing.dataset.tmLoaded === "1") setTimeout(onLoad, 0);
        return;
      }

      var s = document.createElement("script");
      s.id  = id;
      s.src = src;
      s.addEventListener("load", function () {
        s.dataset.tmLoaded = "1";
        onLoad();
      }, { once: true });
      s.addEventListener("error", function () {
        state.cmLoading = false;
        state.cmCallbacks = [];
        if (s.parentNode) s.parentNode.removeChild(s);
        alert("Falha ao carregar dependência do CodeMirror: " + src);
      }, { once: true });
      document.head.appendChild(s);
    }

    function loadScriptsSequential(scripts, done) {
      var idx = 0;
      function next() {
        if (idx >= scripts.length) return done();
        var item = scripts[idx++];
        loadScriptOnce(item.id, item.src, next);
      }
      next();
    }

    ensureBaseCss();

    // No Chrome/Tampermonkey, os @require acima carregam o CodeMirror antes do userscript.
    // O carregamento dinâmico abaixo fica como fallback para outros gerenciadores.
    if (typeof CodeMirror !== "undefined") {
      if (!CodeMirror.showHint) {
        loadScriptOnce("tm-cm-showhint-js", "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.js", flushCallbacks);
        return;
      }
      flushCallbacks();
      return;
    }

    loadScriptsSequential([
      { id: "tm-cm-core-js",          src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.js" },
      { id: "tm-cm-sql-js",           src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/mode/sql/sql.min.js" },
      { id: "tm-cm-closebrackets-js", src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/edit/closebrackets.min.js" },
      { id: "tm-cm-foldcode-js",      src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/foldcode.min.js" },
      { id: "tm-cm-foldgutter-js",    src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/foldgutter.min.js" },
      { id: "tm-cm-bracefold-js",     src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/brace-fold.min.js" },
      { id: "tm-cm-commentfold-js",   src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/comment-fold.min.js" },
      { id: "tm-cm-showhint-js",      src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.js" }
    ], flushCallbacks);
  }

  // ===================================================================
  // HOOK ASP.NET AJAX (endRequest)
  // ===================================================================
  function hookAspNetEndRequest() {
    if (state.aspnetHooked) return;

    try {
      var prm = window.Sys &&
                window.Sys.WebForms &&
                window.Sys.WebForms.PageRequestManager
                  ? window.Sys.WebForms.PageRequestManager.getInstance()
                  : null;

      if (!prm || prm._tmHookedUnified) return;
      prm._tmHookedUnified = true;
      state.aspnetHooked = true;

      prm.add_endRequest(function () {
        finishExecution();
      });
    } catch (_) {}
  }

  // ===================================================================
  // INICIALIZAÇÃO PRINCIPAL
  // ===================================================================
  function start() {
    if (state.startInProgress) return;
    ensureDefaultSchemaCatalog();
    injectCSSOnce();
    hookAspNetEndRequest();

    state.startInProgress = true;
    loadCodeMirror(function () {
      state.startInProgress = false;
      var textarea = PageAdapter.getTextarea();
      if (textarea && !state.sqlEditor) initEditor(textarea);

      setToolbarVisible(state.toolbarVisible);
      attachExecutionTimer();
      ensureModal();
      syncHeaderButtons();
    });
  }

  // Tenta inicializar imediatamente; se os elementos ainda não existirem,
  // usa um MutationObserver para aguardar o DOM estar pronto.
  start();

  // Fallback com polling para páginas com carregamento lento
  var initAttempts = 0;
  var initTimer = setInterval(function () {
    initAttempts++;
    var hasEditor = !!state.sqlEditor;
    if (hasEditor) {
      clearInterval(initTimer);
      return;
    }
    if (initAttempts > 90) {
      clearInterval(initTimer);
      return;
    }
    start();
  }, 400);

})();

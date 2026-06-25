// ==UserScript==
// @name         Editor de Query
// @namespace    http://tampermonkey.net/
// @version      2026.06.25.04
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
    execProgressEl:     null,
    execProgressBar:    null,
    execIntervalId:     null,
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
      ".sql-toolbar input[type='button'],.sql-toolbar button,.sql-toolbar select{height:23px !important;min-height:0 !important;padding:2px 7px !important;font-size:12px !important;line-height:16px !important;cursor:pointer;border-radius:6px;border:1px solid #b7c5d8;background:linear-gradient(#fff,#f7fbff);color:#20385f;}",
      ".sql-toolbar input[type='button']:hover,.sql-toolbar button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}",
      ".sql-toolbar select{min-width:128px;}",
      ".sql-icon-btn{display:inline-flex;align-items:center;gap:4px;color:#20385f;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);white-space:nowrap;}",
      ".sql-icon-btn .sql-btn-icon{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex:0 0 15px;border-radius:4px;background:linear-gradient(135deg,#f7fbff,#dcecff);}",
      ".sql-icon-btn .sql-btn-icon svg{width:13px;height:13px;display:block;stroke:#185abd;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}",
      ".sql-toolbar.sql-hide-icons .sql-btn-icon{display:none !important;}",
      ".sql-icon-btn.sql-icon-run .sql-btn-icon{background:linear-gradient(135deg,#e8f5e9,#c8e6c9);}",
      ".sql-icon-btn.sql-icon-run .sql-btn-icon svg{stroke:#107c10;fill:#107c10;}",
      ".sql-icon-btn.sql-icon-clear .sql-btn-icon{background:linear-gradient(135deg,#fff4ce,#fde7a9);}",
      ".sql-icon-btn.sql-icon-clear .sql-btn-icon svg{stroke:#ca5010;}",
      ".sql-icon-btn.sql-icon-export .sql-btn-icon{background:linear-gradient(135deg,#e6f4ea,#c7ead2);}",
      ".sql-icon-btn.sql-icon-export .sql-btn-icon svg{stroke:#217346;}",
      ".sql-icon-btn.sql-icon-lint .sql-btn-icon{background:linear-gradient(135deg,#f3f2f1,#e1dfdd);}",
      ".sql-icon-btn.sql-icon-lint .sql-btn-icon svg{stroke:#5c2d91;}",
      ".sql-icon-btn.sql-icon-copy .sql-btn-icon{background:linear-gradient(135deg,#eef6ff,#d7e8ff);}",
      ".sql-icon-btn.sql-icon-copy .sql-btn-icon svg{stroke:#0078d4;}",
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
      ".tm-toggle-grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:2px 14px;}",
      ".tm-toggle-grid .tm-setting-row{margin:4px 0;}",
      ".tm-settings-ft{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border-top:1px solid #d6e0eb;background:#f8fbff;}",
      "@media(max-width:820px){.tm-settings-bd{grid-template-columns:1fr;}.tm-settings-card.tm-wide{grid-column:auto;}.tm-toggle-grid{grid-template-columns:1fr;}}",
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
      ".sql-exec-box-warn{background:rgba(160,90,0,.95);}",
      ".sql-exec-box-warn.sql-toast-light{background:#fff7e6;border-color:#d99a31;color:#6b3d00;}",
      ".sql-exec-box-warn.sql-toast-office{background:linear-gradient(#fff7e6,#ffe9bf);border-color:#d99a31;color:#6b3d00;}",
      ".sql-exec-main{font-weight:700;margin-bottom:4px;}",
      ".sql-exec-detail{font-size:11px;opacity:.9;margin-bottom:4px;line-height:1.35;}",
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
    state.modalOverlayEl.className = "tm-modal-ov";
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
    var ribbonRows = [createSettingRow("Mostrar ícones", iconsCheck)];
    RIBBON_ITEMS.forEach(function (item) {
      var chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = visibleMap[item.key];
      chk.addEventListener("change", function () {
        setRibbonItemVisible(item.key, chk.checked);
      }, true);
      ribbonRows.push(createSettingRow(item.label, chk));
    });

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

    body.appendChild(createSettingsCard("Editor", [
      createSettingRow("Tema", themeSelect),
      createSettingRow("Mostrar toolbar", toolbarCheck),
      createSettingRow("Lint SQL", lintCheck)
    ], "Preferências gerais do editor SQL."));

    body.appendChild(createSettingsCard(
      "Barra",
      [createSettingsGroup(ribbonRows, "tm-toggle-grid")],
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
      run:       "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M5 3.5v9l7-4.5z'></path></svg>",
      selection: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='3' y='3' width='10' height='10' rx='1.5'></rect><path d='M6 6h4M6 8h3M6 10h4'></path></svg>",
      block:     "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M4 3.5h8M4 6h8M4 8.5h8M4 11h5'></path><rect x='2.5' y='2.5' width='11' height='11' rx='1.5'></rect></svg>",
      clear:     "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M5.5 5.5l5 5M10.5 5.5l-5 5'></path><path d='M3 4h10M6 4V2.8h4V4M5 6v6h6V6'></path></svg>",
      lint:      "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 2.5l5.5 9.5h-11z'></path><path d='M8 6v3M8 11.5h.01'></path></svg>",
      import:    "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M4 2.5h5l3 3v8H4z'></path><path d='M9 2.5v3h3M8 11V7M6.5 8.5L8 7l1.5 1.5M6 11h4'></path></svg>",
      export:    "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M4 2.5h5l3 3v8H4z'></path><path d='M9 2.5v3h3M6 10.5h4M8 7v4M6.5 9.5L8 11l1.5-1.5'></path></svg>",
      snippets:  "<svg viewBox='0 0 16 16'><path d='M3 3h10v3H3zM3 8h10v5H3z'></path></svg>",
      settings:  "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'></path><path d='M8 2.5v1.3M8 12.2v1.3M3.2 5.2l1.1.7M11.7 10.1l1.1.7M3.2 10.8l1.1-.7M11.7 5.9l1.1-.7'></path></svg>",
      copy:      "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='5' y='4' width='8' height='9' rx='1'></rect><path d='M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10'></path></svg>"
    };
    return icons[iconName] || "";
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
        "Ctrl-Alt-S": function () { openSnippets(); },
        "Tab":        function (cm) { return snippetTab(cm, false); },
        "Shift-Tab":  function (cm) { return snippetTab(cm, true); }
      }
    });

    state.sqlEditor.on("change", updateStats);
    state.sqlEditor.on("cursorActivity", updateStats);

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

    var progress = document.createElement("div");
    progress.className = "sql-exec-progress";
    state.execProgressEl = progress;

    state.execProgressBar = document.createElement("div");
    state.execProgressBar.className = "sql-exec-progress-bar";

    progress.appendChild(state.execProgressBar);
    state.execBox.appendChild(state.execMain);
    state.execBox.appendChild(state.execDetail);
    state.execBox.appendChild(progress);
    document.body.appendChild(state.execBox);
    applyExecToastOptions();
  }

  function startExecBox() {
    if (!state.execBox) createExecBox();
    applyExecToastOptions();
    state.execBox.style.display = "block";
    state.execBox.classList.remove("sql-exec-box-warn");
    state.execMain.textContent = "Executando... 0.000s";
    state.execDetail.textContent = "";
    state.execProgressBar.style.animationPlayState = "running";
    state.execProgressBar.style.width = "40%";

    if (state.execIntervalId) clearInterval(state.execIntervalId);
    state.execIntervalId = setInterval(function () {
      if (!state.lastExecStart) return;
      var elapsed = (performance.now() - state.lastExecStart) / 1000;
      var warnAfter = getExecWarnThresholdSeconds();
      state.execMain.textContent = "Executando... " + elapsed.toFixed(3) + "s";
      if (elapsed >= warnAfter) state.execBox.classList.add("sql-exec-box-warn");
    }, 100);
  }

  function stopExecBox(elapsedSeconds) {
    if (!state.execBox) return;
    if (state.execIntervalId) { clearInterval(state.execIntervalId); state.execIntervalId = null; }

    state.execMain.textContent = "Execução concluída em " + elapsedSeconds.toFixed(3) + "s";

    var detailParts = [];
    var warnAfter = getExecWarnThresholdSeconds();
    if (state.lastExecInterval != null) detailParts.push("Tempo desde o último Executar: " + state.lastExecInterval.toFixed(3) + "s");
    if (elapsedSeconds >= warnAfter) {
      state.execBox.classList.add("sql-exec-box-warn");
      detailParts.push("Atenção: execução > " + warnAfter + "s");
    }
    state.execDetail.textContent = detailParts.join(" | ");

    state.execProgressBar.style.animationPlayState = "paused";
    state.execProgressBar.style.transform = "translateX(0)";
    state.execProgressBar.style.width = "100%";

    var hideSeconds = getExecToastHideSeconds();
    if (hideSeconds === 0) return;
    var hideDelay = hideSeconds * 1000;
    setTimeout(function () {
      if (!state.execBox) return;
      state.execBox.style.display = "none";
      state.execProgressBar.style.animationPlayState = "running";
      state.execProgressBar.style.width = "40%";
      state.execProgressBar.style.transform = "";
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
      { id: "tm-cm-commentfold-js",   src: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/fold/comment-fold.min.js" }
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

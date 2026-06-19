// ==UserScript==
// @name         Editor de Query
// @namespace    http://tampermonkey.net/
// @version      2026-06-19.01
// @description  Editor SQL Pro. Accordion para ocultar/mostrar query + Export .sql + temas + painel de configurações.
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
    snippetStops:       [],
    snippetStopIndex:   -1,
    snippetEndMark:     null,
    // Restauração de seleção após execução parcial
    restoreAfterExec:   null,
    execOverrideText:   null,
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
  var NATIVE_SNIPPETS = [
    ["SELECT b\u00e1sico","Consultas","SELECT\n    ${COLUNAS:*}\nFROM ${TABELA}\nWHERE ${CONDICAO:1 = 1}${CURSOR}"],
    ["SELECT DISTINCT","Consultas","SELECT DISTINCT\n    ${COLUNAS:*}\nFROM ${TABELA}\nWHERE ${CONDICAO:1 = 1}${CURSOR}"],
    ["CTE / WITH","Consultas","WITH ${CTE:base} AS (SELECT ${COLUNAS:*} FROM ${TABELA})\nSELECT * FROM ${CTE_USO:base}${CURSOR}"],
    ["INNER JOIN","Jun\u00e7\u00f5es","SELECT ${COLUNAS:a.*, b.*}\nFROM ${TABELA_A} a\nINNER JOIN ${TABELA_B} b ON b.${CHAVE_B} = a.${CHAVE_A}${CURSOR}"],
    ["LEFT JOIN","Jun\u00e7\u00f5es","SELECT ${COLUNAS:a.*, b.*}\nFROM ${TABELA_A} a\nLEFT JOIN ${TABELA_B} b ON b.${CHAVE_B} = a.${CHAVE_A}${CURSOR}"],
    ["Filtro IN","Filtros","${SELECAO:WHERE} ${COLUNA} IN (${VALORES:1, 2, 3})${CURSOR}"],
    ["Filtro BETWEEN","Filtros","${SELECAO:WHERE} ${COLUNA} BETWEEN ${INICIO} AND ${FIM}${CURSOR}"],
    ["Filtro EXISTS","Filtros","${SELECAO:WHERE} EXISTS (SELECT 1 FROM ${TABELA} WHERE ${CONDICAO})${CURSOR}"],
    ["GROUP BY / HAVING","Agrupamento","SELECT ${COLUNA}, COUNT(*) quantidade\nFROM ${TABELA}\nGROUP BY ${COLUNA}\nHAVING COUNT(*) > ${VALOR:1}${CURSOR}"],
    ["INSERT","Manipula\u00e7\u00e3o","INSERT INTO ${TABELA} (${COLUNAS}) VALUES (${VALORES})${CURSOR}"],
    ["UPDATE seguro","Manipula\u00e7\u00e3o","UPDATE ${TABELA}\nSET ${COLUNA} = ${VALOR}\nWHERE ${CONDICAO_CHAVE}${CURSOR}"],
    ["DELETE seguro","Manipula\u00e7\u00e3o","DELETE FROM ${TABELA}\nWHERE ${CONDICAO_CHAVE}${CURSOR}"],
    ["MERGE","Manipula\u00e7\u00e3o","MERGE INTO ${DESTINO} d USING ${ORIGEM} o ON (d.${CHAVE}=o.${CHAVE})\nWHEN MATCHED THEN UPDATE SET d.${COLUNA}=o.${COLUNA}${CURSOR}"],
    ["Localizar duplicidades","Diagn\u00f3stico","SELECT ${COLUNA}, COUNT(*) quantidade FROM ${TABELA} GROUP BY ${COLUNA} HAVING COUNT(*) > 1${CURSOR}"],
    ["Contar valores nulos","Diagn\u00f3stico","SELECT COUNT(*) quantidade_nulos FROM ${TABELA} WHERE ${COLUNA} IS NULL${CURSOR}"]
  ].map(function(x,i){return{id:"native_"+i,name:x[0],category:x[1],body:x[2],native:true};});
  function customSnippets(){var x=storage.getJson(KEYS.customSnippets);return Array.isArray(x)?x:[];}
  function favorites(){var x=storage.getJson(KEYS.snippetFavorites);return Array.isArray(x)?x:[];}
  function allSnippets(){return NATIVE_SNIPPETS.concat(customSnippets());}
  function clearSnippetStops(){state.snippetStops.forEach(function(x){try{x.clear();}catch(_){}});state.snippetStops=[];state.snippetStopIndex=-1;if(state.snippetEndMark){try{state.snippetEndMark.clear();}catch(_){}state.snippetEndMark=null;}}
  function parseSnippet(body,selection){var out="",stops=[],end=null,last=0,re=/\$\{([A-Z0-9_]+)(?::([^}]*))?\}/gi,m;while((m=re.exec(body))){out+=body.slice(last,m.index);var n=m[1].toUpperCase(),v=m[2]!==undefined?m[2]:n;if(n==="SELECAO")v=selection||v;if(n==="CURSOR"){end=out.length;v="";}var a=out.length;out+=v;if(n!=="CURSOR"&&v)stops.push([a,out.length]);last=re.lastIndex;}out+=body.slice(last);return{text:out,stops:stops,end:end===null?out.length:end};}
  function selectSnippetStop(i){if(!state.snippetStops.length)return false;i=Math.max(0,Math.min(i,state.snippetStops.length-1));var f=state.snippetStops[i].find();if(!f)return false;state.snippetStopIndex=i;state.sqlEditor.getDoc().setSelection(f.from,f.to);return true;}
  function snippetTab(cm,back){if(!state.snippetStops.length)return CodeMirror.Pass;var n=state.snippetStopIndex+(back?-1:1);if(n<0)n=0;if(n>=state.snippetStops.length){var p=state.snippetEndMark&&state.snippetEndMark.find();clearSnippetStops();if(p)cm.getDoc().setCursor(p);return;}selectSnippetStop(n);}
  function insertSnippet(x){clearSnippetStops();var d=state.sqlEditor.getDoc(),f=d.getCursor("from"),t=d.getCursor("to"),r=parseSnippet(x.body,d.getSelection()),base=d.indexFromPos(f);state.sqlEditor.operation(function(){d.replaceRange(r.text,f,t,"+snippet");r.stops.forEach(function(q){state.snippetStops.push(d.markText(d.posFromIndex(base+q[0]),d.posFromIndex(base+q[1]),{className:"sql-snippet-placeholder",inclusiveLeft:true,inclusiveRight:true}));});state.snippetEndMark=d.setBookmark(d.posFromIndex(base+r.end));});closeSnippets();if(!selectSnippetStop(0)){var p=state.snippetEndMark.find();clearSnippetStops();if(p)d.setCursor(p);}state.sqlEditor.focus();}
  function editSnippet(x){var sel=state.sqlEditor.getDoc().getSelection(),name=prompt("Nome do snippet:",x?x.name:"");if(name===null||!name.trim())return;var cat=prompt("Categoria:",x?x.category:"Personalizados");if(cat===null)return;var body=prompt("C\u00f3digo SQL (use ${CAMPO:valor}):",x?x.body:(sel||"SELECT * FROM ${TABELA}${CURSOR}"));if(body===null||!body.trim())return;var list=customSnippets(),item={id:x?x.id:"custom_"+Date.now(),name:name.trim(),category:cat.trim()||"Personalizados",body:body,native:false},i=list.findIndex(function(a){return a.id===item.id;});if(i>=0)list[i]=item;else list.push(item);storage.setJson(KEYS.customSnippets,list);openSnippets();}
  function deleteSnippet(x){if(confirm("Excluir '"+x.name+"'?")){storage.setJson(KEYS.customSnippets,customSnippets().filter(function(a){return a.id!==x.id;}));openSnippets();}}
  function toggleFavorite(id){var x=favorites(),i=x.indexOf(id);if(i>=0)x.splice(i,1);else x.push(id);storage.setJson(KEYS.snippetFavorites,x);openSnippets();}
  function exportSnippets(){var b=new Blob([JSON.stringify({snippets:customSnippets(),favorites:favorites()},null,2)],{type:"application/json"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="editor-query-snippets.json";a.click();URL.revokeObjectURL(u);}
  function importSnippets(file){if(!file)return;var r=new FileReader();r.onload=function(){try{var j=JSON.parse(r.result),x=Array.isArray(j)?j:j.snippets;if(!Array.isArray(x))throw 0;storage.setJson(KEYS.customSnippets,x.map(function(a,i){return{id:"custom_"+Date.now()+"_"+i,name:String(a.name||"Snippet"),category:String(a.category||"Personalizados"),body:String(a.body||""),native:false};}).filter(function(a){return a.body;}));openSnippets();}catch(_){alert("JSON inv\u00e1lido.");}};r.readAsText(file,"UTF-8");}
  function closeSnippets(){if(state.snippetsOverlayEl)state.snippetsOverlayEl.remove();state.snippetsOverlayEl=null;}
  function openSnippets(){closeSnippets();var ov=document.createElement("div");ov.className="tm-modal-ov";var w=document.createElement("div");w.className="tm-snippets-win";var h=document.createElement("div");h.className="tm-snippets-head";h.innerHTML="<strong>Snippets SQL</strong>";var acts=document.createElement("div"),search=document.createElement("input"),cat=document.createElement("select"),fav=document.createElement("input"),list=document.createElement("div"),file=document.createElement("input");search.type="search";search.placeholder="Buscar";fav.type="checkbox";file.type="file";file.accept=".json";file.style.display="none";list.className="tm-snippets-list";function btn(t,fn){var b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=fn;return b;}file.onchange=function(){importSnippets(file.files[0]);};acts.append(btn("Novo",function(){editSnippet(null);}));acts.append(btn("Importar",function(){file.click();}));acts.append(btn("Exportar",exportSnippets));acts.append(btn("Fechar",closeSnippets));acts.append(file);h.append(acts);var tools=document.createElement("div");tools.className="tm-snippets-tools";var fl=document.createElement("label");fl.append(fav,document.createTextNode(" Favoritos"));tools.append(search,cat,fl);function render(){var all=allSnippets(),fs=favorites(),cs=["Todas"];all.forEach(function(x){if(cs.indexOf(x.category)<0)cs.push(x.category);});var old=cat.value||"Todas";cat.innerHTML="";cs.forEach(function(x){var o=document.createElement("option");o.value=x;o.textContent=x;cat.append(o);});cat.value=cs.indexOf(old)>=0?old:"Todas";list.innerHTML="";var q=search.value.toLowerCase();all.filter(function(x){return(cat.value==="Todas"||x.category===cat.value)&&(!fav.checked||fs.indexOf(x.id)>=0)&&(!q||(x.name+x.category+x.body).toLowerCase().indexOf(q)>=0);}).forEach(function(x){var c=document.createElement("article"),pre=document.createElement("pre"),bar=document.createElement("div"),title=document.createElement("strong");c.className="tm-snippet-card";title.textContent=x.name+" - "+x.category;pre.textContent=x.body;bar.append(btn(fs.indexOf(x.id)>=0?"?":"?",function(){toggleFavorite(x.id);}));bar.append(btn(state.sqlEditor.getDoc().somethingSelected()?"Substituir sele\u00e7\u00e3o":"Inserir",function(){insertSnippet(x);}));if(!x.native){bar.append(btn("Editar",function(){editSnippet(x);}));bar.append(btn("Excluir",function(){deleteSnippet(x);}));}c.append(title,pre,bar);list.append(c);});}search.oninput=render;cat.onchange=render;fav.onchange=render;ov.onmousedown=function(e){if(e.target===ov)closeSnippets();};w.append(h,tools,list);ov.append(w);var form=PageAdapter.getTextarea().closest("form");(form||document.body).append(ov);state.snippetsOverlayEl=ov;render();search.focus();}

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
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
      ".tm-snippets-win{width:min(1000px,94vw);height:min(740px,88vh);background:#f8fbff;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;}.tm-snippets-head{display:flex;justify-content:space-between;padding:10px;background:#eaf1f9;}.tm-snippets-head>div{display:flex;gap:5px;}.tm-snippets-tools{display:grid;grid-template-columns:1fr 200px auto;gap:8px;padding:9px;background:#fff;}.tm-snippets-list{padding:10px;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:8px;}.tm-snippet-card{background:#fff;border:1px solid #d6e0eb;border-radius:6px;padding:8px;display:grid;gap:6px;}.tm-snippet-card pre{margin:0;max-height:130px;overflow:auto;background:#f7f9fc;padding:6px;font:11px Consolas,monospace;}.tm-snippet-card>div{display:flex;justify-content:flex-end;gap:5px;}.sql-snippet-placeholder{background:#fff2a8;border-bottom:1px solid #d19a00;}@media(max-width:760px){.tm-snippets-list{grid-template-columns:1fr}.tm-snippets-tools{grid-template-columns:1fr}}",
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
    btnSnippets.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openSnippets(); }, true);

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
      state.execEditorSnapshot = {
        text: doc.getValue(),
        cursor: doc.getCursor(),
        selections: doc.listSelections ? doc.listSelections() : null,
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

    if (state.sqlEditor) {
      try {
        var doc = state.sqlEditor.getDoc();
        var editorText = doc.getValue();
        var editorSanitized = removeSemicolonsFromSql(editorText);
        if (editorSanitized !== editorText) {
          var cursor = doc.getCursor();
          var selFrom = doc.getCursor("from");
          var selTo = doc.getCursor("to");
          doc.setValue(editorSanitized);
          doc.setCursor(cursor);
          doc.setSelection(selFrom, selTo);
          changed = true;
          semicolonRemoved = true;
        }
        state.sqlEditor.save();
      } catch (_) {}
    }

    var ta = PageAdapter.getTextarea();
    if (!ta) return;

    var original = ta.value || "";
    var source = (overrideText !== null && overrideText !== undefined) ? overrideText : original;
    var sanitized = removeSemicolonsFromSql(source);
    if (sanitized !== String(source || "")) {
      semicolonRemoved = true;
    }
    if (sanitized !== original) {
      ta.value = sanitized;
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
    state.execOverrideText = null;
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
        original: removeSemicolonsFromSql(doc.getValue()),
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

// ==UserScript==
// @name         Resultado Personalizado
// @namespace    http://tampermonkey.net/
// @version      2026-06-25.01
// @description  Jornada "Resultado Personalizado": Grid em acordeon, filtros, seleção, copiar grid/tabela/célula/coluna/linha e exportar CSV/HTML/TXT/XLSX/JPG.
// @compatible   edge
// @match        http://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @match        https://10.200.35.7/portal/Simples/ExecucaoDireta.aspx
// @match        http://10.200.35.7/*
// @match        https://10.200.35.7/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/resultado-personalizado.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/resultado-personalizado.user.js
// @grant        none
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// ==/UserScript==

(function () {
  "use strict";

  // ===================================================================
  // CONFIG
  // ===================================================================
  var GRID_HEIGHT_DEFAULT = 420;
  var GRID_MIN_HEIGHT = 200;
  var GRID_MAX_HEIGHT_VH = 82;
  var CONFIG_SCHEMA_VERSION = 2;

  var COPY_AS_TABLE = true;
  var COPY_PAD_EXTRA = 0;
  var COPY_SEPARATOR_DEFAULT = "|";

  var TABLE_SEPARATOR = "\t";
  var CSV_SEPARATOR_DEFAULT = ";";

  var UI_FONT_FAMILY = "Arial, sans-serif";
  var UI_FONT_SIZE_PX = 12;

  // ===================================================================
  // STORAGE KEYS
  // ===================================================================
  var KEY_BASE = String(location.host) + String(location.pathname);
  var GRID_SHELL_KEY_SIZE_LEGACY = "tm:gridShell:size_v1:" + KEY_BASE;
  var GRID_SHELL_KEY_SIZE = "tm:resultGrid:size_v2:" + KEY_BASE;
  var ACC_STATE_KEY = "tm:acc:result_open_v1:" + KEY_BASE;
  var HIDDEN_COLS_KEY = "tm:grid:hidden_cols_v1:" + KEY_BASE;
  var CONFIG_KEY = "tm:grid:config_v1:" + KEY_BASE;
  var COLUMN_RENAME_KEY = "tm:grid:rename_cols_v1:" + KEY_BASE;

  // ===================================================================
  // STATE
  // ===================================================================
  var selectedCell = null;
  var selectedRowEl = null;
  var selectedColIndex = null;

  var actionBarEl = null;
  var summaryPanelEl = null;
  var contextMenuEl = null;
  var accordionEl = null;
  var accHeaderEl = null;
  var accBodyEl = null;
  var btnHeaderToolbar = null;

  var cssInjected = false;
  var aspnetHooked = false;
  var userConfig = null;
  var startScheduled = false;
  var summaryRefreshTimer = null;

  var StorageService = {
    get: function (key) {
      try { return localStorage.getItem(key); } catch (_) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
    },
    remove: function (key) {
      try { localStorage.removeItem(key); return true; } catch (_) { return false; }
    },
    getJson: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    setJson: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    }
  };

  var SessionState = {
    clearColumnRenames: function () {
      var tables = document.querySelectorAll("#divScroll table");
      for (var i = 0; i < tables.length; i++) {
        tables[i].__tmColumnRenameMap = {};
      }
    },
    getColumnRenameMap: function (table) {
      if (!table) return {};
      if (!table.__tmColumnRenameMap) table.__tmColumnRenameMap = {};
      return table.__tmColumnRenameMap;
    },
    setColumnRenameMap: function (table, map) {
      if (table) table.__tmColumnRenameMap = map || {};
    }
  };

  var PageAdapter = {
    getResultScroll: function () {
      return document.getElementById("divScroll");
    },
    getResultTable: function () {
      var divScroll = this.getResultScroll();
      return divScroll ? divScroll.querySelector("table") : null;
    },
    hasResultArea: function () {
      return !!this.getResultScroll();
    }
  };

  // ===================================================================
  // UTIL
  // ===================================================================
  function getToastConfig() {
    var scale = userConfig && userConfig.toastScale ? Number(userConfig.toastScale) : 1.6;
    if (!isFinite(scale) || scale <= 0) scale = 1.6;
    var durationMs = userConfig && userConfig.toastDurationMs ? Number(userConfig.toastDurationMs) : 2500;
    if (!isFinite(durationMs) || durationMs < 800) durationMs = 2500;
    return { scale: scale, durationMs: durationMs };
  }

  function ensureToastElement() {
    var toastEl = document.querySelector(".sql-toast");
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.className = "sql-toast";
    toastEl.style.position = "fixed";
    toastEl.style.bottom = "16px";
    toastEl.style.right = "16px";
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateY(8px)";
    toastEl.style.transition = "all 0.2s ease-out";
    toastEl.style.zIndex = "999999";
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function applyToastVisual(toastEl, cfg) {
    toastEl.style.background = "linear-gradient(180deg, rgba(37, 60, 108, 0.98), rgba(28, 45, 82, 0.98))";
    toastEl.style.color = "#f5f8ff";
    toastEl.style.padding = Math.round(12 * cfg.scale) + "px " + Math.round(18 * cfg.scale) + "px";
    toastEl.style.borderRadius = "10px";
    toastEl.style.border = "1px solid rgba(130, 170, 255, 0.55)";
    toastEl.style.boxShadow = "0 12px 30px rgba(7, 16, 39, 0.45)";
    toastEl.style.fontSize = Math.round((UI_FONT_SIZE_PX + 3) * cfg.scale) + "px";
    toastEl.style.fontWeight = "700";
    toastEl.style.fontFamily = UI_FONT_FAMILY;
  }

  function showToast(message) {
    if (userConfig && !userConfig.showToasts) return;
    var cfg = getToastConfig();
    var toastEl = ensureToastElement();
    applyToastVisual(toastEl, cfg);
    toastEl.textContent = message;

    window.requestAnimationFrame(function () {
      toastEl.style.opacity = "1";
      toastEl.style.transform = "translateY(0)";
    });

    window.setTimeout(function () {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translateY(8px)";
    }, cfg.durationMs);
  }

  function reliableCopy(text, done) {
    if (location.protocol === "https:") {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            done(true);
          }).catch(function () { execCopy(); });
          return;
        }
      } catch (_) {}
    }
    execCopy();

    function execCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        ta.parentNode.removeChild(ta);
        done(!!ok);
      } catch (_) {
        done(false);
      }
    }
  }

  function downloadBlob(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    if (navigator.msSaveOrOpenBlob) {
      navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function tsStamp() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return String(d.getFullYear())
      + pad(d.getMonth() + 1) + pad(d.getDate())
      + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getText(el) {
    return el ? String(el.textContent || el.innerText || "") : "";
  }

  function scheduleSummaryRefresh() {
    if (summaryRefreshTimer) window.clearTimeout(summaryRefreshTimer);
    summaryRefreshTimer = window.setTimeout(function () {
      summaryRefreshTimer = null;
      refreshSummaryPanel();
    }, 180);
  }

  function scheduleStart() {
    if (startScheduled) return;
    startScheduled = true;
    var raf = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16); };
    raf(function () {
      startScheduled = false;
      start();
    });
  }

  function normalizeHeaderText(s) {
    if (!s) return "";
    var t = String(s).trim().toLowerCase();
    try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
    return t;
  }

  function isSequenciaColumn(headerText) {
    var t = normalizeHeaderText(headerText);
    return (
      t.indexOf("sequenc") >= 0 ||
      /^seq$/.test(t) ||
      t.indexOf("seq_") === 0 ||
      t.indexOf("_seq") >= 0 ||
      t.indexOf("nr_seq") >= 0 ||
      t.indexOf("numero_sequencia") >= 0 ||
      t.indexOf("nr_sequencia") >= 0
    );
  }

  function extractDateOnlyPtBr(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var m = s.match(/^(\d{2}\/\d{2}\/\d{4})/);
    if (m) return m[1];
    return s;
  }

  function applyTableFilters(table, filtRow) {
    var inputs = Array.prototype.slice.call(filtRow.querySelectorAll("input"));
    var vals = inputs.map(function (x) { return x.value.trim().toLowerCase(); });

    for (var r = 2; r < table.rows.length; r++) {
      var row = table.rows[r];
      var ok = true;
      for (var j = 0; j < vals.length; j++) {
        var v = vals[j];
        if (!v) continue;
        var cellText = getText(row.cells[j + 1]).toLowerCase();
        if (cellText.indexOf(v) === -1) { ok = false; break; }
      }
      row.style.display = ok ? "" : "none";
    }
    applyPinnedRows(table);
  }

  function addDateOnlyFromSelectedColumn(table, colIndex) {
    if (!table || !table.rows || !table.rows.length || colIndex == null || colIndex <= 0) return false;
    var headerRow = table.rows[0];
    var filtRow = table.rows[1];
    if (!headerRow || !headerRow.cells || colIndex >= headerRow.cells.length) return false;

    var selectedHeaderRaw = getText(headerRow.cells[colIndex]).trim();
    if (!selectedHeaderRaw) return false;
    var selectedHeaderNorm = normalizeHeaderText(selectedHeaderRaw);
    var newHeaderName = selectedHeaderRaw + "_data2";
    var newHeaderNorm = normalizeHeaderText(newHeaderName);

    // valida se a coluna selecionada parece conter data no padrão dd/mm/yyyy[ hh:mm:ss]
    var hasDateLike = false;
    for (var vr = 2; vr < table.rows.length; vr++) {
      var vrRow = table.rows[vr];
      if (!vrRow || vrRow.style.display === "none") continue;
      var vrCell = vrRow.cells[colIndex];
      var vrTxt = getText(vrCell).trim();
      if (!vrTxt) continue;
      if (/^\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}:\d{2})?$/.test(vrTxt)) {
        hasDateLike = true;
        break;
      }
    }
    if (!hasDateLike) return false;

    for (var hc = 0; hc < headerRow.cells.length; hc++) {
      var hn = normalizeHeaderText(getText(headerRow.cells[hc]));
      if (hn === newHeaderNorm || hn === selectedHeaderNorm + "_data2") return false;
    }

    for (var r = 0; r < table.rows.length; r++) {
      var row = table.rows[r];
      if (!row || !row.cells) continue;
      var newCell;
      if (r === 0) {
        newCell = document.createElement("th");
        newCell.textContent = newHeaderName;
      } else if (row.classList.contains("filter-row")) {
        newCell = document.createElement("td");
        var inp = document.createElement("input");
        inp.placeholder = "Filtrar...";
        inp.oninput = function () {
          applyTableFilters(table, filtRow);
          if (!userConfig || userConfig.autoRefreshInsightsOnFilter) scheduleSummaryRefresh();
        };
        newCell.appendChild(inp);
      } else {
        newCell = document.createElement("td");
        var src = row.cells[colIndex];
        var txt = getText(src);
        newCell.textContent = extractDateOnlyPtBr(txt);
      }

      var insertPos = colIndex + 1;
      if (insertPos >= row.cells.length) row.appendChild(newCell);
      else row.insertBefore(newCell, row.cells[insertPos]);
    }

    return true;
  }

  function getAccOpenDefault() {
    var v = StorageService.get(ACC_STATE_KEY);
    if (v === null) return true;
    return v === "1";
  }

  function setAccOpen(open) {
    StorageService.set(ACC_STATE_KEY, open ? "1" : "0");
  }

  function getHiddenColsSet() {
    var arr = StorageService.getJson(HIDDEN_COLS_KEY, []);
    var out = {};
    for (var i = 0; i < arr.length; i++) out[String(arr[i])] = true;
    return out;
  }

  function setHiddenColsSet(obj) {
    var arr = Object.keys(obj).filter(function (k) { return !!obj[k]; });
    StorageService.setJson(HIDDEN_COLS_KEY, arr);
  }

  function clearPersistedColumnRenames() {
    StorageService.remove(COLUMN_RENAME_KEY);
  }

  function getColumnRenameMap(table) {
    clearPersistedColumnRenames();
    return SessionState.getColumnRenameMap(table);
  }

  function setColumnRenameMap(table, map) {
    clearPersistedColumnRenames();
    SessionState.setColumnRenameMap(table, map);
  }

  function clearSessionColumnRenames() {
    clearPersistedColumnRenames();
    SessionState.clearColumnRenames();
  }

  function defaultConfig() {
    return {
      showInsights: true,
      showStatusInsights: true,
      enableShortcuts: true,
      copyAsTable: COPY_AS_TABLE,
      showToasts: true,
      showToolbarIcons: false,
      showToolbar: true,
      toastScale: 1.6,
      toastDurationMs: 2500,
      csvSeparator: CSV_SEPARATOR_DEFAULT,
      autoRefreshInsightsOnFilter: true,
      confirmReset: true,
      hiddenToolbarButtons: {
        exp_jpg: true,
        reset: true
      },
      schemaVersion: CONFIG_SCHEMA_VERSION
    };
  }

  function loadConfig() {
    var cfg = defaultConfig();
    var saved = StorageService.getJson(CONFIG_KEY, null);
    if (!saved) return cfg;
    Object.keys(cfg).forEach(function (k) {
      if (saved && typeof saved[k] !== "undefined") cfg[k] = saved[k];
    });
    cfg.schemaVersion = CONFIG_SCHEMA_VERSION;
    return cfg;
  }

  function saveConfig(cfg) {
    cfg.schemaVersion = CONFIG_SCHEMA_VERSION;
    StorageService.setJson(CONFIG_KEY, cfg);
  }

  function getCsvSeparator() {
    var allowed = {
      ";": true,
      ",": true,
      "\t": true,
      "|": true
    };
    var separator = userConfig && userConfig.csvSeparator;
    return allowed[separator] ? separator : CSV_SEPARATOR_DEFAULT;
  }

  function isToolbarButtonHidden(btnKey) {
    if (!userConfig || !userConfig.hiddenToolbarButtons) return false;
    return !!userConfig.hiddenToolbarButtons[btnKey];
  }

  function applyToolbarButtonVisibility() {
    if (!actionBarEl) {
      syncHeaderToolbarButton();
      return;
    }
    var showToolbar = !userConfig || userConfig.showToolbar !== false;
    actionBarEl.style.display = showToolbar ? "" : "none";
    syncHeaderToolbarButton();
    if (!showToolbar) return;
    actionBarEl.classList.toggle("tm-hide-icons", !!(userConfig && !userConfig.showToolbarIcons));
    var btns = actionBarEl.querySelectorAll("button[data-tm-btn]");
    for (var i = 0; i < btns.length; i++) {
      var key = btns[i].dataset.tmBtn;
      if (!key) continue;
      btns[i].style.display = isToolbarButtonHidden(key) ? "none" : "";
    }
    var groups = actionBarEl.querySelectorAll(".tm-group");
    for (var g = 0; g < groups.length; g++) {
      var visible = Array.prototype.some.call(groups[g].querySelectorAll("button[data-tm-btn]"), function (btn) {
        return btn.style.display !== "none";
      });
      groups[g].style.display = visible ? "" : "none";
    }
  }

  function syncHeaderToolbarButton() {
    if (!btnHeaderToolbar) return;
    var isOn = !userConfig || userConfig.showToolbar !== false;
    btnHeaderToolbar.textContent = isOn ? "Toolbar ON" : "Toolbar OFF";
    btnHeaderToolbar.title = isOn ? "Ocultar toolbar do resultado" : "Mostrar toolbar do resultado";
    btnHeaderToolbar.classList.toggle("tm-toolbar-off", !isOn);
  }

  function toggleResultToolbar() {
    if (!userConfig) userConfig = loadConfig();
    userConfig.showToolbar = userConfig.showToolbar === false;
    saveConfig(userConfig);
    applyToolbarButtonVisibility();
    showToast(userConfig.showToolbar ? "Toolbar do resultado: ON" : "Toolbar do resultado: OFF");
  }

  // ===================================================================
  // CSS
  // ===================================================================
  function injectCSSOnce() {
    if (cssInjected) return;
    cssInjected = true;

    var css = ""
      + ".tm-accordion,.tm-accordion *{font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;box-sizing:border-box;}\n"
      + ".tm-accordion{border:1px solid #cfdbe8;border-radius:8px;overflow:hidden;background:#fff;margin:6px 0 10px 0;box-shadow:0 1px 2px rgba(32,56,95,.08);}\n"
      + ".tm-acc-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 10px;background:linear-gradient(#f7fbff,#eef4fb);cursor:pointer;user-select:none;color:#20385f;}\n"
      + ".tm-acc-title{display:flex;align-items:center;gap:8px;font-weight:700;color:#20385f;min-width:240px;}\n"
      + ".tm-acc-chevron{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:20px !important;line-height:22px;opacity:.9;transition:transform .15s ease;color:#185abd;}\n"
      + ".tm-acc-status{display:inline-flex;align-items:center;padding:2px 7px;border:1px solid #b7c5d8;border-radius:999px;background:#fff;font-size:11px !important;font-weight:700;color:#40506a;}\n"
      + ".tm-acc-status.tm-hidden{color:#6b3d00;border-color:#d99a31;background:#fff7e6;}\n"
      + ".tm-acc-actions{display:flex;align-items:center;gap:6px;}\n"
      + ".tm-acc-actions button{font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid #b7c5d8;background:linear-gradient(#fff,#f7fbff);color:#20385f;cursor:pointer;}\n"
      + ".tm-acc-actions button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}\n"
      + ".tm-acc-actions button.tm-toolbar-off{color:#6b3d00;border-color:#d99a31;background:linear-gradient(#fff7e6,#fff);}\n"
      + ".tm-acc-body{padding:8px 8px 10px 8px;overflow:visible;}\n"
      + ".tm-acc-body.tm-collapsed{display:none;}\n"
      + ".tm-actionbar{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;overflow-x:auto;overflow-y:hidden;white-space:nowrap;margin:0 0 8px 0;padding:5px 7px;background:linear-gradient(#f8fbff,#eaf1f9);border-top:1px solid #d7e0eb;border-bottom:1px solid #cfdbe8;box-shadow:inset 0 1px 0 rgba(255,255,255,.8);}\n"
      + ".tm-actionbar .tm-group{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:0;padding:16px 6px 5px 6px;position:relative;border:1px solid #d6e0eb;border-radius:6px;background:linear-gradient(#ffffff,#f8fbff);box-shadow:inset 0 1px 0 rgba(255,255,255,.9);}\n"
      + ".tm-actionbar .tm-group::before{content:attr(data-title);position:absolute;left:7px;top:2px;font-size:10px !important;line-height:12px;font-weight:700;letter-spacing:.45px;color:#40506a;text-transform:uppercase;}\n"
      + ".tm-actionbar .tm-group-title{display:none;}\n"
      + ".tm-actionbar .tm-group-btns{display:flex;gap:5px;align-items:center;flex-wrap:wrap;white-space:nowrap;}\n"
      + ".tm-actionbar button,.tm-actionbar select{height:23px !important;min-height:0 !important;padding:2px 7px !important;font-size:12px !important;line-height:16px !important;cursor:pointer;border-radius:6px;border:1px solid #b7c5d8;background:linear-gradient(#fff,#f7fbff);color:#20385f;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);}\n"
      + ".tm-actionbar button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}\n"
      + ".tm-actionbar button:active{background:linear-gradient(#eaf3ff,#ffffff);}\n"
      + ".tm-actionbar button:focus-visible,.tm-actionbar select:focus-visible,.tm-cfg-modal button:focus-visible,.tm-cfg-modal select:focus-visible,.tm-cfg-modal input:focus-visible{outline:2px solid rgba(24,90,189,.38);outline-offset:1px;}\n"
      + ".tm-actionbar button,.tm-actionbar .tm-sep,.tm-actionbar .tm-grid-resize-block,.tm-actionbar .tm-group{flex:0 0 auto;}\n"
      + ".tm-actionbar .tm-sep{display:none;}\n"
      + ".tm-actionbar .tm-grid-resize-block{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;}\n"
      + ".tm-actionbar .tm-grid-resize-block .tm-grid-resize-title{opacity:.8;font-weight:600;}\n"
      + ".sql-icon-btn{display:inline-flex;align-items:center;gap:4px;color:#20385f;white-space:nowrap;}\n"
      + ".sql-icon-btn .sql-btn-icon{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex:0 0 15px;border-radius:4px;background:linear-gradient(135deg,#f7fbff,#dcecff);}\n"
      + ".sql-icon-btn .sql-btn-icon svg{width:13px;height:13px;display:block;stroke:#185abd;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}\n"
      + ".tm-actionbar.tm-hide-icons .sql-btn-icon{display:none !important;}\n"
      + ".sql-icon-btn.sql-icon-copy .sql-btn-icon{background:linear-gradient(135deg,#eef6ff,#d7e8ff);}\n"
      + ".sql-icon-btn.sql-icon-copy .sql-btn-icon svg{stroke:#0078d4;}\n"
      + ".sql-icon-btn.sql-icon-export .sql-btn-icon{background:linear-gradient(135deg,#e6f4ea,#c7ead2);}\n"
      + ".sql-icon-btn.sql-icon-export .sql-btn-icon svg{stroke:#217346;}\n"
      + ".sql-icon-btn.sql-icon-layout .sql-btn-icon{background:linear-gradient(135deg,#fff4ce,#fde7a9);}\n"
      + ".sql-icon-btn.sql-icon-layout .sql-btn-icon svg{stroke:#ca5010;}\n"
      + ".sql-icon-btn.sql-icon-settings .sql-btn-icon{background:linear-gradient(135deg,#f3f2f1,#e1dfdd);}\n"
      + ".sql-icon-btn.sql-icon-settings .sql-btn-icon svg{stroke:#5c2d91;}\n"
      + ".tm-summary-panel{margin-top:10px;border:1px solid #d6e0eb;border-radius:8px;background:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.9);overflow:hidden;}\n"
      + ".tm-insight-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:linear-gradient(#f7fbff,#eaf1f9);border-bottom:1px solid #d6e0eb;}\n"
      + ".tm-insight-title{font-size:13px;font-weight:800;color:#20385f;line-height:1.2;}\n"
      + ".tm-insight-sub{font-size:11px;color:#607089;margin-top:2px;}\n"
      + ".tm-insight-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}\n"
      + ".tm-insight-actions button,.tm-insight-tabs button{font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;padding:4px 9px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;cursor:pointer;}\n"
      + ".tm-insight-actions button:hover,.tm-insight-tabs button:hover{background:linear-gradient(#fff,#eaf3ff);border-color:#8fb0d8;}\n"
      + ".tm-insight-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:9px 12px 0 12px;background:#fbfdff;}\n"
      + ".tm-insight-tabs button.tm-active{background:linear-gradient(#eaf3ff,#fff);border-color:#8fb0d8;font-weight:700;}\n"
      + ".tm-insight-body{padding:10px 12px 12px 12px;background:#fbfdff;}\n"
      + ".tm-insight-view{display:none;}\n"
      + ".tm-insight-view.tm-active{display:block;}\n"
      + ".tm-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}\n"
      + ".tm-kpi{border:1px solid #d6e0eb;border-radius:8px;background:#fff;padding:9px;min-width:0;}\n"
      + ".tm-kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:.35px;color:#607089;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-kpi-value{font-size:18px;font-weight:800;color:#20385f;line-height:1.2;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-kpi-note{font-size:11px;color:#68758a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-insight-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;}\n"
      + ".tm-insight-card{border:1px solid #d6e0eb;border-radius:8px;background:#fff;padding:10px;min-width:0;}\n"
      + ".tm-insight-card-title{font-weight:800;color:#20385f;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-insight-line{font-size:12px;color:#374151;line-height:1.45;margin:3px 0;}\n"
      + ".tm-bar-row{display:grid;grid-template-columns:minmax(90px,1fr) 80px;gap:8px;align-items:center;margin:7px 0;}\n"
      + ".tm-bar-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#374151;font-weight:600;}\n"
      + ".tm-bar-track{grid-column:1 / -1;height:6px;background:#eaf1f9;border-radius:999px;overflow:hidden;}\n"
      + ".tm-bar-fill{height:100%;background:linear-gradient(90deg,#185abd,#56a3ff);border-radius:999px;}\n"
      + ".tm-empty-state{border:1px dashed #b7c5d8;border-radius:8px;background:#fff;padding:12px;color:#607089;}\n"
      + ".tm-summary-note{margin-top:9px;color:#68758a;font-size:11px;}\n"
      + ".tm-cfg-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000000;display:flex;align-items:center;justify-content:center;}\n"
      + ".tm-cfg-modal{font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;width:min(920px,94vw);max-height:88vh;background:#fff;border-radius:10px;box-shadow:0 12px 44px rgba(0,0,0,.32);overflow:hidden;display:flex;flex-direction:column;color:#1f2937;}\n"
      + ".tm-cfg-head{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:linear-gradient(#f7fbff,#eaf1f9);border-bottom:1px solid #cfdbe8;}\n"
      + ".tm-cfg-title{font-size:13px;font-weight:800;color:#20385f;}\n"
      + ".tm-cfg-modal>.tm-cfg-title{padding:11px 14px;background:linear-gradient(#f7fbff,#eaf1f9);border-bottom:1px solid #cfdbe8;}\n"
      + ".tm-cfg-subtitle{margin:12px 12px 4px 12px;font-size:12px;color:#20385f;text-transform:uppercase;letter-spacing:.4px;font-weight:800;}\n"
      + ".tm-cfg-sub{font-size:11px;color:#607089;margin-top:2px;}\n"
      + ".tm-cfg-body{padding:12px;overflow:auto;display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:12px;background:#fbfdff;}\n"
      + ".tm-cfg-card{border:1px solid #d6e0eb;border-radius:8px;background:#fff;padding:11px;}\n"
      + ".tm-cfg-card.tm-primary{border-color:#b7c5d8;background:linear-gradient(#ffffff,#fbfdff);}\n"
      + ".tm-cfg-card.tm-wide{grid-column:1 / -1;}\n"
      + ".tm-cfg-card h3{margin:0;font-size:12px;color:#20385f;text-transform:uppercase;letter-spacing:.4px;}\n"
      + ".tm-cfg-card .hint{margin:3px 0 9px 0;font-size:11px;line-height:1.35;color:#68758a;}\n"
      + ".tm-cfg-item{display:grid;grid-template-columns:1fr minmax(145px,auto);align-items:center;gap:12px;margin:7px 0;font-size:12px;border-radius:6px;}\n"
      + ".tm-cfg-modal>.tm-cfg-item{margin-left:12px;margin-right:12px;}\n"
      + ".tm-cfg-item.tm-toggle{grid-template-columns:1fr 22px;}\n"
      + ".tm-cfg-item span{font-weight:600;color:#374151;line-height:1.25;}\n"
      + ".tm-cfg-item input[type='checkbox']{width:16px;height:16px;accent-color:#185abd;}\n"
      + ".tm-cfg-item select{width:100%;min-width:145px;font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;background:#fff;color:#20385f;border:1px solid #b7c5d8;border-radius:6px;padding:4px 7px;box-sizing:border-box;}\n"
      + ".tm-cfg-toggle-grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:2px 14px;}\n"
      + ".tm-cfg-card .tm-cfg-item:first-of-type{margin-top:2px;}\n"
      + ".tm-cfg-actions{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border-top:1px solid #d6e0eb;background:#f8fbff;}\n"
      + ".tm-cfg-actions-left,.tm-cfg-actions-right{display:flex;align-items:center;gap:8px;}\n"
      + ".tm-cfg-actions button,.tm-cfg-head button{font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;padding:4px 10px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;cursor:pointer;}\n"
      + ".tm-cfg-actions button:hover,.tm-cfg-head button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}\n"
      + ".tm-cfg-actions .tm-cfg-primary{background:linear-gradient(#fff,#eaf3ff);border-color:#8fb0d8;font-weight:700;}\n"
      + ".tm-cfg-actions .tm-cfg-reset{color:#6b3d00;border-color:#d99a31;background:linear-gradient(#fff7e6,#fff);}\n"
      + ".tm-col-tools{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #d6e0eb;background:#fbfdff;}\n"
      + ".tm-col-search{flex:1 1 auto;min-width:220px;font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;border:1px solid #b7c5d8;border-radius:6px;padding:5px 8px;color:#20385f;}\n"
      + ".tm-col-tools button{font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;padding:4px 10px;border-radius:6px;border:1px solid #b7c5d8;background:#fff;color:#20385f;cursor:pointer;white-space:nowrap;}\n"
      + ".tm-col-tools button:hover{background:linear-gradient(#ffffff,#eaf3ff);border-color:#8fb0d8;}\n"
      + ".tm-col-list{padding:10px 12px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px 12px;background:#fff;}\n"
      + ".tm-col-row{display:grid;grid-template-columns:18px 1fr;align-items:center;gap:7px;padding:5px 6px;border:1px solid transparent;border-radius:6px;min-width:0;}\n"
      + ".tm-col-row:hover{background:#f8fbff;border-color:#d6e0eb;}\n"
      + ".tm-col-row input{width:16px;height:16px;accent-color:#185abd;}\n"
      + ".tm-col-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#374151;font-weight:600;}\n"
      + ".tm-col-row.tm-hidden-by-search{display:none;}\n"
      + "@media(max-width:820px){.tm-cfg-body{grid-template-columns:1fr;}.tm-cfg-card.tm-wide{grid-column:auto;}.tm-cfg-toggle-grid{grid-template-columns:1fr;}}\n"
      + ".tm-grid-shell{position:relative;border:1px solid #cfdbe8;border-radius:8px;background:#fff;box-sizing:border-box;padding:6px;max-width:100%;box-shadow:inset 0 1px 0 rgba(255,255,255,.9);}\n"
      + ".tm-grid-shell.tm-has-resize{padding-right:14px;padding-bottom:14px;}\n"
      + "#divScroll{position:relative;overflow:auto !important;resize:none !important;min-height:" + GRID_MIN_HEIGHT + "px !important;border:none !important;padding:0 !important;box-sizing:border-box !important;background:transparent !important;color:#111 !important;width:100% !important;height:100% !important;}\n"
      + "#divScroll table.enhanced-grid{border-collapse:collapse !important;width:auto !important;min-width:100% !important;}\n"
      + "#divScroll table.enhanced-grid th,#divScroll table.enhanced-grid td{border:1px solid #cfdbe8 !important;padding:6px 8px !important;white-space:nowrap !important;cursor:pointer !important;color:#111 !important;}\n"
      + "#divScroll table.enhanced-grid th{background:linear-gradient(#f7fbff,#eef4fb) !important;color:#20385f !important;position:sticky !important;top:0 !important;z-index:3 !important;font-weight:bold !important;}\n"
      + "#divScroll .tm-th-inner{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;}\n"
      + "#divScroll .tm-header-label{min-width:0;overflow:hidden;text-overflow:ellipsis;}\n"
      + "#divScroll .tm-sort-btn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 18px;border:1px solid #b7c5d8;border-radius:5px;background:#fff;color:#607089;font-size:11px;line-height:1;cursor:pointer;padding:0;font-family:" + UI_FONT_FAMILY + ";}\n"
      + "#divScroll .tm-sort-btn:hover{background:#eaf3ff;border-color:#8fb0d8;color:#185abd;}\n"
      + "#divScroll .tm-sort-btn.tm-active{background:#185abd;border-color:#185abd;color:#fff;font-weight:800;}\n"
      + "#divScroll table.enhanced-grid td:first-child,#divScroll table.enhanced-grid th:first-child{position:sticky !important;left:0 !important;background:#eaf1f9 !important;color:#20385f !important;z-index:4 !important;font-weight:bold !important;}\n"
      + "#divScroll table.enhanced-grid tr.filter-row td{background:#fbfdff !important;position:sticky !important;top:28px !important;z-index:2 !important;}\n"
      + "#divScroll table.enhanced-grid tr.filter-row input{width:95% !important;padding:3px 6px !important;color:#111 !important;border:1px solid #b7c5d8 !important;border-radius:6px !important;}\n"
      + "#divScroll td.tm-selected-cell{outline:2px solid #ca5010;outline-offset:-2px;}\n"
      + "#divScroll tr.tm-selected-row td{background:#fff7e6 !important;}\n"
      + "#divScroll th.tm-selected-col,#divScroll td.tm-selected-col{background:#eaf3ff !important;}\n"
      + "#divScroll tr.tm-highlight-row td{background:#fff4ce !important;box-shadow:inset 3px 0 0 #f2c811;}\n"
      + "#divScroll tr.tm-pinned-row td{background:#eaf3ff !important;box-shadow:inset 3px 0 0 #185abd;font-weight:600;}\n"
      + "#divScroll tr.tm-pinned-row.tm-highlight-row td{background:#fff7e6 !important;box-shadow:inset 3px 0 0 #ca5010;}\n"
      + ".tm-context-menu{position:fixed;z-index:100000;min-width:238px;max-width:min(320px,92vw);padding:6px;border:1px solid #b7c5d8;border-radius:8px;background:#fff;box-shadow:0 12px 32px rgba(32,56,95,.22);font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;color:#20385f;}\n"
      + ".tm-context-menu .tm-ctx-head{padding:7px 9px 8px 9px;border-bottom:1px solid #e1e8f2;margin-bottom:5px;}\n"
      + ".tm-context-menu .tm-ctx-title{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-context-menu .tm-ctx-sub{font-size:11px;color:#607089;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + ".tm-context-menu .tm-ctx-section{padding:4px 0;}\n"
      + ".tm-context-menu .tm-ctx-section + .tm-ctx-section{border-top:1px solid #eef3f8;}\n"
      + ".tm-context-menu button{width:100%;display:flex;align-items:center;gap:8px;border:0;background:transparent;color:#20385f;text-align:left;padding:7px 8px;border-radius:6px;cursor:pointer;font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;}\n"
      + ".tm-context-menu button:hover,.tm-context-menu button:focus-visible{background:#eaf3ff;outline:none;}\n"
      + ".tm-context-menu button.tm-danger{color:#8a2f00;}\n"
      + ".tm-context-menu .tm-ctx-ico{width:18px;flex:0 0 18px;text-align:center;color:#185abd;font-weight:800;}\n"
      + ".tm-context-menu .tm-ctx-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n"
      + ".tm-grid-shell .tm-grid-resize-handle{position:absolute;left:0;right:0;bottom:0;height:8px;cursor:ns-resize;z-index:999;background:rgba(120,120,120,.25);}\n"
      + ".tm-grid-shell .tm-grid-resize-handle-x{position:absolute;top:0;bottom:0;right:0;width:8px;cursor:ew-resize;z-index:999;background:rgba(120,120,120,.2);}\n"
      + ".tm-grid-shell .tm-grid-resize-handle-diag{position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize;z-index:1000;background:linear-gradient(135deg,rgba(120,120,120,.45),rgba(120,120,120,.05) 60%);}\n";

    var styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ===================================================================
  // ACCORDION WRAP
  // ===================================================================
  function ensureAccordion() {
    var divScroll = PageAdapter.getResultScroll();
    if (!divScroll) return null;

    var existing = divScroll.closest(".tm-accordion");
    if (existing) {
      accordionEl = existing;
      accHeaderEl = existing.querySelector(".tm-acc-header");
      accBodyEl = existing.querySelector(".tm-acc-body");
      return existing;
    }

    var parent = divScroll.parentNode;
    if (!parent) return null;

    accordionEl = document.createElement("div");
    accordionEl.className = "tm-accordion";

    accHeaderEl = document.createElement("div");
    accHeaderEl.className = "tm-acc-header";

    var title = document.createElement("div");
    title.className = "tm-acc-title";

    var chev = document.createElement("span");
    chev.className = "tm-acc-chevron";
    chev.textContent = "▾";

    var titleText = document.createElement("span");
    titleText.textContent = "Resultado";
    var statusText = document.createElement("span");
    statusText.className = "tm-acc-status";

    title.appendChild(chev);
    title.appendChild(titleText);
    title.appendChild(statusText);
    accHeaderEl.appendChild(title);

    var actions = document.createElement("div");
    actions.className = "tm-acc-actions";

    btnHeaderToolbar = document.createElement("button");
    btnHeaderToolbar.type = "button";
    btnHeaderToolbar.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleResultToolbar();
    }, true);
    syncHeaderToolbarButton();

    var btnHeaderReset = document.createElement("button");
    btnHeaderReset.type = "button";
    btnHeaderReset.textContent = "Reset";
    btnHeaderReset.title = "Reset completo do grid";
    btnHeaderReset.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      resetGridCustomizations();
    }, true);

    var btnHeaderConfig = document.createElement("button");
    btnHeaderConfig.type = "button";
    btnHeaderConfig.textContent = "Config";
    btnHeaderConfig.title = "Configurações do Grid Pro";
    btnHeaderConfig.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openConfigPanelModern();
    }, true);

    actions.appendChild(btnHeaderToolbar);
    actions.appendChild(btnHeaderReset);
    actions.appendChild(btnHeaderConfig);
    accHeaderEl.appendChild(actions);

    accBodyEl = document.createElement("div");
    accBodyEl.className = "tm-acc-body";

    parent.insertBefore(accordionEl, divScroll);
    accordionEl.appendChild(accHeaderEl);
    accordionEl.appendChild(accBodyEl);
    accBodyEl.appendChild(divScroll);

    accHeaderEl.addEventListener("click", function (e) {
      if (e.target && /^(BUTTON|SELECT|INPUT|TEXTAREA|A)$/i.test(e.target.tagName)) return;
      var isOpen = !accBodyEl.classList.contains("tm-collapsed");
      setAccOpen(!isOpen);
      applyAccordionState();
    }, true);

    function applyAccordionState() {
      var open = getAccOpenDefault();
      accBodyEl.classList.toggle("tm-collapsed", !open);
      chev.textContent = open ? "▾" : "▸";
      statusText.textContent = open ? "Expandido" : "Oculto";
      statusText.classList.toggle("tm-hidden", !open);
    }

    accordionEl.__tmApplyAccordionState = applyAccordionState;
    applyAccordionState();

    return accordionEl;
  }

  function applyAccordionStateExternal() {
    if (accordionEl && accordionEl.__tmApplyAccordionState) accordionEl.__tmApplyAccordionState();
  }

  // ===================================================================
  // GRID SHELL
  // ===================================================================
  function ensureGridShell() {
    var divScroll = PageAdapter.getResultScroll();
    if (!divScroll) return null;

    if (divScroll.parentElement && divScroll.parentElement.classList.contains("tm-grid-shell")) {
      return divScroll.parentElement;
    }

    var shell = document.createElement("div");
    shell.className = "tm-grid-shell tm-has-resize";

    var parent = divScroll.parentNode;
    parent.insertBefore(shell, divScroll);
    shell.appendChild(divScroll);

    restoreGridShellSize(shell);
    if (!shell.style.height) shell.style.height = GRID_HEIGHT_DEFAULT + "px";
    if (!shell.style.width) shell.style.width = "100%";
    clampGridShellSize(shell);

    return shell;
  }

  function restoreGridShellSize(shell) {
    var s = StorageService.getJson(GRID_SHELL_KEY_SIZE, null) || StorageService.getJson(GRID_SHELL_KEY_SIZE_LEGACY, null);
    if (!s) return;
    if (s && s.width) shell.style.width = s.width + "px";
    if (s && s.height) shell.style.height = s.height + "px";
  }

  function persistGridShellSize(shell) {
    StorageService.setJson(GRID_SHELL_KEY_SIZE, {
      width: shell.offsetWidth,
      height: shell.offsetHeight
    });
  }

  function getGridUsableMaxHeight() {
    return Math.max(GRID_MIN_HEIGHT, Math.round(window.innerHeight * (GRID_MAX_HEIGHT_VH / 100)));
  }

  function getGridUsableMaxWidth(shell) {
    var parent = shell && shell.parentElement ? shell.parentElement : null;
    var parentW = parent ? parent.clientWidth : window.innerWidth;
    return Math.max(320, Math.min(window.innerWidth - 24, parentW));
  }

  function clampGridShellSize(shell) {
    if (!shell) return;

    var maxH = getGridUsableMaxHeight();
    var maxW = getGridUsableMaxWidth(shell);
    var currentH = Math.max(GRID_MIN_HEIGHT, shell.offsetHeight || GRID_HEIGHT_DEFAULT);
    var currentW = shell.offsetWidth || maxW;

    shell.style.height = Math.min(currentH, maxH) + "px";
    shell.style.width = Math.min(currentW, maxW) + "px";
  }

  function fitGridShellToPage(shell) {
    if (!shell) return;
    shell.style.width = "100%";
    shell.style.height = Math.min(GRID_HEIGHT_DEFAULT, getGridUsableMaxHeight()) + "px";
    persistGridShellSize(shell);
  }

  function getMainTableForResize() {
    var table = PageAdapter.getResultTable();
    if (!table) return null;
    if (!table.classList.contains("enhanced-grid")) processTable(table);
    return table;
  }

  function getVisibleDataRows(table, limit) {
    var out = [];
    for (var i = 2; i < table.rows.length; i++) {
      var row = table.rows[i];
      if (row.style.display === "none") continue;
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  }

  function autoResizeForFirstRows(limitRows) {
    var shell = ensureGridShell();
    var table = getMainTableForResize();
    if (!shell || !table) return alert("Não há tabela para ajustar.");

    var rows = getVisibleDataRows(table, limitRows);
    if (!rows.length) return alert("Não há linhas visíveis para ajustar.");

    var headerH = table.rows[0] ? table.rows[0].offsetHeight : 28;
    var filterH = table.rows[1] ? table.rows[1].offsetHeight : 28;
    var dataH = 0;
    for (var i = 0; i < rows.length; i++) dataH += rows[i].offsetHeight || 28;

    var contentH = headerH + filterH + dataH + 18;
    shell.style.height = Math.round(Math.max(GRID_MIN_HEIGHT, contentH)) + "px";
    clampGridShellSize(shell);
    persistGridShellSize(shell);
    showToast("Altura ajustada para até " + limitRows + " linhas");
  }

  function autoResizeForFirstCols(limitCols) {
    var shell = ensureGridShell();
    var table = getMainTableForResize();
    if (!shell || !table) return alert("Não há tabela para ajustar.");

    var maxColIndex = Math.min(table.rows[0].cells.length - 1, limitCols);
    var width = 0;

    for (var c = 0; c <= maxColIndex; c++) {
      var colW = table.rows[0].cells[c] ? table.rows[0].cells[c].offsetWidth : 80;
      width += colW;
    }

    shell.style.width = Math.round(Math.max(320, width + 18)) + "px";
    clampGridShellSize(shell);
    persistGridShellSize(shell);
    showToast("Largura ajustada para até " + limitCols + " colunas");
  }

  // ===================================================================
  // GRID ENHANCE
  // ===================================================================
  function clearSelectionStyles(table) {
    if (!table) return;
    var oldCell = table.querySelector("td.tm-selected-cell");
    if (oldCell) oldCell.classList.remove("tm-selected-cell");
    var oldRow = table.querySelector("tr.tm-selected-row");
    if (oldRow) oldRow.classList.remove("tm-selected-row");
    var colOld = table.querySelectorAll(".tm-selected-col");
    for (var i = 0; i < colOld.length; i++) colOld[i].classList.remove("tm-selected-col");
  }

  function selectCell(table, td) {
    if (!table || !td || td.tagName !== "TD") return;
    clearSelectionStyles(table);
    selectedCell = td;
    selectedRowEl = td.parentElement && td.parentElement.tagName === "TR" ? td.parentElement : null;
    selectedColIndex = null;
    td.classList.add("tm-selected-cell");
    if (selectedRowEl) selectedRowEl.classList.add("tm-selected-row");
    refreshSummaryPanel();
  }

  function clearTableFilters(table) {
    if (!table || !table.rows || !table.rows[1] || !table.rows[1].classList.contains("filter-row")) return false;
    var filtRow = table.rows[1];
    var inputs = filtRow.querySelectorAll("input");
    var hadFilter = false;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value) hadFilter = true;
      inputs[i].value = "";
    }
    applyTableFilters(table, filtRow);
    refreshSummaryPanel();
    return hadFilter;
  }

  function applyPinnedRows(table) {
    if (!table || !table.rows || table.rows.length <= 2) return;
    var body = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table;
    var rows = Array.prototype.slice.call(table.rows, 2);
    var pinned = rows.filter(function (row) { return row.classList.contains("tm-pinned-row"); });
    if (!pinned.length) return;
    var anchor = null;
    for (var i = 0; i < table.rows.length; i++) {
      var candidate = table.rows[i];
      if (i >= 2 && !candidate.classList.contains("tm-pinned-row")) {
        anchor = candidate;
        break;
      }
    }
    for (var p = 0; p < pinned.length; p++) body.insertBefore(pinned[p], anchor);
  }

  function toggleHighlightRow(row) {
    if (!row || row.rowIndex < 2) return false;
    row.classList.toggle("tm-highlight-row");
    return row.classList.contains("tm-highlight-row");
  }

  function togglePinnedRow(table, row) {
    if (!table || !row || row.rowIndex < 2) return false;
    row.classList.toggle("tm-pinned-row");
    applyPinnedRows(table);
    return row.classList.contains("tm-pinned-row");
  }

  function filterByCellValue(table, cell) {
    if (!table || !cell || cell.cellIndex <= 0 || !table.rows[1] || !table.rows[1].classList.contains("filter-row")) return false;
    var input = table.rows[1].cells[cell.cellIndex] ? table.rows[1].cells[cell.cellIndex].querySelector("input") : null;
    if (!input) return false;
    input.value = (cell.innerText || cell.textContent || "").trim();
    applyTableFilters(table, table.rows[1]);
    refreshSummaryPanel();
    return true;
  }

  function hideColumnFromContext(table, colIndex) {
    if (!table || colIndex <= 0 || !table.rows[0] || !table.rows[0].cells[colIndex]) return false;
    var key = getHeaderNormByColIndex(table, colIndex);
    if (!key) return false;
    var hidden = getHiddenColsSet();
    hidden[key] = true;
    setHiddenColsSet(hidden);
    applyHiddenColumns(table);
    refreshSummaryPanel();
    return true;
  }

  function ensureContextMenu() {
    if (contextMenuEl && document.body.contains(contextMenuEl)) return contextMenuEl;
    contextMenuEl = document.createElement("div");
    contextMenuEl.className = "tm-context-menu";
    contextMenuEl.style.display = "none";
    document.body.appendChild(contextMenuEl);
    return contextMenuEl;
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.style.display = "none";
  }

  function addContextAction(section, icon, label, action, danger) {
    var btn = document.createElement("button");
    btn.type = "button";
    if (danger) btn.className = "tm-danger";
    var ico = document.createElement("span");
    ico.className = "tm-ctx-ico";
    ico.textContent = icon;
    var txt = document.createElement("span");
    txt.className = "tm-ctx-label";
    txt.textContent = label;
    btn.appendChild(ico);
    btn.appendChild(txt);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      hideContextMenu();
      action();
    }, true);
    section.appendChild(btn);
    return btn;
  }

  function addContextSection(menu) {
    var section = document.createElement("div");
    section.className = "tm-ctx-section";
    menu.appendChild(section);
    return section;
  }

  function getGridSelectedText(table) {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !String(sel.toString() || "").trim()) return "";
    var selectedText = String(sel.toString() || "").trim();
    if (!table || !table.contains) return selectedText;

    for (var i = 0; i < sel.rangeCount; i++) {
      var range = sel.getRangeAt(i);
      var startNode = range.startContainer && range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentNode;
      var endNode = range.endContainer && range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentNode;
      var commonNode = range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
      if ((startNode && table.contains(startNode)) || (endNode && table.contains(endNode)) || (commonNode && table.contains(commonNode))) {
        return selectedText;
      }
    }
    return "";
  }

  function positionContextMenu(menu, ev) {
    menu.style.display = "block";
    menu.style.left = "0px";
    menu.style.top = "0px";
    var rect = menu.getBoundingClientRect();
    var left = Math.min(ev.clientX, window.innerWidth - rect.width - 8);
    var top = Math.min(ev.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
  }

  function showGridContextMenu(table, target, ev) {
    if (!table || !target) return;
    var isHeader = target.tagName === "TH";
    var isCell = target.tagName === "TD" && !(target.parentElement && target.parentElement.classList.contains("filter-row"));
    var colIndex = target.cellIndex;
    var row = isCell ? target.parentElement : null;
    var colName = (colIndex > 0 && table.rows[0] && table.rows[0].cells[colIndex]) ? getHeaderText(table.rows[0].cells[colIndex]) : "";
    var cellText = isCell ? (target.innerText || target.textContent || "").trim() : "";
    var selectedText = getGridSelectedText(table);

    if (isHeader) selectColumn(table, colIndex);
    else if (isCell) selectCell(table, target);

    var menu = ensureContextMenu();
    menu.innerHTML = "";

    var head = document.createElement("div");
    head.className = "tm-ctx-head";
    var title = document.createElement("div");
    title.className = "tm-ctx-title";
    title.textContent = isHeader ? (colName || "Coluna") : (isCell ? "Linha " + (row && row.cells[0] ? row.cells[0].textContent : "") : "Resultado");
    var sub = document.createElement("div");
    sub.className = "tm-ctx-sub";
    sub.textContent = isCell ? ((colName || "Coluna") + (cellText ? ": " + cellText : "")) : (isHeader ? "Ações da coluna" : "Ações do resultado");
    head.appendChild(title);
    head.appendChild(sub);
    menu.appendChild(head);

    if (isCell) {
      var copySec = addContextSection(menu);
      if (selectedText) {
        addContextAction(copySec, "S", "Copiar seleção", function () {
          reliableCopy(selectedText, function (ok) { showToast(ok ? "Seleção copiada" : "Falha ao copiar seleção"); });
        });
      }
      addContextAction(copySec, "C", "Copiar célula", function () {
        copySelectedCell(function (ok) { showToast(ok ? "Célula copiada" : "Falha ao copiar célula"); });
      });
      addContextAction(copySec, "L", "Copiar linha", function () {
        copySelectedRow(table, function (ok) { showToast(ok ? "Linha copiada" : "Falha ao copiar linha"); });
      });
      if (colIndex > 0) {
        addContextAction(copySec, "O", "Copiar coluna", function () {
          selectedColIndex = colIndex;
          copySelectedColumn(table, function (ok) { showToast(ok ? "Coluna copiada" : "Falha ao copiar coluna"); });
        });
      }

      var rowSec = addContextSection(menu);
      addContextAction(rowSec, "F", row && row.classList.contains("tm-pinned-row") ? "Desfixar linha" : "Fixar linha no topo", function () {
        var pinned = togglePinnedRow(table, row);
        showToast(pinned ? "Linha fixada no topo" : "Linha desfixada");
      });
      addContextAction(rowSec, "D", row && row.classList.contains("tm-highlight-row") ? "Remover destaque" : "Destacar linha", function () {
        var highlighted = toggleHighlightRow(row);
        showToast(highlighted ? "Linha destacada" : "Destaque removido");
      });
      if (colIndex > 0) {
        addContextAction(rowSec, "=", "Filtrar por este valor", function () {
          showToast(filterByCellValue(table, target) ? "Filtro aplicado" : "Não foi possível filtrar");
        });
      }
    }

    if (colIndex > 0) {
      var colSec = addContextSection(menu);
      addContextAction(colSec, "^", "Ordenar crescente", function () { sortTableByColumn(table, colIndex, "asc"); });
      addContextAction(colSec, "v", "Ordenar decrescente", function () { sortTableByColumn(table, colIndex, "desc"); });
      addContextAction(colSec, "0", "Voltar ordem da consulta", function () {
        showToast(clearColumnSort(table) ? "Ordem original restaurada" : "A consulta já está na ordem original");
      });
      addContextAction(colSec, "R", "Renomear coluna", function () {
        selectedColIndex = colIndex;
        renameSelectedColumn(table);
      });
      addContextAction(colSec, "X", "Ocultar coluna", function () {
        showToast(hideColumnFromContext(table, colIndex) ? "Coluna ocultada" : "Não foi possível ocultar coluna");
      }, true);
    }

    var generalSec = addContextSection(menu);
    addContextAction(generalSec, "E", "Limpar filtros", function () {
      showToast(clearTableFilters(table) ? "Filtros limpos" : "Nenhum filtro ativo");
    });
    addContextAction(generalSec, "A", "Mostrar todas as colunas", function () {
      clearHiddenColumns(table);
      showToast("Todas as colunas visíveis");
    });

    positionContextMenu(menu, ev);
    var first = menu.querySelector("button");
    if (first) setTimeout(function () { try { first.focus(); } catch (_) {} }, 0);
  }

  function installContextMenuHooks(table) {
    if (!table || table.dataset.tmContextHook) return;
    table.dataset.tmContextHook = "1";
    table.addEventListener("contextmenu", function (ev) {
      var t = ev.target;
      while (t && t !== table && t.tagName !== "TD" && t.tagName !== "TH") t = t.parentNode;
      if (!t || t === table) return;
      ev.preventDefault();
      ev.stopPropagation();
      showGridContextMenu(table, t, ev);
    }, true);

    if (!window.__tmGridContextGlobalHook) {
      window.__tmGridContextGlobalHook = true;
      document.addEventListener("click", hideContextMenu, true);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") hideContextMenu();
      }, true);
      window.addEventListener("scroll", hideContextMenu, true);
      window.addEventListener("resize", hideContextMenu, true);
    }
  }

  function selectColumn(table, colIndex) {
    if (!table || colIndex == null) return;
    clearSelectionStyles(table);
    selectedColIndex = colIndex;
    selectedCell = null;
    selectedRowEl = null;
    for (var r = 0; r < table.rows.length; r++) {
      var row = table.rows[r];
      if (!row || !row.cells || colIndex >= row.cells.length) continue;
      row.cells[colIndex].classList.add("tm-selected-col");
    }
    refreshSummaryPanel();
  }

  function copySelectedCell(done) {
    if (!selectedCell) return done(false);
    reliableCopy((selectedCell.innerText || "").trim(), function (ok) { done(ok); });
  }

  function copySelectedColumn(table, done) {
    if (!table || selectedColIndex == null) return done(false);
    var out = [];
    var hCell = table.rows[0] && table.rows[0].cells[selectedColIndex];
    if (hCell) out.push(getHeaderText(hCell));
    for (var r = 2; r < table.rows.length; r++) {
      var row = table.rows[r];
      if (row.style.display === "none") continue;
      var cell = row.cells[selectedColIndex];
      out.push(((cell && cell.innerText) ? cell.innerText : "").trim());
    }
    reliableCopy(out.join("\n"), function (ok) { done(ok); });
  }

  function copySelectedRow(table, done) {
    if (!table || !selectedRowEl) return done(false);
    if (selectedRowEl.style.display === "none") return done(false);
    var cells = Array.prototype.slice.call(selectedRowEl.cells).slice(1);
    var vals = cells.map(function (c) { return ((c && c.innerText) ? String(c.innerText) : "").trim(); });
    reliableCopy(vals.join(TABLE_SEPARATOR), function (ok) { done(ok); });
  }

  function getHeaderText(th) {
    if (!th) return "";
    var label = th.querySelector ? th.querySelector(".tm-header-label") : null;
    return (label ? label.textContent : (th.innerText || th.textContent || "")).trim();
  }

  function updateIndexColumn(table) {
    if (!table || !table.rows) return;
    for (var r = 2; r < table.rows.length; r++) {
      if (table.rows[r].cells[0]) table.rows[r].cells[0].textContent = String(r - 1);
    }
  }

  function restoreOriginalRowOrder(table) {
    if (!table || !table.rows) return;
    var rows = Array.prototype.slice.call(table.rows, 2).map(function (row, idx) {
      var raw = row.cells[0] ? String(row.cells[0].textContent || "").trim() : "";
      var n = Number(raw);
      return { row: row, idx: idx, original: isNaN(n) ? idx + 1 : n };
    });
    rows.sort(function (a, b) {
      if (a.original === b.original) return a.idx - b.idx;
      return a.original - b.original;
    });
    var body = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table;
    for (var i = 0; i < rows.length; i++) body.appendChild(rows[i].row);
  }

  function clearColumnSort(table) {
    if (!table || !table.rows) return false;
    var hadSort = !!(table.dataset.tmSortCol || table.dataset.tmSortDir);
    restoreOriginalRowOrder(table);
    delete table.dataset.tmSortCol;
    delete table.dataset.tmSortDir;
    applyPinnedRows(table);
    renderHeaderSortControls(table);
    refreshSummaryPanel();
    return hadSort;
  }

  function compareGridValues(a, b) {
    var av = String(a == null ? "" : a).trim();
    var bv = String(b == null ? "" : b).trim();
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;

    var an = parseLocaleNumber(av);
    var bn = parseLocaleNumber(bv);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;

    var ad = parseGridDate(av);
    var bd = parseGridDate(bv);
    if (!isNaN(ad) && !isNaN(bd)) return ad - bd;

    return av.localeCompare(bv, "pt-BR", { numeric: true, sensitivity: "base" });
  }

  function parseGridDate(value) {
    var s = String(value || "").trim();
    var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (br) {
      var year = Number(br[3]);
      if (year < 100) year += 2000;
      var dt = new Date(year, Number(br[2]) - 1, Number(br[1]), Number(br[4] || 0), Number(br[5] || 0), Number(br[6] || 0));
      return dt.getTime();
    }
    return Date.parse(s);
  }

  function renderHeaderSortControls(table) {
    if (!table || !table.rows || !table.rows[0]) return;
    var sortCol = Number(table.dataset.tmSortCol || -1);
    var sortDir = table.dataset.tmSortDir || "";
    var cells = table.rows[0].cells;
    for (var c = 0; c < cells.length; c++) {
      var th = cells[c];
      if (!th) continue;
      var labelText = getHeaderText(th) || (c === 0 ? "#" : ("Coluna " + c));
      th.textContent = "";

      var wrap = document.createElement("span");
      wrap.className = "tm-th-inner";

      var label = document.createElement("span");
      label.className = "tm-header-label";
      label.textContent = labelText;
      label.title = labelText;
      wrap.appendChild(label);

      if (c > 0) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tm-sort-btn" + (sortCol === c ? " tm-active" : "");
        btn.dataset.tmSortBtn = "1";
        btn.dataset.colIndex = String(c);
        btn.textContent = sortCol === c ? (sortDir === "desc" ? "v" : "^") : "↕";
        btn.title = sortCol === c
          ? ("Ordenado " + (sortDir === "desc" ? "decrescente" : "crescente") + ". Clique para inverter.")
          : "Ordenar coluna";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          sortTableByColumn(table, Number(this.dataset.colIndex));
        }, true);
        wrap.appendChild(btn);
      }

      th.appendChild(wrap);
    }
  }

  function sortTableByColumn(table, colIndex, forcedDir) {
    if (!table || !table.rows || colIndex <= 0) return;
    var currentCol = Number(table.dataset.tmSortCol || -1);
    var currentDir = table.dataset.tmSortDir || "";
    var nextDir = forcedDir || ((currentCol === colIndex && currentDir === "asc") ? "desc" : "asc");
    var rows = Array.prototype.slice.call(table.rows, 2).map(function (row, idx) {
      var cell = row.cells[colIndex];
      return {
        row: row,
        idx: idx,
        value: cell ? (cell.innerText || cell.textContent || "") : ""
      };
    });

    rows.sort(function (a, b) {
      var cmp = compareGridValues(a.value, b.value);
      if (cmp === 0) cmp = a.idx - b.idx;
      return nextDir === "desc" ? -cmp : cmp;
    });

    var body = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table;
    for (var i = 0; i < rows.length; i++) body.appendChild(rows[i].row);
    table.dataset.tmSortCol = String(colIndex);
    table.dataset.tmSortDir = nextDir;
    applyPinnedRows(table);
    renderHeaderSortControls(table);
    refreshSummaryPanel();
    showToast("Coluna ordenada " + (nextDir === "desc" ? "decrescente" : "crescente"));
  }

  function processTable(table) {
    if (!table || table.classList.contains("enhanced-grid")) return;
    table.classList.add("enhanced-grid");

    for (var i = 0; i < table.rows.length; i++) {
      var cell = document.createElement(i === 0 ? "th" : "td");
      cell.textContent = (i === 0) ? "#" : String(i);
      table.rows[i].insertBefore(cell, table.rows[i].firstChild);
    }

    applyColumnRenames(table);
    renderHeaderSortControls(table);

    var filtRow = table.insertRow(1);
    filtRow.className = "filter-row";

    var headerCells = Array.prototype.slice.call(table.rows[0].cells);
    headerCells.forEach(function (_, idx) {
      var td = filtRow.insertCell();
      if (idx === 0) { td.textContent = "🔍"; return; }
      var inp = document.createElement("input");
      inp.placeholder = "Filtrar...";
      inp.oninput = function () {
        applyTableFilters(table, filtRow);
        if (!userConfig || userConfig.autoRefreshInsightsOnFilter) scheduleSummaryRefresh();
      };
      td.appendChild(inp);
    });

    if (!table.dataset.tmSelectHook) {
      table.dataset.tmSelectHook = "1";
      table.addEventListener("click", function (ev) {
        var sortTarget = ev.target;
        while (sortTarget && sortTarget !== table) {
          if (sortTarget.dataset && sortTarget.dataset.tmSortBtn) return;
          sortTarget = sortTarget.parentNode;
        }
        var t = ev.target;
        while (t && t !== table && t.tagName !== "TD" && t.tagName !== "TH") t = t.parentNode;
        if (!t || t === table) return;
        if (t.parentElement && t.parentElement.classList.contains("filter-row")) return;
        if (t.tagName === "TH") { selectColumn(table, t.cellIndex); return; }
        selectCell(table, t);
      }, true);
    }

    if (!table.dataset.tmHeaderDblHook) {
      table.dataset.tmHeaderDblHook = "1";
      table.addEventListener("dblclick", function (ev) {
        var t = ev.target;
        while (t && t !== table && t.tagName !== "TH") t = t.parentNode;
        if (!t || t === table) return;
        if (t.parentElement && t.parentElement.classList.contains("filter-row")) return;
        var colName = getHeaderText(t);
        if (!colName || colName === "#") return;
        reliableCopy(colName, function (ok) {
          if (ok) showToast("Nome da coluna copiado");
          else alert("Falha ao copiar nome da coluna.");
        });
      }, true);
    }

    installContextMenuHooks(table);
    applyHiddenColumns(table);
  }

  function getHeaderNormByColIndex(table, colIndex) {
    if (!table || !table.rows[0] || !table.rows[0].cells[colIndex]) return "";
    var txt = getHeaderText(table.rows[0].cells[colIndex]);
    return normalizeHeaderText(txt);
  }

  function applyColumnRenames(table) {
    if (!table || !table.rows || !table.rows[0]) return;
    var map = getColumnRenameMap(table);
    var headerCells = table.rows[0].cells;
    for (var c = 0; c < headerCells.length; c++) {
      if (!headerCells[c]) continue;
      var current = getHeaderText(headerCells[c]);
      if (!current || current === "#") continue;
      if (!headerCells[c].dataset.tmOriginalHeaderText) {
        headerCells[c].dataset.tmOriginalHeaderText = current;
        headerCells[c].dataset.tmOriginalHeaderKey = normalizeHeaderText(current);
      }
      var originalText = headerCells[c].dataset.tmOriginalHeaderText || current;
      var key = headerCells[c].dataset.tmOriginalHeaderKey || normalizeHeaderText(originalText);
      headerCells[c].textContent = map[key] || originalText;
    }
  }

  function renameSelectedColumn(table) {
    if (!table || !table.rows || !table.rows[0]) return false;
    if (selectedColIndex == null || selectedColIndex <= 0 || !table.rows[0].cells[selectedColIndex]) return false;

    var headerCell = table.rows[0].cells[selectedColIndex];
    var oldName = getHeaderText(headerCell);
    if (!oldName) return false;
    if (!headerCell.dataset.tmOriginalHeaderText) {
      headerCell.dataset.tmOriginalHeaderText = oldName;
      headerCell.dataset.tmOriginalHeaderKey = normalizeHeaderText(oldName);
    }

    var nextName = window.prompt("Novo nome para a coluna:", oldName);
    if (nextName === null) return false;
    nextName = String(nextName).trim();

    var map = getColumnRenameMap(table);
    var oldKey = headerCell.dataset.tmOriginalHeaderKey || normalizeHeaderText(oldName);

    if (!nextName) delete map[oldKey];
    else map[oldKey] = nextName;

    setColumnRenameMap(table, map);
    applyColumnRenames(table);
    renderHeaderSortControls(table);
    refreshSummaryPanel();
    showToast(nextName ? "Coluna renomeada" : "Renomeação removida");
    return true;
  }

  function applyHiddenColumns(table) {
    if (!table || !table.rows || !table.rows.length) return;
    var hidden = getHiddenColsSet();
    for (var c = 0; c < table.rows[0].cells.length; c++) {
      var norm = getHeaderNormByColIndex(table, c);
      var shouldHide = (c !== 0) && !!hidden[norm]; // nunca oculta coluna índice '#'
      for (var r = 0; r < table.rows.length; r++) {
        if (table.rows[r].cells[c]) table.rows[r].cells[c].style.display = shouldHide ? "none" : "";
      }
    }
  }

  function promptHiddenColumns(table) {
    if (!table || !table.rows[0]) return;
    var columns = [];
    for (var c = 1; c < table.rows[0].cells.length; c++) {
      var name = getHeaderText(table.rows[0].cells[c]);
      if (name) columns.push({ name: name, key: normalizeHeaderText(name), index: c });
    }
    if (!columns.length) return alert("Nenhuma coluna encontrada para configurar.");

    var currentSet = getHiddenColsSet();

    var backdrop = document.createElement("div");
    backdrop.className = "tm-cfg-backdrop";

    var modal = document.createElement("div");
    modal.className = "tm-cfg-modal";
    modal.style.width = "min(780px, 94vw)";

    function closePanel() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    var head = document.createElement("div");
    head.className = "tm-cfg-head";
    var headText = document.createElement("div");
    var title = document.createElement("div");
    title.className = "tm-cfg-title";
    title.textContent = "Colunas do resultado";
    var sub = document.createElement("div");
    sub.className = "tm-cfg-sub";
    sub.textContent = "Desmarque as colunas que você quer ocultar.";
    headText.appendChild(title);
    headText.appendChild(sub);
    var btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = "Fechar";
    btnClose.onclick = closePanel;
    head.appendChild(headText);
    head.appendChild(btnClose);
    modal.appendChild(head);

    var tools = document.createElement("div");
    tools.className = "tm-col-tools";

    var search = document.createElement("input");
    search.className = "tm-col-search";
    search.type = "search";
    search.placeholder = "Buscar coluna...";
    tools.appendChild(search);

    var btnShowAll = document.createElement("button");
    btnShowAll.type = "button";
    btnShowAll.textContent = "Marcar todas";
    tools.appendChild(btnShowAll);

    var btnHideAll = document.createElement("button");
    btnHideAll.type = "button";
    btnHideAll.textContent = "Desmarcar todas";
    tools.appendChild(btnHideAll);
    modal.appendChild(tools);

    var list = document.createElement("div");
    list.className = "tm-col-list";

    columns.forEach(function (col) {
      var row = document.createElement("label");
      row.className = "tm-col-row";
      row.dataset.searchText = normalizeHeaderText(col.name);

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !currentSet[col.key];
      cb.dataset.colKey = col.key;

      var sp = document.createElement("span");
      sp.className = "tm-col-name";
      sp.textContent = col.name;
      sp.title = col.name;

      row.appendChild(cb);
      row.appendChild(sp);
      list.appendChild(row);
    });
    modal.appendChild(list);

    var actions = document.createElement("div");
    actions.className = "tm-cfg-actions";
    var leftActions = document.createElement("div");
    leftActions.className = "tm-cfg-actions-left";
    var rightActions = document.createElement("div");
    rightActions.className = "tm-cfg-actions-right";

    var btnVisible = document.createElement("button");
    btnVisible.type = "button";
    btnVisible.textContent = "Mostrar todas";
    btnVisible.className = "tm-cfg-reset";
    leftActions.appendChild(btnVisible);

    var btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancelar";
    btnCancel.onclick = closePanel;

    var btnApply = document.createElement("button");
    btnApply.type = "button";
    btnApply.textContent = "Aplicar";
    btnApply.className = "tm-cfg-primary";

    rightActions.appendChild(btnCancel);
    rightActions.appendChild(btnApply);
    actions.appendChild(leftActions);
    actions.appendChild(rightActions);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    function setAllVisible(visible) {
      var checks = list.querySelectorAll("input[type='checkbox']");
      for (var i = 0; i < checks.length; i++) checks[i].checked = !!visible;
    }

    function applySearch() {
      var q = normalizeHeaderText(search.value || "");
      var rows = list.querySelectorAll(".tm-col-row");
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle("tm-hidden-by-search", !!q && rows[i].dataset.searchText.indexOf(q) === -1);
      }
    }

    function applyChoice() {
      var next = {};
      var checks = list.querySelectorAll("input[type='checkbox'][data-col-key]");
      for (var i = 0; i < checks.length; i++) {
        if (!checks[i].checked) next[checks[i].dataset.colKey] = true;
      }
      setHiddenColsSet(next);
      applyHiddenColumns(table);
      refreshSummaryPanel();
      closePanel();
      var hiddenCount = Object.keys(next).length;
      showToast(hiddenCount ? hiddenCount + " coluna(s) oculta(s)" : "Todas as colunas visíveis");
    }

    btnShowAll.onclick = function () { setAllVisible(true); };
    btnHideAll.onclick = function () { setAllVisible(false); };
    btnVisible.onclick = function () {
      setHiddenColsSet({});
      applyHiddenColumns(table);
      refreshSummaryPanel();
      closePanel();
      showToast("Todas as colunas visíveis");
    };
    btnApply.onclick = applyChoice;
    search.oninput = applySearch;

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closePanel();
    });
    setTimeout(function () { try { search.focus(); } catch (_) {} }, 0);
  }

  function clearHiddenColumns(table) {
    setHiddenColsSet({});
    applyHiddenColumns(table);
    refreshSummaryPanel();
  }

  function enhanceGrid() {
    var divScroll = PageAdapter.getResultScroll();
    if (!divScroll) return;
    var tables = divScroll.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var signature = String(table.rows.length) + ":" + String(table.rows[0] ? table.rows[0].cells.length : 0);
      installContextMenuHooks(table);
      if (!table.classList.contains("enhanced-grid")) {
        processTable(table);
        table.dataset.tmGridSignature = signature;
        continue;
      }
      if (table.dataset.tmGridSignature !== signature) {
        table.dataset.tmGridSignature = signature;
        applyColumnRenames(table);
        renderHeaderSortControls(table);
        applyHiddenColumns(table);
      }
    }
  }

  // ===================================================================
  // COPY / EXPORT
  // ===================================================================
  function getExportRows(table, opts) {
    opts = opts || {};
    var includeHeader = (opts.includeHeader !== false);
    var includeFilterRow = !!opts.includeFilterRow;
    var includeIndexCol = !!opts.includeIndexCol;

    if (!table) return [];
    var rows = Array.prototype.slice.call(table.rows);
    var out = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var isHeader = (i === 0);
      var isFilter = row.classList.contains("filter-row");

      if (isHeader && !includeHeader) continue;
      if (isFilter && !includeFilterRow) continue;

      var isDataRow = (!isHeader && !isFilter);
      if (isDataRow && row.style.display === "none") continue;

      var cells = Array.prototype.slice.call(row.cells);
      var cellsToUse = includeIndexCol ? cells : cells.slice(1);
      var line = [];
      for (var c = 0; c < cellsToUse.length; c++) {
        line.push(isHeader ? getHeaderText(cellsToUse[c]) : ((cellsToUse[c].innerText || "").trim()));
      }
      out.push(line);
    }
    return out;
  }

  function parseLocaleNumber(value) {
    if (value == null) return NaN;
    var s = String(value).trim();
    if (!s) return NaN;
    s = s.replace(/\s/g, "");
    if (/,\d{1,2}$/.test(s) && s.indexOf(".") > -1) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.indexOf(",") > -1 && s.indexOf(".") === -1) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function fmtNum(n) {
    try { return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); } catch (_) { return String(n); }
  }

  function pctNum(part, total) {
    return total ? (Number(part || 0) / total) * 100 : 0;
  }

  function insightBar(label, value, total) {
    var pct = pctNum(value, total);
    return "<div class='tm-bar-row'>"
      + "<div class='tm-bar-label' title='" + escapeHtml(label) + "'>" + escapeHtml(label) + "</div>"
      + "<div class='tm-insight-line'>" + fmtNum(value) + " (" + fmtNum(pct) + "%)</div>"
      + "<div class='tm-bar-track'><div class='tm-bar-fill' style='width:" + Math.max(2, Math.min(100, pct)) + "%'></div></div>"
      + "</div>";
  }

  function isIdLikeHeader(name) {
    var t = normalizeHeaderText(name);
    return (
      t === "id" ||
      /(^|_)id($|_)/.test(t) ||
      t.indexOf("codigo") >= 0 ||
      t.indexOf("chave") >= 0 ||
      t.indexOf("identificador") >= 0
    );
  }

  function isValueLikeHeader(name) {
    var t = normalizeHeaderText(name);
    return (
      t.indexOf("valor") >= 0 ||
      t.indexOf("total") >= 0 ||
      t.indexOf("saldo") >= 0 ||
      t.indexOf("preco") >= 0 ||
      t.indexOf("price") >= 0 ||
      t.indexOf("amount") >= 0 ||
      t.indexOf("vlr") >= 0 ||
      t.indexOf("qtde") >= 0 ||
      t.indexOf("qtd") >= 0 ||
      t.indexOf("quantidade") >= 0
    );
  }

  function ensureSummaryPanel() {
    if (!accBodyEl) return null;
    if (summaryPanelEl && document.body.contains(summaryPanelEl)) {
      if (summaryPanelEl.parentNode !== accBodyEl) accBodyEl.appendChild(summaryPanelEl);
      return summaryPanelEl;
    }

    summaryPanelEl = document.createElement("div");
    summaryPanelEl.className = "tm-summary-panel";
    accBodyEl.appendChild(summaryPanelEl);
    return summaryPanelEl;
  }

  function refreshSummaryPanel() {
    var panel = ensureSummaryPanel();
    if (!panel) return;
    if (userConfig && !userConfig.showInsights) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "";

    var table = getMainTableForResize();
    if (!table) {
      panel.innerHTML = "<div class='tm-summary-title'>Subtotais e insights</div><div class='tm-summary-note'>Sem dados para resumir.</div>";
      return;
    }

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) {
      panel.innerHTML = "<div class='tm-summary-title'>Subtotais e insights</div><div class='tm-summary-note'>Sem linhas visíveis no momento.</div>";
      return;
    }

    var headers = rows[0];
    var data = rows.slice(1);
    var visibleRows = data.length;
    var totalCols = headers.length;
    var nonEmpty = 0;
    var nullCells = 0;
    var numericStats = [];
    var statusColIndex = -1;
    var statusCounts = {};
    var dupCount = 0;
    var seenKeys = {};

    for (var hs = 0; hs < headers.length; hs++) {
      var ht = normalizeHeaderText(headers[hs]);
      if (ht.indexOf("status") >= 0 || ht.indexOf("situacao") >= 0 || ht.indexOf("state") >= 0) {
        statusColIndex = hs;
        break;
      }
    }

    for (var c = 0; c < totalCols; c++) {
      var headerName = headers[c];
      var isIdCol = isIdLikeHeader(headerName);
      var isValueCol = isValueLikeHeader(headerName);
      var countNum = 0, sum = 0, min = null, max = null;
      for (var r = 0; r < visibleRows; r++) {
        var raw = data[r][c];
        if (String(raw || "").trim() !== "") nonEmpty++; else nullCells++;
        if (statusColIndex === c) {
          var st = String(raw || "").trim() || "(vazio)";
          statusCounts[st] = (statusCounts[st] || 0) + 1;
        }
        var n = parseLocaleNumber(raw);
        if (!isNaN(n)) {
          countNum++;
          sum += n;
          min = (min == null) ? n : Math.min(min, n);
          max = (max == null) ? n : Math.max(max, n);
        }
      }
      if (!isIdCol && isValueCol && countNum >= Math.max(3, Math.floor(visibleRows * 0.5))) {
        numericStats.push({
          name: headerName,
          count: countNum,
          sum: sum,
          avg: sum / countNum,
          min: min,
          max: max,
          score: Math.abs(sum)
        });
      }
    }

    var idCols = [];
    for (var ic = 0; ic < totalCols; ic++) {
      if (isIdLikeHeader(headers[ic])) idCols.push(ic);
    }
    if (idCols.length) {
      for (var dr = 0; dr < visibleRows; dr++) {
        var keyParts = [];
        for (var di = 0; di < idCols.length; di++) keyParts.push(String(data[dr][idCols[di]] || "").trim());
        var key = keyParts.join("|");
        if (!key) continue;
        if (seenKeys[key]) dupCount++;
        else seenKeys[key] = 1;
      }
    }

    numericStats.sort(function (a, b) { return b.score - a.score; });
    var topStats = numericStats.slice(0, 3);

    var statusPairs = [];
    var topStatus = "";
    if ((!userConfig || userConfig.showStatusInsights) && statusColIndex >= 0) {
      statusPairs = Object.keys(statusCounts).map(function (k) { return { k: k, v: statusCounts[k] }; });
      statusPairs.sort(function (a, b) { return b.v - a.v; });
      topStatus = statusPairs.slice(0, 3).map(function (x) {
        var pct = pctNum(x.v, visibleRows);
        return x.k + ": " + fmtNum(x.v) + " (" + fmtNum(pct) + "%)";
      }).join(" | ");
    }

    var selectedInsight = null;
    var html = [];
    html.push("<div class='tm-summary-title'>Subtotais e insights</div>");
    html.push("<div class='tm-summary-grid'>");
    html.push("<div class='tm-summary-item'><b>Linhas visíveis:</b> " + fmtNum(visibleRows) + "</div>");
    html.push("<div class='tm-summary-item'><b>Colunas:</b> " + fmtNum(totalCols) + "</div>");
    html.push("<div class='tm-summary-item'><b>Células não vazias:</b> " + fmtNum(nonEmpty) + "</div>");
    html.push("<div class='tm-summary-item'><b>% nulos:</b> " + fmtNum((nullCells / Math.max(1, visibleRows * totalCols)) * 100) + "%</div>");
    html.push("<div class='tm-summary-item'><b>Colunas de valor (numéricas):</b> " + fmtNum(numericStats.length) + "</div>");
    html.push("<div class='tm-summary-item'><b>Duplicidades (IDs):</b> " + fmtNum(dupCount) + "</div>");

    for (var i = 0; i < topStats.length; i++) {
      var st = topStats[i];
      html.push(
        "<div class='tm-summary-item'><b>" + escapeHtml(st.name || ("Coluna " + (i + 1))) + ":</b> Σ " + fmtNum(st.sum) +
        " | μ " + fmtNum(st.avg) + " | min " + fmtNum(st.min) + " | max " + fmtNum(st.max) + "</div>"
      );
    }
    if (!topStats.length) {
      html.push("<div class='tm-summary-item'><b>Insights de valor:</b> nenhuma coluna de valor numérica encontrada.</div>");
    }

    if ((!userConfig || userConfig.showStatusInsights) && statusColIndex >= 0) {
      var statusPairs = Object.keys(statusCounts).map(function (k) { return { k: k, v: statusCounts[k] }; });
      statusPairs.sort(function (a, b) { return b.v - a.v; });
      var topStatus = statusPairs.slice(0, 3).map(function (x) {
        var pct = (x.v / Math.max(1, visibleRows)) * 100;
        return escapeHtml(x.k) + ": " + fmtNum(x.v) + " (" + fmtNum(pct) + "%)";
      }).join(" | ");
      html.push("<div class='tm-summary-item'><b>Status (top):</b> " + (topStatus || "sem dados") + "</div>");
    }

    if (selectedColIndex != null && selectedColIndex > 0 && table.rows[0] && table.rows[0].cells[selectedColIndex]) {
      var colName = getHeaderText(table.rows[0].cells[selectedColIndex]) || ("Coluna " + selectedColIndex);
      var colVals = [];
      var colNumCount = 0, colNumSum = 0, colNumMin = null, colNumMax = null;
      var freq = {};

      for (var rr = 2; rr < table.rows.length; rr++) {
        var rw = table.rows[rr];
        if (!rw || rw.style.display === "none") continue;
        var cell = rw.cells[selectedColIndex];
        var txt = ((cell && cell.innerText) ? String(cell.innerText) : "").trim();
        if (!txt) continue;
        colVals.push(txt);
        freq[txt] = (freq[txt] || 0) + 1;
        var nn = parseLocaleNumber(txt);
        if (!isNaN(nn)) {
          colNumCount++;
          colNumSum += nn;
          colNumMin = (colNumMin == null) ? nn : Math.min(colNumMin, nn);
          colNumMax = (colNumMax == null) ? nn : Math.max(colNumMax, nn);
        }
      }

      var uniqueCount = Object.keys(freq).length;
      var topValues = Object.keys(freq).map(function (k) { return { k: k, v: freq[k] }; })
        .sort(function (a, b) { return b.v - a.v; })
        .slice(0, 3)
        .map(function (x) { return escapeHtml(x.k) + " (" + fmtNum(x.v) + ")"; })
        .join(" | ");

      html.push("<div class='tm-summary-item'><b>Coluna selecionada:</b> " + escapeHtml(colName) + "</div>");
      html.push("<div class='tm-summary-item'><b>Não vazios:</b> " + fmtNum(colVals.length) + " | <b>Distintos:</b> " + fmtNum(uniqueCount) + "</div>");
      if (colNumCount > 0) {
        html.push("<div class='tm-summary-item'><b>Numérico:</b> Σ " + fmtNum(colNumSum) + " | μ " + fmtNum(colNumSum / colNumCount) + " | min " + fmtNum(colNumMin) + " | max " + fmtNum(colNumMax) + "</div>");
      }
      if (topValues) html.push("<div class='tm-summary-item'><b>Top valores:</b> " + topValues + "</div>");
    }
    html.push("</div>");
    html.push("<div class='tm-summary-note'>Resumo calculado com base nas linhas atualmente visíveis (após filtros).</div>");
    renderModernInsightPanel(panel, {
      visibleRows: visibleRows,
      totalCols: totalCols,
      nonEmpty: nonEmpty,
      nullCells: nullCells,
      numericStats: numericStats,
      topStats: topStats,
      statusPairs: statusPairs,
      topStatus: topStatus,
      dupCount: dupCount,
      table: table
    });
  }

  function getSelectedColumnInsight(table) {
    if (!table || selectedColIndex == null || selectedColIndex <= 0 || !table.rows[0] || !table.rows[0].cells[selectedColIndex]) return null;
    var colName = getHeaderText(table.rows[0].cells[selectedColIndex]) || ("Coluna " + selectedColIndex);
    var values = [];
    var freq = {};
    var numCount = 0;
    var sum = 0;
    var min = null;
    var max = null;

    for (var rr = 2; rr < table.rows.length; rr++) {
      var row = table.rows[rr];
      if (!row || row.style.display === "none" || !row.cells[selectedColIndex]) continue;
      var raw = (row.cells[selectedColIndex].innerText || "").trim();
      if (!raw) continue;
      values.push(raw);
      freq[raw] = (freq[raw] || 0) + 1;
      var num = parseLocaleNumber(raw);
      if (!isNaN(num)) {
        numCount++;
        sum += num;
        min = min === null ? num : Math.min(min, num);
        max = max === null ? num : Math.max(max, num);
      }
    }

    var topValues = Object.keys(freq).map(function (key) {
      return { key: key, value: freq[key] };
    }).sort(function (a, b) {
      return b.value - a.value;
    }).slice(0, 5);

    return {
      name: colName,
      nonEmpty: values.length,
      unique: Object.keys(freq).length,
      numCount: numCount,
      sum: sum,
      avg: numCount ? sum / numCount : null,
      min: min,
      max: max,
      topValues: topValues
    };
  }

  function renderModernInsightPanel(panel, ctx) {
    var visibleRows = ctx.visibleRows || 0;
    var totalCols = ctx.totalCols || 0;
    var cellBase = Math.max(1, visibleRows * totalCols);
    var densityPct = pctNum(ctx.nonEmpty || 0, cellBase);
    var nullPct = pctNum(ctx.nullCells || 0, cellBase);
    var numericStats = ctx.numericStats || [];
    var topStats = ctx.topStats || numericStats.slice(0, 3);
    var statusPairs = ctx.statusPairs || [];
    var selected = getSelectedColumnInsight(ctx.table);
    var currentView = panel.dataset.tmInsightView || "overview";
    if (currentView === "status" && !statusPairs.length) currentView = "overview";
    if (currentView === "numbers" && !numericStats.length) currentView = "overview";
    if (currentView === "selected" && !selected) currentView = "overview";
    panel.dataset.tmInsightView = currentView;

    var reportLines = [
      "Insights do resultado",
      "Linhas visiveis: " + fmtNum(visibleRows),
      "Colunas visiveis: " + fmtNum(totalCols),
      "Preenchimento: " + fmtNum(densityPct) + "%",
      "Vazios/nulos: " + fmtNum(nullPct) + "%",
      "Duplicados pela primeira coluna: " + fmtNum(ctx.dupCount || 0)
    ];
    if (ctx.topStatus) reportLines.push("Status top: " + ctx.topStatus);
    if (selected) reportLines.push("Coluna selecionada: " + selected.name + " | " + fmtNum(selected.nonEmpty) + " preenchidos | " + fmtNum(selected.unique) + " distintos");

    var html = [];
    html.push("<div class='tm-insight-head'>");
    html.push("<div><div class='tm-insight-title'>Insights do resultado</div><div class='tm-insight-sub'>Resumo vivo das linhas visiveis, filtros e coluna selecionada</div></div>");
    html.push("<div class='tm-insight-actions'><button type='button' data-tm-insight-copy>Copiar resumo</button><button type='button' data-tm-insight-refresh>Atualizar</button></div>");
    html.push("</div>");

    html.push("<div class='tm-insight-tabs'>");
    html.push("<button type='button' data-tm-insight-view='overview' class='" + (currentView === "overview" ? "tm-active" : "") + "'>Visao geral</button>");
    html.push("<button type='button' data-tm-insight-view='status' class='" + (currentView === "status" ? "tm-active" : "") + "'" + (!statusPairs.length ? " disabled" : "") + ">Status</button>");
    html.push("<button type='button' data-tm-insight-view='numbers' class='" + (currentView === "numbers" ? "tm-active" : "") + "'" + (!numericStats.length ? " disabled" : "") + ">Numeros</button>");
    html.push("<button type='button' data-tm-insight-view='selected' class='" + (currentView === "selected" ? "tm-active" : "") + "'" + (!selected ? " disabled" : "") + ">Coluna selecionada</button>");
    html.push("</div>");

    html.push("<div class='tm-insight-body'>");
    html.push("<div class='tm-insight-view " + (currentView === "overview" ? "tm-active" : "") + "'>");
    html.push("<div class='tm-kpi-grid'>");
    html.push("<div class='tm-kpi'><div class='tm-kpi-label'>Linhas visiveis</div><div class='tm-kpi-value'>" + fmtNum(visibleRows) + "</div><div class='tm-kpi-note'>apos filtros aplicados</div></div>");
    html.push("<div class='tm-kpi'><div class='tm-kpi-label'>Colunas visiveis</div><div class='tm-kpi-value'>" + fmtNum(totalCols) + "</div><div class='tm-kpi-note'>considerando ocultas</div></div>");
    html.push("<div class='tm-kpi'><div class='tm-kpi-label'>Preenchimento</div><div class='tm-kpi-value'>" + fmtNum(densityPct) + "%</div><div class='tm-kpi-note'>" + fmtNum(ctx.nonEmpty || 0) + " celulas com valor</div></div>");
    html.push("<div class='tm-kpi'><div class='tm-kpi-label'>Vazios/nulos</div><div class='tm-kpi-value'>" + fmtNum(nullPct) + "%</div><div class='tm-kpi-note'>" + fmtNum(ctx.nullCells || 0) + " celulas</div></div>");
    html.push("</div>");
    html.push("<div class='tm-insight-list' style='margin-top:8px;'>");
    html.push("<div class='tm-insight-card'><div class='tm-insight-card-title'>Leitura rapida</div><div class='tm-insight-line'>Duplicados pela primeira coluna: <b>" + fmtNum(ctx.dupCount || 0) + "</b></div><div class='tm-insight-line'>Base analisada: <b>" + fmtNum(cellBase) + "</b> celulas visiveis</div></div>");
    if (topStats.length) {
      html.push("<div class='tm-insight-card'><div class='tm-insight-card-title'>Numeros em destaque</div>");
      topStats.forEach(function (st) {
        html.push("<div class='tm-insight-line'><b>" + escapeHtml(st.name) + ":</b> soma " + fmtNum(st.sum) + " | media " + fmtNum(st.avg) + "</div>");
      });
      html.push("</div>");
    } else {
      html.push("<div class='tm-insight-card'><div class='tm-insight-card-title'>Numeros em destaque</div><div class='tm-insight-line'>Nenhuma coluna numerica relevante nas linhas visiveis.</div></div>");
    }
    html.push("</div></div>");

    html.push("<div class='tm-insight-view " + (currentView === "status" ? "tm-active" : "") + "'>");
    if (statusPairs.length) {
      html.push("<div class='tm-insight-list'><div class='tm-insight-card'><div class='tm-insight-card-title'>Distribuicao de status</div>");
      statusPairs.slice(0, 8).forEach(function (item) {
        html.push(insightBar(item.k, item.v, visibleRows));
      });
      html.push("</div></div>");
    } else {
      html.push("<div class='tm-empty-state'>Nenhuma coluna de status detectada para esta consulta.</div>");
    }
    html.push("</div>");

    html.push("<div class='tm-insight-view " + (currentView === "numbers" ? "tm-active" : "") + "'>");
    if (numericStats.length) {
      html.push("<div class='tm-insight-list'>");
      numericStats.slice(0, 6).forEach(function (st) {
        html.push("<div class='tm-insight-card'><div class='tm-insight-card-title'>" + escapeHtml(st.name) + "</div>"
          + "<div class='tm-insight-line'>Soma: <b>" + fmtNum(st.sum) + "</b></div>"
          + "<div class='tm-insight-line'>Media: <b>" + fmtNum(st.avg) + "</b></div>"
          + "<div class='tm-insight-line'>Min/Max: <b>" + fmtNum(st.min) + "</b> / <b>" + fmtNum(st.max) + "</b></div>"
          + "<div class='tm-insight-line'>Valores numericos: <b>" + fmtNum(st.count) + "</b></div></div>");
      });
      html.push("</div>");
    } else {
      html.push("<div class='tm-empty-state'>Nenhuma coluna numerica relevante nas linhas visiveis.</div>");
    }
    html.push("</div>");

    html.push("<div class='tm-insight-view " + (currentView === "selected" ? "tm-active" : "") + "'>");
    if (selected) {
      html.push("<div class='tm-insight-list'><div class='tm-insight-card'><div class='tm-insight-card-title'>" + escapeHtml(selected.name) + "</div>"
        + "<div class='tm-insight-line'>Preenchidos: <b>" + fmtNum(selected.nonEmpty) + "</b></div>"
        + "<div class='tm-insight-line'>Distintos: <b>" + fmtNum(selected.unique) + "</b></div>");
      if (selected.numCount) {
        html.push("<div class='tm-insight-line'>Soma: <b>" + fmtNum(selected.sum) + "</b></div>"
          + "<div class='tm-insight-line'>Media: <b>" + fmtNum(selected.avg) + "</b></div>"
          + "<div class='tm-insight-line'>Min/Max: <b>" + fmtNum(selected.min) + "</b> / <b>" + fmtNum(selected.max) + "</b></div>");
      }
      html.push("</div><div class='tm-insight-card'><div class='tm-insight-card-title'>Valores mais frequentes</div>");
      if (selected.topValues.length) {
        selected.topValues.forEach(function (item) {
          html.push(insightBar(item.key, item.value, selected.nonEmpty));
        });
      } else {
        html.push("<div class='tm-insight-line'>Sem valores preenchidos nesta coluna.</div>");
      }
      html.push("</div></div>");
    } else {
      html.push("<div class='tm-empty-state'>Clique em uma coluna do resultado para ver uma analise contextual aqui.</div>");
    }
    html.push("</div>");
    html.push("</div>");
    html.push("<div class='tm-summary-note'>Resumo calculado com base nas linhas atualmente visiveis (apos filtros e colunas ocultas).</div>");

    panel.innerHTML = html.join("");
    panel.dataset.tmInsightReport = reportLines.join("\n");

    panel.querySelectorAll("[data-tm-insight-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        panel.dataset.tmInsightView = btn.getAttribute("data-tm-insight-view") || "overview";
        refreshSummaryPanel();
      });
    });
    var refreshBtn = panel.querySelector("[data-tm-insight-refresh]");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshSummaryPanel);
    var copyBtn = panel.querySelector("[data-tm-insight-copy]");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      reliableCopy(panel.dataset.tmInsightReport || "", function (ok) {
        showToast(ok ? "Resumo dos insights copiado." : "Nao foi possivel copiar o resumo.", ok ? null : true);
      });
    });
  }

  function buildAlignedTable(rows, sep) {
    var colCount = 0;
    for (var i = 0; i < rows.length; i++) colCount = Math.max(colCount, rows[i].length);

    var widths = new Array(colCount);
    for (var w = 0; w < colCount; w++) widths[w] = 0;

    for (var r = 0; r < rows.length; r++) {
      for (var j = 0; j < colCount; j++) {
        var v = (rows[r][j] == null) ? "" : String(rows[r][j]);
        widths[j] = Math.max(widths[j], v.length);
      }
    }

    var prettySep = " " + sep + " ";
    var lines = [];
    for (var rr = 0; rr < rows.length; rr++) {
      var parts = [];
      for (var jj = 0; jj < colCount; jj++) {
        var vv = (rows[rr][jj] == null) ? "" : String(rows[rr][jj]);
        parts.push(vv.padEnd(widths[jj] + COPY_PAD_EXTRA, " "));
      }
      lines.push(parts.join(prettySep).replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }

  function copyGridRespectingFilter(done) {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return done({ hasTable: false, copied: 0, ok: false });

    var table = divScroll.querySelector("table");
    if (!table) return done({ hasTable: false, copied: 0, ok: false });

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    var dataLinesCopied = Math.max(0, rows.length - 1);
    var asTable = userConfig ? !!userConfig.copyAsTable : COPY_AS_TABLE;
    var text = asTable
      ? buildAlignedTable(rows, COPY_SEPARATOR_DEFAULT)
      : rows.map(function (r) { return r.join(COPY_SEPARATOR_DEFAULT); }).join("\n");

    reliableCopy(text, function (ok) { done({ hasTable: true, copied: dataLinesCopied, ok: ok }); });
  }

  function exportCSVRespectingFilter() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return alert("Não há área de resultado (divScroll).");

    var table = divScroll.querySelector("table");
    if (!table) return alert("Não há dados para exportar.");

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) return alert("Não há linhas visíveis para exportar (filtro pode estar removendo tudo).");

    var separator = getCsvSeparator();
    var csvLines = rows.map(function (r) {
      return r.map(function (cell) {
        var v = (cell || "").replace(/"/g, '""');
        return '"' + v + '"';
      }).join(separator);
    });

    downloadBlob("consulta_" + tsStamp() + ".csv", "text/csv;charset=utf-8;", "\uFEFF" + csvLines.join("\n"));
  }

  function exportHTMLRespectingFilter() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return alert("Não há área de resultado (divScroll).");

    var table = divScroll.querySelector("table");
    if (!table) return alert("Não há dados para exportar.");

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) return alert("Não há linhas visíveis para exportar (filtro pode estar removendo tudo).");

    var html = [];
    html.push("<!doctype html><html><head><meta charset='utf-8'>");
    html.push("<title>Export consulta</title>");
    html.push("<style>table{border-collapse:collapse;font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px}th,td{border:1px solid #ccc;padding:6px 8px;white-space:nowrap}th{background:#f4f4f4}</style>");
    html.push("</head><body>");
    html.push("<table><thead><tr>");
    for (var c = 0; c < rows[0].length; c++) html.push("<th>" + escapeHtml(rows[0][c]) + "</th>");
    html.push("</tr></thead><tbody>");
    for (var r = 1; r < rows.length; r++) {
      html.push("<tr>");
      for (var cc = 0; cc < rows[r].length; cc++) html.push("<td>" + escapeHtml(rows[r][cc]) + "</td>");
      html.push("</tr>");
    }
    html.push("</tbody></table></body></html>");

    downloadBlob("consulta_" + tsStamp() + ".html", "text/html;charset=utf-8;", html.join(""));
  }

  function exportTXTRespectingFilter() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return alert("Não há área de resultado (divScroll).");

    var table = divScroll.querySelector("table");
    if (!table) return alert("Não há dados para exportar.");

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) return alert("Não há linhas visíveis para exportar (filtro pode estar removendo tudo).");

    var asTable = userConfig ? !!userConfig.copyAsTable : COPY_AS_TABLE;
    var txt = asTable
      ? buildAlignedTable(rows, COPY_SEPARATOR_DEFAULT)
      : rows.map(function (r) { return r.join(COPY_SEPARATOR_DEFAULT); }).join("\n");

    downloadBlob("consulta_" + tsStamp() + ".txt", "text/plain;charset=utf-8;", txt);
  }

  function exportXLSXRespectingFilter() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return alert("Não há área de resultado (divScroll).");

    var table = divScroll.querySelector("table");
    if (!table) return alert("Não há dados para exportar.");

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) return alert("Não há linhas visíveis para exportar (filtro pode estar removendo tudo).");

    if (!window.XLSX || !window.XLSX.utils) {
      return alert(
        "Biblioteca XLSX não carregou (possível bloqueio de CDN).\n\n" +
        "Verifique se o acesso ao cdn.jsdelivr.net está liberado, ou solicite uma versão offline ao administrador."
      );
    }

    try {
      var wb = window.XLSX.utils.book_new();
      var ws = window.XLSX.utils.aoa_to_sheet(rows);
      window.XLSX.utils.book_append_sheet(wb, ws, "Consulta");
      window.XLSX.writeFile(wb, "consulta_" + tsStamp() + ".xlsx");
    } catch (e) {
      alert("Falha ao gerar XLSX: " + (e && e.message ? e.message : e));
    }
  }

  function buildResultCanvas() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return null;

    var table = divScroll.querySelector("table");
    if (!table) return null;

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var rows = getExportRows(table, { includeHeader: true, includeFilterRow: false, includeIndexCol: false });
    if (rows.length <= 1) return null;

    var SCALE = 2;
    var FONT_SIZE = UI_FONT_SIZE_PX;
    var CELL_PAD_X = 10;
    var CELL_PAD_Y = 7;
    var ROW_H = FONT_SIZE + CELL_PAD_Y * 2;
    var FONT = FONT_SIZE + "px " + UI_FONT_FAMILY;
    var FONT_BOLD = "bold " + FONT;

    var probe = document.createElement("canvas").getContext("2d");
    probe.font = FONT_BOLD;

    var colCount = rows[0].length;
    var colWidths = new Array(colCount).fill(0);

    for (var r = 0; r < rows.length; r++) {
      probe.font = (r === 0) ? FONT_BOLD : FONT;
      for (var c = 0; c < colCount; c++) {
        var w = probe.measureText(String(rows[r][c] == null ? "" : rows[r][c])).width + CELL_PAD_X * 2;
        if (w > colWidths[c]) colWidths[c] = w;
      }
    }

    var totalW = colWidths.reduce(function (a, b) { return a + b; }, 0);
    var totalH = rows.length * ROW_H;

    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(totalW * SCALE);
    canvas.height = Math.ceil(totalH * SCALE);

    var ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, totalW, totalH);

    for (var ri = 0; ri < rows.length; ri++) {
      var isHeader = (ri === 0);
      var y = ri * ROW_H;
      var x = 0;

      for (var ci = 0; ci < colCount; ci++) {
        var cw = colWidths[ci];
        var cellVal = String(rows[ri][ci] == null ? "" : rows[ri][ci]);

        ctx.fillStyle = isHeader ? "#e8e8e8" : (ri % 2 === 0 ? "#f7f7f7" : "#ffffff");
        ctx.fillRect(x, y, cw, ROW_H);

        ctx.strokeStyle = "#cccccc";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.25, y + 0.25, cw - 0.5, ROW_H - 0.5);

        ctx.fillStyle = "#111111";
        ctx.font = isHeader ? FONT_BOLD : FONT;
        ctx.textBaseline = "middle";
        ctx.fillText(cellVal, x + CELL_PAD_X, y + ROW_H / 2, cw - CELL_PAD_X * 2);

        x += cw;
      }
    }

    return canvas;
  }

  function saveAsJPG() {
    var canvas = buildResultCanvas();
    if (!canvas) return alert("Não há dados visíveis para exportar.");

    canvas.toBlob(function (blob) {
      if (navigator.msSaveOrOpenBlob) {
        navigator.msSaveOrOpenBlob(blob, "consulta_" + tsStamp() + ".jpg");
        showToast("JPG salvo!");
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "consulta_" + tsStamp() + ".jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("JPG salvo!");
    }, "image/jpeg", 0.95);
  }

  function copyAsImage() {
    var canvas = buildResultCanvas();
    if (!canvas) return alert("Não há dados visíveis para copiar.");

    showToast("Preparando imagem...");
    var dataUrl = canvas.toDataURL("image/png");

    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      canvas.toBlob(function (blob) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
          .then(function () { showToast("Imagem copiada!"); })
          .catch(function () { abrirPopupImagem(dataUrl); });
      }, "image/png");
      return;
    }

    abrirPopupImagem(dataUrl);
  }

  function abrirPopupImagem(dataUrl) {
    var win = window.open("", "_blank", "width=900,height=600,scrollbars=yes");
    if (!win) return alert("Popup bloqueado. Permita popups para esta página e tente novamente.");

    win.document.write([
      "<!doctype html><html><head><meta charset='utf-8'>",
      "<title>Copiar imagem</title>",
      "<style>",
      "body{margin:0;background:#1e1e1e;display:flex;flex-direction:column;align-items:center;font-family:" + UI_FONT_FAMILY + ";font-size:" + UI_FONT_SIZE_PX + "px;}",
      "#msg{color:#fff;padding:10px 16px;background:#333;width:100%;box-sizing:border-box;text-align:center;}",
      "#msg b{color:#ffd966;}",
      "#img-wrap{padding:12px;overflow:auto;max-height:calc(100vh - 50px);}",
      "img{display:block;border:1px solid #555;cursor:default;user-select:none;}",
      "</style></head><body>",
      "<div id='msg'>Clique em <b>Copiar</b> ou clique com o botão direito na imagem → <b>Copiar imagem</b></div>",
      "<div id='img-wrap'><img id='result-img' src='" + dataUrl + "'></div>",
      "<script>",
      "var btn = document.createElement('button');",
      "btn.textContent = 'Copiar imagem';",
      "btn.style.cssText = 'position:fixed;bottom:14px;right:14px;padding:8px 18px;font-size:" + UI_FONT_SIZE_PX + "px;background:#ffd966;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-family:" + UI_FONT_FAMILY + ";';",
      "document.body.appendChild(btn);",
      "btn.onclick = function() {",
      " if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {",
      "  fetch(document.getElementById('result-img').src)",
      "   .then(function(r){ return r.blob(); })",
      "   .then(function(blob){ return navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); })",
      "   .then(function(){ btn.textContent = '✓ Copiado!'; btn.style.background='#8bc34a'; })",
      "   .catch(function(){ btn.textContent = 'Use botão direito → Copiar imagem'; });",
      " } else { btn.textContent = 'Use botão direito → Copiar imagem'; }",
      "};",
      "<\/script>",
      "</body></html>"
    ].join(""));

    win.document.close();
    win.focus();
  }

  function copyToTableExcel(done) {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return done(false);

    var table = divScroll.querySelector("table");
    if (!table) return done(false);

    if (!table.classList.contains("enhanced-grid")) processTable(table);

    var headerCells = Array.prototype.slice.call(table.rows[0].cells).slice(1);
    var headers = headerCells.map(function (th) { return getHeaderText(th); });

    var keep = [];
    for (var i = 0; i < headers.length; i++) if (!isSequenciaColumn(headers[i])) keep.push(i);

    var lines = [];
    var headerOut = [];
    for (var k = 0; k < keep.length; k++) headerOut.push(headers[keep[k]]);
    lines.push(headerOut.join(TABLE_SEPARATOR));

    for (var r = 2; r < table.rows.length; r++) {
      var row = table.rows[r];
      if (row.style.display === "none") continue;

      var cells = Array.prototype.slice.call(row.cells).slice(1);
      var out = [];
      for (var kk = 0; kk < keep.length; kk++) {
        var idx = keep[kk];
        var v = (cells[idx] && cells[idx].innerText) ? String(cells[idx].innerText).trim() : "";
        out.push(v);
      }
      lines.push(out.join(TABLE_SEPARATOR));
    }

    reliableCopy(lines.join("\n"), function (ok) { done(ok); });
  }

  function resetGridCustomizations() {
    if (!userConfig) userConfig = loadConfig();
    if (userConfig.confirmReset) {
      var okReset = window.confirm("Deseja realmente resetar filtros, layout e colunas ocultas?");
      if (!okReset) return;
    }

    var table = getMainTableForResize();
    var shell = ensureGridShell();

    if (table && table.rows[1] && table.rows[1].classList.contains("filter-row")) {
      var inputs = table.rows[1].querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) inputs[i].value = "";
      for (var r = 2; r < table.rows.length; r++) table.rows[r].style.display = "";
    }

    clearSelectionStyles(table);
    selectedCell = null;
    selectedRowEl = null;
    selectedColIndex = null;

    setHiddenColsSet({});
    if (table) {
      restoreOriginalRowOrder(table);
      for (var rr = 2; rr < table.rows.length; rr++) {
        table.rows[rr].classList.remove("tm-highlight-row", "tm-pinned-row");
      }
      delete table.dataset.tmSortCol;
      delete table.dataset.tmSortDir;
      renderHeaderSortControls(table);
      applyHiddenColumns(table);
    }

    StorageService.remove(GRID_SHELL_KEY_SIZE);
    StorageService.remove(GRID_SHELL_KEY_SIZE_LEGACY);
    if (shell) {
      shell.style.width = "100%";
      shell.style.height = GRID_HEIGHT_DEFAULT + "px";
      clampGridShellSize(shell);
      persistGridShellSize(shell);
    }

    refreshSummaryPanel();
    showToast("Layout e filtros resetados");
  }

  function getGridIconSvg(iconName) {
    var icons = {
      copy: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='5' y='4' width='8' height='9' rx='1'></rect><path d='M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10'></path></svg>",
      export: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M4 2.5h5l3 3v8H4z'></path><path d='M9 2.5v3h3M6 10.5h4M8 7v4M6.5 9.5L8 11l1.5-1.5'></path></svg>",
      columns: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='2.5' y='3' width='11' height='10' rx='1.5'></rect><path d='M6 3v10M10 3v10M2.5 6.5h11'></path></svg>",
      filter: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M3 3.5h10l-4 4.6v3.4l-2 1V8.1z'></path><path d='M10.8 10.8l2.4 2.4M13.2 10.8l-2.4 2.4'></path></svg>",
      layout: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='3' y='3' width='10' height='10' rx='1.5'></rect><path d='M6 3v10M3 7h10M8.5 10.5l2 2M10.5 10.5v2h-2'></path></svg>",
      settings: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'></path><path d='M8 2.5v1.3M8 12.2v1.3M3.2 5.2l1.1.7M11.7 10.1l1.1.7M3.2 10.8l1.1-.7M11.7 5.9l1.1-.7'></path></svg>",
      reset: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M4.2 5.2A4.8 4.8 0 1 1 3.4 9'></path><path d='M4 2.8v2.6h2.6'></path></svg>",
      image: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='2.5' y='3' width='11' height='10' rx='1.5'></rect><path d='M4.5 10l2.2-2.2 1.8 1.8 1.2-1.2 1.8 1.8'></path><circle cx='10.5' cy='5.8' r='.8'></circle></svg>"
    };
    return icons[iconName] || icons.copy;
  }

  function setIconButtonLabel(button, label) {
    var labelEl = button.querySelector(".sql-btn-label");
    if (labelEl) labelEl.textContent = label;
    else button.textContent = label;
    button.title = label;
  }

  function openConfigPanel() {
    if (!userConfig) userConfig = loadConfig();

    var backdrop = document.createElement("div");
    backdrop.className = "tm-cfg-backdrop";
    var modal = document.createElement("div");
    modal.className = "tm-cfg-modal";

    function mkCheck(label, key) {
      var row = document.createElement("label");
      row.className = "tm-cfg-item tm-toggle";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!userConfig[key];
      cb.dataset.key = key;
      var sp = document.createElement("span");
      sp.textContent = label;
      row.appendChild(sp);
      row.appendChild(cb);
      return row;
    }

    function mkSelect(label, key, options) {
      var row = document.createElement("label");
      row.className = "tm-cfg-item";
      var sp = document.createElement("span");
      sp.textContent = label;
      var sel = document.createElement("select");
      sel.dataset.selectKey = key;
      for (var i = 0; i < options.length; i++) {
        var op = document.createElement("option");
        op.value = String(options[i].value);
        op.textContent = options[i].label;
        if (String(userConfig[key]) === String(options[i].value)) op.selected = true;
        sel.appendChild(op);
      }
      row.appendChild(sp);
      row.appendChild(sel);
      return row;
    }

    modal.innerHTML = "<div class='tm-cfg-title'>Configurações do Grid Pro</div>";
    modal.innerHTML += "<div class='tm-cfg-subtitle'>Geral</div>";
    modal.appendChild(mkCheck("Mostrar painel de subtotais/insights", "showInsights"));
    modal.appendChild(mkCheck("Mostrar insights de status", "showStatusInsights"));
    modal.appendChild(mkCheck("Atualizar insights enquanto digita filtro", "autoRefreshInsightsOnFilter"));
    modal.appendChild(mkCheck("Atalho Ctrl+C para seleção do grid", "enableShortcuts"));
    modal.appendChild(mkCheck("Copiar grid como tabela alinhada", "copyAsTable"));
    modal.appendChild(mkCheck("Mostrar toasts", "showToasts"));
    modal.appendChild(mkSelect("Tamanho do toast", "toastScale", [
      { value: 1.2, label: "Pequeno" },
      { value: 1.4, label: "Médio" },
      { value: 1.6, label: "Grande" },
      { value: 1.8, label: "Muito grande" },
      { value: 2.0, label: "Gigante" }
    ]));
    modal.appendChild(mkSelect("Tempo do toast", "toastDurationMs", [
      { value: 1500, label: "1,5 segundos" },
      { value: 2500, label: "2,5 segundos" },
      { value: 3500, label: "3,5 segundos" },
      { value: 5000, label: "5 segundos" }
    ]));
    modal.appendChild(mkSelect("Separador do CSV", "csvSeparator", [
      { value: ";", label: "Ponto e vírgula (;)" },
      { value: ",", label: "Vírgula (,)" },
      { value: "\t", label: "Tabulação" },
      { value: "|", label: "Barra vertical (|)" }
    ]));
    modal.appendChild(mkCheck("Confirmar reset completo", "confirmReset"));

    var toolbarBtns = actionBarEl ? actionBarEl.querySelectorAll("button[data-tm-btn]") : [];
    if (toolbarBtns.length) {
      var subt = document.createElement("div");
      subt.className = "tm-cfg-subtitle";
      subt.textContent = "Botões da toolbar";
      modal.appendChild(subt);

      for (var b = 0; b < toolbarBtns.length; b++) {
        var btn = toolbarBtns[b];
        var key = btn.dataset.tmBtn;
        if (!key || key === "cfg") continue;
        var row = document.createElement("label");
        row.className = "tm-cfg-item tm-toggle";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !isToolbarButtonHidden(key);
        cb.dataset.toolbarKey = key;
        var sp = document.createElement("span");
        sp.textContent = "Mostrar: " + (btn.dataset.tmLabel || btn.textContent || key);
        row.appendChild(sp);
        row.appendChild(cb);
        modal.appendChild(row);
      }
    }

    var actions = document.createElement("div");
    actions.className = "tm-cfg-actions";
    var btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancelar";
    var btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.textContent = "Salvar";
    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    btnCancel.onclick = function () {
      backdrop.parentNode.removeChild(backdrop);
    };

    btnSave.onclick = function () {
      var next = loadConfig();
      var cbs = modal.querySelectorAll("input[type='checkbox'][data-key]");
      for (var i = 0; i < cbs.length; i++) next[cbs[i].dataset.key] = !!cbs[i].checked;
      var sels = modal.querySelectorAll("select[data-select-key]");
      for (var s = 0; s < sels.length; s++) {
        var sk = sels[s].dataset.selectKey;
        var raw = sels[s].value;
        next[sk] = sk === "csvSeparator" ? raw : Number(raw);
      }
      var toolbarCbs = modal.querySelectorAll("input[type='checkbox'][data-toolbar-key]");
      next.hiddenToolbarButtons = next.hiddenToolbarButtons || {};
      for (var t = 0; t < toolbarCbs.length; t++) {
        var tKey = toolbarCbs[t].dataset.toolbarKey;
        next.hiddenToolbarButtons[tKey] = !toolbarCbs[t].checked;
      }
      userConfig = next;
      saveConfig(userConfig);
      backdrop.parentNode.removeChild(backdrop);
      applyToolbarButtonVisibility();
      refreshSummaryPanel();
      showToast("Configurações salvas");
    };

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) backdrop.parentNode.removeChild(backdrop);
    });
  }

  function openConfigPanelModern() {
    if (!userConfig) userConfig = loadConfig();

    var backdrop = document.createElement("div");
    backdrop.className = "tm-cfg-backdrop";

    var modal = document.createElement("div");
    modal.className = "tm-cfg-modal";

    function closePanel() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function mkCheck(label, key) {
      var row = document.createElement("label");
      row.className = "tm-cfg-item tm-toggle";
      var sp = document.createElement("span");
      sp.textContent = label;
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!userConfig[key];
      cb.dataset.key = key;
      row.appendChild(sp);
      row.appendChild(cb);
      return row;
    }

    function mkSelect(label, key, options) {
      var row = document.createElement("label");
      row.className = "tm-cfg-item";
      var sp = document.createElement("span");
      sp.textContent = label;
      var sel = document.createElement("select");
      sel.dataset.selectKey = key;
      for (var i = 0; i < options.length; i++) {
        var op = document.createElement("option");
        op.value = String(options[i].value);
        op.textContent = options[i].label;
        if (String(userConfig[key]) === String(options[i].value)) op.selected = true;
        sel.appendChild(op);
      }
      row.appendChild(sp);
      row.appendChild(sel);
      return row;
    }

    function mkCard(titleText, hintText, rows, extraClass) {
      var card = document.createElement("section");
      card.className = "tm-cfg-card";
      if (extraClass) card.classList.add(extraClass);
      var titleEl = document.createElement("h3");
      titleEl.textContent = titleText;
      card.appendChild(titleEl);
      if (hintText) {
        var hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = hintText;
        card.appendChild(hint);
      }
      for (var i = 0; i < rows.length; i++) card.appendChild(rows[i]);
      return card;
    }

    var head = document.createElement("div");
    head.className = "tm-cfg-head";
    var headText = document.createElement("div");
    var title = document.createElement("div");
    title.className = "tm-cfg-title";
    title.textContent = "Configurações do Grid Pro";
    var sub = document.createElement("div");
    sub.className = "tm-cfg-sub";
    sub.textContent = "Organize a visualização, a toolbar e os avisos do resultado.";
    headText.appendChild(title);
    headText.appendChild(sub);
    var btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = "Fechar";
    btnClose.onclick = closePanel;
    head.appendChild(headText);
    head.appendChild(btnClose);
    modal.appendChild(head);

    var body = document.createElement("div");
    body.className = "tm-cfg-body";

    body.appendChild(mkCard("Experiência", "Controles que afetam leitura, filtros e seleção.", [
      mkCheck("Mostrar painel de insights", "showInsights"),
      mkCheck("Mostrar insights de status", "showStatusInsights"),
      mkCheck("Atualizar insights ao filtrar", "autoRefreshInsightsOnFilter"),
      mkCheck("Atalho Ctrl+C na seleção", "enableShortcuts")
    ], "tm-primary"));

    body.appendChild(mkCard("Aparência", "Ajustes visuais da ribbon e das notificações.", [
      mkCheck("Mostrar ícones nos botões", "showToolbarIcons"),
      mkCheck("Mostrar toasts", "showToasts"),
      mkSelect("Tamanho do toast", "toastScale", [
        { value: 1.2, label: "Pequeno" },
        { value: 1.4, label: "Médio" },
        { value: 1.6, label: "Grande" },
        { value: 1.8, label: "Muito grande" },
        { value: 2.0, label: "Gigante" }
      ]),
      mkSelect("Tempo do toast", "toastDurationMs", [
        { value: 1500, label: "1,5 segundos" },
        { value: 2500, label: "2,5 segundos" },
        { value: 3500, label: "3,5 segundos" },
        { value: 5000, label: "5 segundos" }
      ])
    ]));

    body.appendChild(mkCard("Cópia e reset", "Preferências que afetam saída copiada e ações sensíveis.", [
      mkCheck("Copiar grid como tabela alinhada", "copyAsTable"),
      mkCheck("Confirmar reset completo", "confirmReset")
    ]));

    body.appendChild(mkCard("Exportação CSV", "Defina como as colunas serão separadas no arquivo exportado.", [
      mkSelect("Separador do CSV", "csvSeparator", [
        { value: ";", label: "Ponto e vírgula (;)" },
        { value: ",", label: "Vírgula (,)" },
        { value: "\t", label: "Tabulação" },
        { value: "|", label: "Barra vertical (|)" }
      ])
    ]));

    var toolbarBtns = actionBarEl ? actionBarEl.querySelectorAll("button[data-tm-btn]") : [];
    if (toolbarBtns.length) {
      var toggleGrid = document.createElement("div");
      toggleGrid.className = "tm-cfg-toggle-grid";

      for (var b = 0; b < toolbarBtns.length; b++) {
        var btn = toolbarBtns[b];
        var key = btn.dataset.tmBtn;
        if (!key || key === "cfg") continue;

        var row = document.createElement("label");
        row.className = "tm-cfg-item tm-toggle";
        var sp = document.createElement("span");
        sp.textContent = btn.dataset.tmLabel || btn.textContent || key;
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !isToolbarButtonHidden(key);
        cb.dataset.toolbarKey = key;
        row.appendChild(sp);
        row.appendChild(cb);
        toggleGrid.appendChild(row);
      }

      body.appendChild(mkCard("Botões da toolbar", "Marque apenas os comandos que você usa com frequência.", [toggleGrid], "tm-wide"));
    }

    modal.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "tm-cfg-actions";
    var leftActions = document.createElement("div");
    leftActions.className = "tm-cfg-actions-left";
    var rightActions = document.createElement("div");
    rightActions.className = "tm-cfg-actions-right";

    var btnDefaults = document.createElement("button");
    btnDefaults.type = "button";
    btnDefaults.textContent = "Restaurar padrão";
    btnDefaults.className = "tm-cfg-reset";

    var btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancelar";
    btnCancel.onclick = closePanel;

    var btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.textContent = "Salvar";
    btnSave.className = "tm-cfg-primary";
    leftActions.appendChild(btnDefaults);
    rightActions.appendChild(btnCancel);
    rightActions.appendChild(btnSave);
    actions.appendChild(leftActions);
    actions.appendChild(rightActions);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    btnDefaults.onclick = function () {
      if (!window.confirm("Restaurar as configurações padrão do Grid Pro?")) return;
      userConfig = defaultConfig();
      saveConfig(userConfig);
      closePanel();
      applyToolbarButtonVisibility();
      refreshSummaryPanel();
      showToast("Configurações padrão restauradas");
    };

    btnSave.onclick = function () {
      var next = loadConfig();
      var cbs = modal.querySelectorAll("input[type='checkbox'][data-key]");
      for (var i = 0; i < cbs.length; i++) next[cbs[i].dataset.key] = !!cbs[i].checked;

      var sels = modal.querySelectorAll("select[data-select-key]");
      for (var s = 0; s < sels.length; s++) {
        var selectKey = sels[s].dataset.selectKey;
        next[selectKey] = selectKey === "csvSeparator" ? sels[s].value : Number(sels[s].value);
      }

      var toolbarCbs = modal.querySelectorAll("input[type='checkbox'][data-toolbar-key]");
      next.hiddenToolbarButtons = next.hiddenToolbarButtons || {};
      for (var t = 0; t < toolbarCbs.length; t++) {
        next.hiddenToolbarButtons[toolbarCbs[t].dataset.toolbarKey] = !toolbarCbs[t].checked;
      }

      userConfig = next;
      saveConfig(userConfig);
      closePanel();
      applyToolbarButtonVisibility();
      refreshSummaryPanel();
      showToast("Configurações salvas");
    };

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closePanel();
    });
  }

  // ===================================================================
  // ACTION BAR
  // ===================================================================
  function ensureInlineActionBar() {
    var divScroll = document.getElementById("divScroll");
    if (!divScroll) return;

    ensureAccordion();
    if (!accBodyEl) return;

    var shell = ensureGridShell();
    if (!shell) return;

    if (actionBarEl && document.body.contains(actionBarEl)) {
      if (actionBarEl.parentNode !== accBodyEl) {
        accBodyEl.insertBefore(actionBarEl, accBodyEl.firstChild);
      } else if (accBodyEl.firstChild !== actionBarEl) {
        accBodyEl.insertBefore(actionBarEl, accBodyEl.firstChild);
      }
      applyToolbarButtonVisibility();
      return;
    }

    var old = document.querySelector(".tm-actionbar");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    actionBarEl = document.createElement("div");
    actionBarEl.className = "tm-actionbar";

    function mkBtn(label, onClick, iconName) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sql-icon-btn";
      if (iconName) b.classList.add("sql-icon-" + iconName);
      var icon = document.createElement("span");
      icon.className = "sql-btn-icon";
      icon.innerHTML = getGridIconSvg(iconName);
      var text = document.createElement("span");
      text.className = "sql-btn-label";
      b.appendChild(icon);
      b.appendChild(text);
      setIconButtonLabel(b, label);
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }, true);
      return b;
    }

    function tagBtn(btn, key, label) {
      btn.dataset.tmBtn = key;
      btn.dataset.tmLabel = label || btn.textContent || key;
      return btn;
    }

    function mkPipe() {
      var sp = document.createElement("span");
      sp.className = "tm-sep";
      sp.textContent = "|";
      return sp;
    }

    var btnCopyGrid = tagBtn(mkBtn("Copiar como grid", function () {
      copyGridRespectingFilter(function (res) {
        if (!res.hasTable) return alert("Tabela de resultado não encontrada.");
        if (!res.ok) return alert("Falha ao copiar (bloqueio do navegador).");
        showToast("Copiado como grid (" + res.copied + " linhas)");
      });
    }, "copy"), "copy_grid", "Copiar como grid");

    var btnCopyTable = tagBtn(mkBtn("Copiar para tabela", function () {
      copyToTableExcel(function (ok) {
        if (!ok) return alert("Falha ao copiar para tabela (sem grid ou bloqueio do navegador).");
        showToast("Copiado para tabela (Excel)");
      });
    }, "copy"), "copy_table", "Copiar para tabela");

    var btnCopyCell = tagBtn(mkBtn("Copiar Célula", function () {
      copySelectedCell(function (ok) {
        if (!selectedCell) return alert("Selecione uma célula (clique nela) antes.");
        if (!ok) alert("Falha ao copiar célula.");
        else showToast("Célula copiada");
      });
    }, "copy"), "copy_cell", "Copiar célula");

    var btnCopyCol = tagBtn(mkBtn("Copiar Coluna", function () {
      var table = divScroll.querySelector("table");
      if (selectedColIndex == null) return alert("Selecione uma coluna (clique no header) antes.");
      copySelectedColumn(table, function (ok) {
        if (!ok) alert("Falha ao copiar coluna.");
        else showToast("Coluna copiada");
      });
    }, "copy"), "copy_col", "Copiar coluna");

    var btnCopyRow = tagBtn(mkBtn("Copiar Linha", function () {
      var table = divScroll.querySelector("table");
      if (!selectedRowEl) return alert("Selecione uma célula (clique nela) para definir a linha.");
      copySelectedRow(table, function (ok) {
        if (!ok) alert("Falha ao copiar linha (linha não selecionada/visível).");
        else showToast("Linha copiada");
      });
    }, "copy"), "copy_row", "Copiar linha");

    var btnCsv = tagBtn(mkBtn("CSV", function () { exportCSVRespectingFilter(); }, "export"), "exp_csv", "Exportar CSV");
    var btnHtml = tagBtn(mkBtn("HTML", function () { exportHTMLRespectingFilter(); }, "export"), "exp_html", "Exportar HTML");
    var btnTxt = tagBtn(mkBtn("TXT", function () { exportTXTRespectingFilter(); }, "export"), "exp_txt", "Exportar TXT");
    var btnXlsx = tagBtn(mkBtn("XLSX", function () { exportXLSXRespectingFilter(); }, "export"), "exp_xlsx", "Exportar XLSX");
    var btnCols = tagBtn(mkBtn("Colunas", function () {
      var table = getMainTableForResize();
      if (!table) return alert("Tabela não encontrada.");
      promptHiddenColumns(table);
    }, "columns"), "cols_pick", "Colunas");
    var btnColsAll = tagBtn(mkBtn("Mostrar colunas", function () {
      var table = getMainTableForResize();
      if (!table) return alert("Tabela não encontrada.");
      clearHiddenColumns(table);
      showToast("Todas as colunas visíveis");
    }, "columns"), "cols_show", "Mostrar colunas");
    var btnClearFilters = tagBtn(mkBtn("Limpar filtros", function () {
      var table = getMainTableForResize();
      if (!table) return alert("Tabela não encontrada.");
      var hadFilter = clearTableFilters(table);
      showToast(hadFilter ? "Filtros limpos" : "Nenhum filtro ativo");
    }, "filter"), "clear_filters", "Limpar filtros");
    var btnRenameCol = tagBtn(mkBtn("Renomear coluna", function () {
      var table = getMainTableForResize();
      if (!table) return alert("Tabela não encontrada.");
      if (selectedColIndex == null || selectedColIndex <= 0) return alert("Selecione uma coluna (header) primeiro.");
      renameSelectedColumn(table);
    }, "columns"), "rename_col", "Renomear coluna");
    var btnSplitDate = tagBtn(mkBtn("Separar Data", function () {
      var table = getMainTableForResize();
      if (!table) return alert("Tabela não encontrada.");
      if (selectedColIndex == null) return alert("Selecione uma coluna de data primeiro.");
      var ok = addDateOnlyFromSelectedColumn(table, selectedColIndex);
      if (!ok) return alert("A coluna selecionada não parece ser data válida ou a coluna derivada já existe.");
      refreshSummaryPanel();
      showToast("Coluna de data separada adicionada");
    }, "columns"), "split_date", "Separar Data");
    var btnReset = tagBtn(mkBtn("Reset completo", function () {
      resetGridCustomizations();
    }, "reset"), "reset", "Reset completo");
    var btnSaveJPG = tagBtn(mkBtn("Salvar JPG", function () { saveAsJPG(); }, "image"), "exp_jpg", "Salvar JPG");
    var btnCopyImg = tagBtn(mkBtn("Copiar imagem", function () { copyAsImage(); }, "image"), "copy_img", "Copiar imagem");
    var btnFitRows50 = tagBtn(mkBtn("50 linhas", function () {
      autoResizeForFirstRows(50);
    }, "layout"), "fit_rows_50", "50 linhas");
    var btnFitCols20 = tagBtn(mkBtn("20 colunas", function () {
      autoResizeForFirstCols(20);
    }, "layout"), "fit_cols_20", "20 colunas");
    var btnFitW = tagBtn(mkBtn("Largura confortável", function () {
      var currentShell = ensureGridShell();
      if (!currentShell) return;
      var comfyW = Math.round(getGridUsableMaxWidth(currentShell) * 0.9);
      currentShell.style.width = Math.max(320, comfyW) + "px";
      clampGridShellSize(currentShell);
      persistGridShellSize(currentShell);
      showToast("Largura ajustada");
    }, "layout"), "fit_width", "Largura confortável");
    var btnFitH = tagBtn(mkBtn("Altura confortável", function () {
      var currentShell = ensureGridShell();
      if (!currentShell) return;
      currentShell.style.height = Math.min(GRID_HEIGHT_DEFAULT, getGridUsableMaxHeight()) + "px";
      clampGridShellSize(currentShell);
      persistGridShellSize(currentShell);
      showToast("Altura ajustada");
    }, "layout"), "fit_height", "Altura confortável");
    var resizeBlock = document.createElement("span");
    resizeBlock.className = "tm-grid-resize-block";
    var resizeTitle = document.createElement("span");
    resizeTitle.className = "tm-grid-resize-title";
    resizeTitle.textContent = "Resultado:";
    resizeBlock.appendChild(resizeTitle);
    resizeBlock.appendChild(btnFitRows50);
    resizeBlock.appendChild(btnFitCols20);
    resizeBlock.appendChild(btnFitW);
    resizeBlock.appendChild(btnFitH);

    function mkGroup(title, items) {
      var g = document.createElement("div");
      g.className = "tm-group";
      g.setAttribute("data-title", title);
      var t = document.createElement("div");
      t.className = "tm-group-title";
      t.textContent = title;
      var row = document.createElement("div");
      row.className = "tm-group-btns";
      for (var i = 0; i < items.length; i++) row.appendChild(items[i]);
      g.appendChild(t);
      g.appendChild(row);
      return g;
    }

    actionBarEl.appendChild(mkGroup("Copiar", [btnCopyGrid, btnCopyTable, btnCopyCell, btnCopyCol, btnCopyRow]));
    actionBarEl.appendChild(mkGroup("Exportar", [btnCsv, btnHtml, btnTxt, btnXlsx, btnSaveJPG, btnCopyImg]));
    actionBarEl.appendChild(mkGroup("Colunas", [btnCols, btnColsAll, btnClearFilters, btnRenameCol, btnSplitDate]));
    actionBarEl.appendChild(mkGroup("Layout", [resizeBlock, btnReset]));

    applyToolbarButtonVisibility();

    accBodyEl.insertBefore(actionBarEl, accBodyEl.firstChild);
  }

  // ===================================================================
  // RESIZE GRID
  // ===================================================================
  function ensureGridResizeHandles() {
    var shell = ensureGridShell();
    if (!shell) return;

    restoreGridShellSize(shell);
    if (!shell.style.height) shell.style.height = GRID_HEIGHT_DEFAULT + "px";
    clampGridShellSize(shell);

    if (shell.querySelector(".tm-grid-resize-handle")) return;

    shell.classList.add("tm-has-resize");

    var vHandle = document.createElement("div");
    var hHandle = document.createElement("div");
    var dHandle = document.createElement("div");
    vHandle.className = "tm-grid-resize-handle";
    hHandle.className = "tm-grid-resize-handle-x";
    dHandle.className = "tm-grid-resize-handle-diag";
    shell.appendChild(vHandle);
    shell.appendChild(hHandle);
    shell.appendChild(dHandle);

    var resizingV = false, resizingH = false;
    var startY = 0, startH = 0, startX = 0, startW = 0;

    function claimGridResize(e) {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "result-grid") return false;
      window.__tmActiveResizeSurface = "result-grid";
      document.body.style.userSelect = "none";
      if (e) {
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.preventDefault();
      }
      return true;
    }

    function startVertical(e) {
      if (!claimGridResize(e)) return;
      resizingV = true;
      startY = e.clientY;
      startH = shell.getBoundingClientRect().height;
    }

    function startHorizontal(e) {
      if (!claimGridResize(e)) return;
      resizingH = true;
      startX = e.clientX;
      startW = shell.getBoundingClientRect().width;
    }

    vHandle.addEventListener("mousedown", startVertical, true);
    hHandle.addEventListener("mousedown", startHorizontal, true);
    dHandle.addEventListener("mousedown", function (e) {
      if (!claimGridResize(e)) return;
      resizingV = true;
      startY = e.clientY;
      startH = shell.getBoundingClientRect().height;
      resizingH = true;
      startX = e.clientX;
      startW = shell.getBoundingClientRect().width;
    }, true);

    function onMove(e) {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "result-grid") return;
      if (!resizingV && !resizingH) return;

      if (resizingV) {
        var diffY = e.clientY - startY;
        var newH = Math.max(GRID_MIN_HEIGHT, Math.min(getGridUsableMaxHeight(), startH + diffY));
        shell.style.height = Math.round(newH) + "px";
      }

      if (resizingH) {
        var diffX = e.clientX - startX;
        var newW = Math.max(320, Math.min(getGridUsableMaxWidth(shell), startW + diffX));
        shell.style.width = Math.round(newW) + "px";
      }

      persistGridShellSize(shell);
      e.preventDefault();
    }

    function onUp() {
      if (window.__tmActiveResizeSurface && window.__tmActiveResizeSurface !== "result-grid") return;
      if (!resizingV && !resizingH) return;
      resizingV = false;
      resizingH = false;
      if (window.__tmActiveResizeSurface === "result-grid") window.__tmActiveResizeSurface = null;
      document.body.style.userSelect = "";
      clampGridShellSize(shell);
      persistGridShellSize(shell);
    }

    function onWindowResize() {
      clampGridShellSize(shell);
    }

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("resize", onWindowResize, true);
    vHandle.addEventListener("dblclick", function () {
      fitGridShellToPage(shell);
      showToast("Grid ajustado ao layout");
    });
    hHandle.addEventListener("dblclick", function () {
      fitGridShellToPage(shell);
      showToast("Grid ajustado ao layout");
    });
    dHandle.addEventListener("dblclick", function () {
      fitGridShellToPage(shell);
      showToast("Grid ajustado ao layout");
    });
  }

  // ===================================================================
  // KEYBOARD
  // ===================================================================
  function attachSelectionShortcuts() {
    if (window.__tmSelectionShortcutsAttached_gridOnly) return;
    window.__tmSelectionShortcutsAttached_gridOnly = true;

    window.addEventListener("keydown", function (e) {
      if (userConfig && !userConfig.enableShortcuts) return;
      var divScroll = document.getElementById("divScroll");
      if (!divScroll) return;
      var table = divScroll.querySelector("table");
      if (!table) return;

      var active = document.activeElement;
      var inEditor = active && active.closest && active.closest(".CodeMirror");
      if (inEditor) return;

      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
        if (selectedColIndex != null) {
          e.preventDefault();
          copySelectedColumn(table, function (ok) { if (ok) showToast("Coluna copiada"); });
          return;
        }
        if (selectedCell) {
          e.preventDefault();
          copySelectedCell(function (ok) { if (ok) showToast("Célula copiada"); });
        }
      }
    }, true);
  }

  // ===================================================================
  // ASP.NET AJAX endRequest
  // ===================================================================
  function hookAspNetEndRequest() {
    if (aspnetHooked) return;
    aspnetHooked = true;

    try {
      var prm = window.Sys && window.Sys.WebForms && window.Sys.WebForms.PageRequestManager
        ? window.Sys.WebForms.PageRequestManager.getInstance()
        : null;

      if (!prm || prm._tmHookedGridJourney) return;
      prm._tmHookedGridJourney = true;

      prm.add_endRequest(function () {
        clearSessionColumnRenames();
        scheduleStart();
      });
    } catch (_) {}
  }

  // ===================================================================
  // START
  // ===================================================================
  function start() {
    if (!userConfig) userConfig = loadConfig();
    clearPersistedColumnRenames();
    injectCSSOnce();
    hookAspNetEndRequest();
    attachSelectionShortcuts();

    ensureAccordion();
    ensureGridShell();
    enhanceGrid();
    ensureInlineActionBar();
    ensureGridResizeHandles();
    refreshSummaryPanel();
    applyAccordionStateExternal();
  }

  start();
  var initAttempts = 0;
  var timer = setInterval(function () {
    initAttempts++;
    start();
    if (document.querySelector(".tm-accordion") && PageAdapter.hasResultArea()) {
      clearInterval(timer);
    }
    if (initAttempts > 90) {
      clearInterval(timer);
    }
  }, 400);

})();

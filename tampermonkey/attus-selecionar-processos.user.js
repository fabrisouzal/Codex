// ==UserScript==
// @name         ATTUS - Selecionar Processos
// @namespace    http://tampermonkey.net/
// @version      2026-06-29.02
// @description  Adiciona um painel flutuante para selecionar rapidamente os cards visiveis do resultado de consulta de processos.
// @author       Fabricio
// @compatible   edge
// @match        https://attus.pge.sp.gov.br/*
// @match        https://homologacao.attus.pge.sp.gov.br/*
// @match        https://pgesp.attus.ai/*
// @match        https://*.attus.pge.sp.gov.br/*
// @match        https://*.attus.ai/*
// @include      https://attus.pge.sp.gov.br/*
// @include      https://pgesp.attus.ai/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/attus-selecionar-processos.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/attus-selecionar-processos.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-attus-selecionar-processos';
  const STYLE_ID = `${PANEL_ID}-style`;
  const UPDATE_DELAY_MS = 160;
  const CLICK_DELAY_MS = 45;
  const PROCESS_TEXT_RE = /\bProcesso eletr|\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b|\b\d{4}\.\d{2}\.\d{6}\b/i;

  let updateTimer = 0;
  let busy = false;

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
  }

  function textOf(element) {
    return (element && element.textContent ? element.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function isProcessesPage() {
    const pathLooksRight = /process/i.test(location.pathname + location.hash + location.search);
    const titleLooksRight = Array.from(document.querySelectorAll('h1,h2,h3,[class*="title"],[class*="titulo"]'))
      .some((node) => /^Processos\b/i.test(textOf(node)));
    return pathLooksRight || titleLooksRight || /Processos recentes/i.test(document.body ? document.body.textContent : '');
  }

  function getMainRoot() {
    return document.querySelector('main,[role="main"],mat-sidenav-content,.mat-sidenav-content,.content,.app-content') || document.body;
  }

  function getClickableCheckbox(element) {
    const root = element.closest('mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,.mdc-checkbox,.mat-pseudo-checkbox,[role="checkbox"],mat-list-option,label') || element;
    return root.querySelector('input[type="checkbox"]') || root;
  }

  function isChecked(element) {
    const input = element.matches('input[type="checkbox"]') ? element : element.querySelector('input[type="checkbox"]');
    const root = element.closest('mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,.mdc-checkbox') || element;
    return Boolean(
      (input && input.checked) ||
      root.getAttribute('aria-checked') === 'true' ||
      root.getAttribute('aria-selected') === 'true' ||
      root.classList.contains('mat-checkbox-checked') ||
      root.classList.contains('mat-mdc-checkbox-checked') ||
      root.classList.contains('mdc-checkbox--selected') ||
      root.classList.contains('mat-pseudo-checkbox-checked') ||
      root.querySelector('.mat-pseudo-checkbox-checked')
    );
  }

  function isDisabled(element) {
    const input = element.matches('input[type="checkbox"]') ? element : element.querySelector('input[type="checkbox"]');
    const root = element.closest('mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,.mdc-checkbox') || element;
    return Boolean(
      (input && input.disabled) ||
      root.getAttribute('aria-disabled') === 'true' ||
      root.classList.contains('mat-checkbox-disabled') ||
      root.classList.contains('mat-mdc-checkbox-disabled') ||
      root.classList.contains('mat-pseudo-checkbox-disabled')
    );
  }

  function getResultBlock(element) {
    let current = element;
    for (let depth = 0; current && current !== document.body && depth < 9; depth += 1) {
      const txt = textOf(current);
      if (PROCESS_TEXT_RE.test(txt)) return current;
      current = current.parentElement;
    }
    return element.closest('mat-card,.mat-card,.mat-mdc-card,[class*="card"],[class*="resultado"],[class*="result"]');
  }

  function isProcessResultCheckbox(element) {
    if (!isVisible(element) || isDisabled(element)) return false;
    if (element.closest(`#${PANEL_ID}`)) return false;

    const block = getResultBlock(element);
    if (!block || block.closest('nav,aside,header,mat-sidenav,.mat-sidenav')) return false;
    return PROCESS_TEXT_RE.test(textOf(block));
  }

  function getProcessCheckboxes() {
    if (!document.body || !isProcessesPage()) return [];

    const root = getMainRoot();
    const candidates = Array.from(root.querySelectorAll([
      'input[type="checkbox"]',
      'mat-checkbox',
      '.mat-checkbox',
      '.mat-mdc-checkbox',
      '.mdc-checkbox',
      '.mat-pseudo-checkbox',
      '[role="checkbox"]',
      'mat-list-option',
    ].join(',')));

    const unique = new Map();
    candidates.forEach((candidate) => {
      const checkbox = getClickableCheckbox(candidate);
      if (isProcessResultCheckbox(checkbox)) unique.set(checkbox, checkbox);
    });

    return Array.from(unique.values()).sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 238px;
        padding: 10px;
        border: 1px solid rgba(34, 45, 66, .18);
        border-radius: 8px;
        box-shadow: 0 14px 34px rgba(15, 23, 42, .20);
        background: #ffffff;
        color: #1f2937;
        font: 600 12px/1.25 Arial, sans-serif;
      }
      #${PANEL_ID} .tm-attus-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      #${PANEL_ID} .tm-attus-action-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 6px;
      }
      #${PANEL_ID} button {
        height: 30px;
        min-width: 0;
        border: 1px solid rgba(79, 70, 229, .22);
        border-radius: 6px;
        background: #f7f7ff;
        color: #4f46e5;
        font: 700 12px/1 Arial, sans-serif;
        cursor: pointer;
      }
      #${PANEL_ID} button:hover {
        background: #eeeefe;
      }
      #${PANEL_ID} button:disabled {
        cursor: default;
        opacity: .55;
      }
      #${PANEL_ID} .tm-attus-primary {
        background: #5f46e8;
        color: #ffffff;
      }
      #${PANEL_ID} .tm-attus-primary:hover {
        background: #513bd0;
      }
      #${PANEL_ID} .tm-attus-status {
        margin-top: 8px;
        min-height: 15px;
        color: #4b5563;
        font: 600 11px/1.35 Arial, sans-serif;
        white-space: normal;
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyle();

    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="tm-attus-row">
        <button type="button" data-select-count="10" title="Selecionar proximos 10 resultados">10</button>
        <button type="button" data-select-count="25" title="Selecionar proximos 25 resultados">25</button>
        <button type="button" data-select-count="50" title="Selecionar proximos 50 resultados">50</button>
        <button type="button" class="tm-attus-primary" data-select-count="all" title="Selecionar todo o resultado visivel">Resultado</button>
      </div>
      <div class="tm-attus-action-row">
        <button type="button" data-action="refresh" title="Atualizar contagem">Atualizar</button>
        <button type="button" data-action="clear" title="Desmarcar resultados visiveis">Limpar</button>
      </div>
      <div class="tm-attus-status" data-role="status">Procurando resultados...</div>
    `;

    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || busy) return;

      const count = button.dataset.selectCount;
      if (count) {
        selectNext(count === 'all' ? Infinity : Number(count));
        return;
      }

      if (button.dataset.action === 'clear') {
        clearVisible();
        return;
      }

      if (button.dataset.action === 'refresh') {
        updatePanel();
      }
    });

    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(message) {
    const panel = ensurePanel();
    const status = panel.querySelector('[data-role="status"]');
    if (status) status.textContent = message;
  }

  function setButtonsDisabled(disabled) {
    const panel = ensurePanel();
    panel.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled;
    });
  }

  function clickCheckbox(checkbox) {
    const target = getClickableCheckbox(checkbox);
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
  }

  async function clickMany(checkboxes, shouldClick) {
    busy = true;
    setButtonsDisabled(true);

    let clicked = 0;
    for (const checkbox of checkboxes) {
      if (!document.contains(checkbox) || !isVisible(checkbox)) continue;
      if (!shouldClick(checkbox)) continue;
      clickCheckbox(checkbox);
      clicked += 1;
      setStatus(`Aplicando selecao... ${clicked}/${checkboxes.length}`);
      await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
    }

    busy = false;
    setButtonsDisabled(false);
    updatePanel();
    return clicked;
  }

  function selectNext(limit) {
    const unchecked = getProcessCheckboxes().filter((checkbox) => !isChecked(checkbox)).slice(0, limit);
    if (!unchecked.length) {
      setStatus('Nenhum resultado visivel pendente.');
      return;
    }

    clickMany(unchecked, (checkbox) => !isChecked(checkbox));
  }

  function clearVisible() {
    const checked = getProcessCheckboxes().filter((checkbox) => isChecked(checkbox));
    if (!checked.length) {
      setStatus('Nenhum resultado visivel marcado.');
      return;
    }

    clickMany(checked, (checkbox) => isChecked(checkbox));
  }

  function updatePanel() {
    const panel = ensurePanel();
    const checkboxes = getProcessCheckboxes();
    const checked = checkboxes.filter((checkbox) => isChecked(checkbox)).length;
    const unchecked = checkboxes.length - checked;

    panel.dataset.hidden = 'false';
    setButtonsDisabled(!checkboxes.length || busy);

    if (!checkboxes.length) {
      setStatus(isProcessesPage()
        ? 'Painel ativo. Nenhum checkbox de processo detectado ainda.'
        : 'Painel ativo. Abra a tela de Processos para selecionar resultados.');
      return;
    }

    setStatus(`${checked}/${checkboxes.length} visiveis marcados. Pendentes: ${unchecked}.`);
  }

  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updatePanel, UPDATE_DELAY_MS);
  }

  function start() {
    ensurePanel();
    updatePanel();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('hashchange', scheduleUpdate);
    window.addEventListener('popstate', scheduleUpdate);
    window.setInterval(scheduleUpdate, 2500);

    console.info('[ATTUS Selecionar Processos] Monitor iniciado.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

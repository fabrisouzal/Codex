// ==UserScript==
// @name         ATTUS - Selecionar Processos
// @namespace    http://tampermonkey.net/
// @version      2026-06-30.01
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

  function getAngularComponent(element, predicate) {
    if (!element) return null;

    try {
      if (window.ng && typeof window.ng.getComponent === 'function') {
        const component = window.ng.getComponent(element);
        if (component && predicate(component)) return component;
      }
    } catch (error) {
      console.debug('[ATTUS Selecionar Processos] ng.getComponent indisponivel.', error);
    }

    const contextKey = Object.keys(element).find((key) => key.startsWith('__ngContext__'));
    const context = contextKey ? element[contextKey] : element.__ngContext__;
    if (!context || typeof context.length !== 'number') return null;

    for (let index = 0; index < context.length; index += 1) {
      const value = context[index];
      if (value && typeof value === 'object' && predicate(value)) return value;
    }

    return null;
  }

  function getAngularComponentInAncestors(element, predicate) {
    let current = element;
    for (let depth = 0; current && current !== document.body && depth < 24; depth += 1) {
      const component = getAngularComponent(current, predicate);
      if (component) return component;
      current = current.parentElement;
    }
    return null;
  }

  function getProcessCardComponent(card) {
    return getAngularComponentInAncestors(card, (component) => (
      component &&
      Object.prototype.hasOwnProperty.call(component, 'processo') &&
      Object.prototype.hasOwnProperty.call(component, 'checkboxChange') &&
      component.checkboxChange &&
      typeof component.checkboxChange.emit === 'function'
    ));
  }

  function getProcessListComponent(element) {
    return getAngularComponentInAncestors(element, (component) => (
      component &&
      Array.isArray(component.processosSelecionados) &&
      typeof component.adicionarProcesso === 'function' &&
      typeof component.removerProcesso === 'function'
    ));
  }

  function getProcessFromCard(card) {
    const cardComponent = getProcessCardComponent(card);
    if (cardComponent && cardComponent.processo) return cardComponent.processo;

    const component = getAngularComponentInAncestors(card, (candidate) => (
      candidate &&
      candidate.processo &&
      (candidate.processo.id || candidate.processo.numero || candidate.processo.pasta)
    ));
    return component ? component.processo : null;
  }

  function runDetectChanges(component) {
    if (component && component.changeDetectorRef && typeof component.changeDetectorRef.detectChanges === 'function') {
      component.changeDetectorRef.detectChanges();
    }
  }

  function isProcessSelectedInList(listComponent, processo) {
    if (!listComponent || !processo) return false;
    if (typeof listComponent.isProcessoSelecionado === 'function') {
      try { return Boolean(listComponent.isProcessoSelecionado(processo)); } catch (_) {}
    }

    return listComponent.processosSelecionados.some((selected) => (
      selected === processo ||
      (selected && processo && selected.id != null && selected.id === processo.id) ||
      (selected && processo && selected.numero && selected.numero === processo.numero)
    ));
  }

  function getClickableCheckbox(element) {
    const root = element.closest('mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,.mdc-checkbox,.mat-pseudo-checkbox,[role="checkbox"],mat-list-option,label') || element;
    return root.matches('input[type="checkbox"]') ? root : root;
  }

  function getCheckboxInside(element) {
    if (!element) return null;
    if (element.matches('input[type="checkbox"],mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,.mdc-checkbox,.mat-pseudo-checkbox,[role="checkbox"],mat-list-option,label')) {
      return getClickableCheckbox(element);
    }

    const inner = element.querySelector([
      'mat-checkbox',
      '.mat-checkbox',
      '.mat-mdc-checkbox',
      '.mdc-checkbox',
      '.mat-pseudo-checkbox',
      '[role="checkbox"]',
      'input[type="checkbox"]',
      '.mat-checkbox-inner-container',
      '.mat-checkbox-frame',
      '.mat-mdc-checkbox-touch-target',
      '.mdc-checkbox__native-control',
      '.mdc-checkbox__background',
      '[class*="checkbox"]',
    ].join(','));
    return inner ? getClickableCheckbox(inner) : null;
  }

  function isChecked(element) {
    const card = element.closest('pd-processo-card');
    const listComponent = getProcessListComponent(card || element);
    const processo = card ? getProcessFromCard(card) : null;
    if (listComponent && processo) return isProcessSelectedInList(listComponent, processo);

    const cardComponent = getProcessCardComponent(card);
    if (cardComponent) return Boolean(cardComponent.isProcessoSelecionado);

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
    const card = element.closest('pd-processo-card');
    const cardComponent = getProcessCardComponent(card);
    if (cardComponent && cardComponent.permiteSelecionarProcesso === false) return true;

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
    for (let depth = 0; current && current !== document.body && depth < 24; depth += 1) {
      const txt = textOf(current);
      if (PROCESS_TEXT_RE.test(txt)) return current;
      current = current.parentElement;
    }
    return element.closest('mat-card,.mat-card,.mat-mdc-card,[class*="card"],[class*="resultado"],[class*="result"]');
  }

  function isProcessResultCheckbox(element) {
    if (!element || isDisabled(element)) return false;
    if (element.closest(`#${PANEL_ID}`)) return false;

    const block = getResultBlock(element);
    if (!isVisible(block)) return false;
    if (!block || block.closest('nav,aside,header,mat-sidenav,.mat-sidenav')) return false;
    return PROCESS_TEXT_RE.test(textOf(block));
  }

  function isProcessTargetVisible(element) {
    if (!element) return false;
    const card = element.closest('pd-processo-card');
    if (card) return isVisible(card);
    return isVisible(element) || isVisible(getResultBlock(element));
  }

  function getProcessCheckboxes() {
    if (!document.body || !isProcessesPage()) return [];

    const root = getMainRoot();
    const cardCandidates = [];
    Array.from(root.querySelectorAll('pd-processo-card')).forEach((card) => {
      cardCandidates.push(card);
      const inner = getCheckboxInside(card);
      if (inner) cardCandidates.push(inner);
    });
    const cards = cardCandidates.filter((checkbox) => isProcessResultCheckbox(checkbox));

    const candidates = Array.from(root.querySelectorAll([
      'input[type="checkbox"]',
      'mat-checkbox',
      '.mat-checkbox',
      '.mat-mdc-checkbox',
      '.mdc-checkbox',
      '.mat-pseudo-checkbox',
      '.mat-checkbox-inner-container',
      '.mat-checkbox-frame',
      '.mat-mdc-checkbox-touch-target',
      '.mdc-checkbox__native-control',
      '.mdc-checkbox__background',
      '[role="checkbox"]',
      'mat-list-option',
      '[class*="checkbox"]',
    ].join(',')));

    const unique = new Map();
    cards.concat(candidates).forEach((candidate) => {
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
      pd-processo-card mat-checkbox,
      pd-processo-card .mat-checkbox,
      pd-processo-card .mat-mdc-checkbox {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      pd-processo-card pd-card-icone.hide {
        display: none !important;
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
        <button type="button" class="tm-attus-primary" data-select-count="100" title="Selecionar proximos 100 resultados">100</button>
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

  function dispatchPointerOrMouse(target, pointerType, mouseType) {
    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent(pointerType, { bubbles: true, cancelable: true, pointerType: 'mouse' }));
      return;
    }

    target.dispatchEvent(new MouseEvent(mouseType, { bubbles: true, cancelable: true, view: window }));
  }

  function clickCheckbox(checkbox) {
    const card = checkbox.closest('pd-processo-card');
    const listComponent = getProcessListComponent(card || checkbox);
    const processo = card ? getProcessFromCard(card) : null;
    if (listComponent && processo) {
      const checked = isProcessSelectedInList(listComponent, processo);
      if (checked) {
        listComponent.removerProcesso(processo);
      } else {
        listComponent.adicionarProcesso(processo);
      }
      runDetectChanges(listComponent);
      card && card.dispatchEvent(new CustomEvent('tm-attus-processo-selecionado', { bubbles: true, detail: { checked: !checked } }));
      return;
    }

    const cardComponent = getProcessCardComponent(card);
    if (cardComponent && cardComponent.checkboxChange && typeof cardComponent.checkboxChange.emit === 'function') {
      const checked = !Boolean(cardComponent.isProcessoSelecionado);
      cardComponent.checkboxChange.emit({ checked, source: checkbox });
      cardComponent.isProcessoSelecionado = checked;
      runDetectChanges(cardComponent);
      card && card.dispatchEvent(new CustomEvent('tm-attus-processo-selecionado', { bubbles: true, detail: { checked } }));
      return;
    }

    const target = getCheckboxInside(checkbox) || checkbox.closest('mat-checkbox,.mat-checkbox,.mat-mdc-checkbox,[role="checkbox"],label') || getClickableCheckbox(checkbox);
    dispatchPointerOrMouse(target, 'pointerdown', 'mousedown');
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    dispatchPointerOrMouse(target, 'pointerup', 'mouseup');
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  async function clickMany(checkboxes, shouldClick) {
    busy = true;
    setButtonsDisabled(true);

    let clicked = 0;
    for (const checkbox of checkboxes) {
      if (!document.contains(checkbox) || !isProcessTargetVisible(checkbox)) continue;
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

    const cards = document.querySelectorAll('pd-processo-card').length;
    const listComponent = getProcessListComponent(checkboxes[0]);
    const mode = listComponent ? 'store ATTUS' : 'clique';
    setStatus(`${checked}/${checkboxes.length} marcados. Cards: ${cards}. Modo: ${mode}. Pendentes: ${unchecked}.`);
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

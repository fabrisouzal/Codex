// ==UserScript==
// @name         ATTUS - Selecionar Processos
// @namespace    http://tampermonkey.net/
// @version      2026-06-30.04
// @description  Adiciona uma barra isolada para selecionar em lote os cards visiveis de processos no ATTUS.
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

  const BAR_ID = 'tm-attus-selecionar-processos';
  const STYLE_ID = `${BAR_ID}-style`;
  const CLICK_DELAY_MS = 85;
  const UPDATE_DELAY_MS = 180;
  const PROCESS_TEXT_RE = /\bProcesso eletr|\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b|\b\d{4}\.\d{2}\.\d{6}\b/i;

  let busy = false;
  let updateTimer = 0;

  function textOf(element) {
    return (element && element.textContent ? element.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  }

  function isProcessesPage() {
    if (!document.body) return false;
    const routeLooksRight = /process/i.test(`${location.pathname}${location.hash}${location.search}`);
    const headingLooksRight = Array.from(document.querySelectorAll('h1,h2,h3'))
      .some((heading) => /^Processos\b/i.test(textOf(heading)));
    return routeLooksRight || headingLooksRight || /Processos recentes|Processos encontrados/i.test(document.body.textContent || '');
  }

  function getPageHost() {
    return document.querySelector('main,[role="main"],mat-sidenav-content,.mat-sidenav-content,.content,.app-content') || document.body;
  }

  function getHeaderAnchor() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .filter((heading) => /^Processos\b/i.test(textOf(heading)));
    if (headings.length) return headings[0];

    const recent = Array.from(document.querySelectorAll('body *'))
      .find((element) => /^Processos (recentes|encontrados)/i.test(textOf(element)));
    return recent || getPageHost().firstElementChild || document.body;
  }

  function getCardCheckbox(card) {
    return card.querySelector([
      'mat-checkbox',
      '.mat-checkbox',
      '.mat-mdc-checkbox',
      '.mdc-checkbox',
      'input[type="checkbox"]',
      '[role="checkbox"]',
      '[class*="checkbox"]',
    ].join(','));
  }

  function getClickableTarget(checkbox) {
    if (!checkbox) return null;
    return checkbox.querySelector([
      '.mat-checkbox-inner-container',
      '.mat-mdc-checkbox-touch-target',
      '.mdc-checkbox__native-control',
      '.mdc-checkbox__background',
      'input[type="checkbox"]',
    ].join(',')) || checkbox;
  }

  function getCards() {
    if (!document.body || !isProcessesPage()) return [];

    const cards = Array.from(document.querySelectorAll('pd-processo-card'))
      .filter((card) => isVisible(card) && PROCESS_TEXT_RE.test(textOf(card)) && getCardCheckbox(card));

    if (cards.length) return cards;

    return Array.from(getPageHost().querySelectorAll('mat-card,.mat-card,.mat-mdc-card,[class*="card"]'))
      .filter((card) => isVisible(card) && PROCESS_TEXT_RE.test(textOf(card)) && getCardCheckbox(card));
  }

  function getCheckboxState(card) {
    const checkbox = getCardCheckbox(card);
    if (!checkbox) return false;
    const input = checkbox.matches('input[type="checkbox"]') ? checkbox : checkbox.querySelector('input[type="checkbox"]');
    return Boolean(
      (input && input.checked) ||
      checkbox.getAttribute('aria-checked') === 'true' ||
      checkbox.classList.contains('mat-checkbox-checked') ||
      checkbox.classList.contains('mat-mdc-checkbox-checked') ||
      checkbox.classList.contains('mdc-checkbox--selected')
    );
  }

  function dispatchMouse(target, type) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    }));
  }

  function dispatchPointer(target, type) {
    if (typeof PointerEvent !== 'function') return;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerType: 'mouse',
      isPrimary: true,
      view: window,
    }));
  }

  function setNativeChecked(input, checked) {
    if (!input) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    if (descriptor && descriptor.set) descriptor.set.call(input, checked);
    else input.checked = checked;
  }

  function clickCardCheckbox(card, desiredChecked) {
    const checkbox = getCardCheckbox(card);
    const target = getClickableTarget(checkbox);
    if (!checkbox || !target) return false;

    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true, view: window }));
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, view: window }));
    checkbox.classList.add('show');
    checkbox.style.display = 'flex';
    checkbox.style.visibility = 'visible';
    checkbox.style.opacity = '1';
    checkbox.style.pointerEvents = 'auto';

    dispatchPointer(target, 'pointerover');
    dispatchMouse(target, 'mouseover');
    dispatchPointer(target, 'pointerdown');
    dispatchMouse(target, 'mousedown');
    dispatchPointer(target, 'pointerup');
    dispatchMouse(target, 'mouseup');
    target.click();

    const input = checkbox.matches('input[type="checkbox"]') ? checkbox : checkbox.querySelector('input[type="checkbox"]');
    if (input && input.checked !== desiredChecked) {
      setNativeChecked(input, desiredChecked);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    checkbox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID} {
        all: initial;
        position: fixed !important;
        top: 104px !important;
        left: 292px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      }
      pd-processo-card mat-checkbox,
      pd-processo-card .mat-checkbox,
      pd-processo-card .mat-mdc-checkbox {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBar() {
    ensureStyle();

    let host = document.getElementById(BAR_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = BAR_ID;
      document.body.appendChild(host);
    }

    host.style.cssText = [
      'all:initial',
      'position:fixed',
      'top:104px',
      'left:292px',
      'right:24px',
      'z-index:2147483647',
      'pointer-events:none',
    ].join(';');

    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    let bar = root.querySelector('[data-role="bar"]');
    if (bar) return bar;

    root.innerHTML = `
      <style>
        :host { all: initial; }
        [data-role="bar"] {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: max-content;
          max-width: 100%;
          padding: 6px;
          border: 1px solid rgba(84, 74, 210, .20);
          border-radius: 7px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(20, 24, 44, .18);
          color: #2f3442;
          font: 600 12px/1.2 Arial, sans-serif;
          pointer-events: auto;
        }
        button {
          height: 28px;
          min-width: 38px;
          border: 1px solid rgba(95, 70, 232, .24);
          border-radius: 6px;
          background: #f7f7ff;
          color: #513bd0;
          font: 700 12px/1 Arial, sans-serif;
          cursor: pointer;
        }
        button:hover { background: #eeeeff; }
        button:disabled { opacity: .55; cursor: default; }
        .primary { background: #5f46e8; color: #ffffff; }
        .primary:hover { background: #513bd0; }
        .separator {
          width: 1px;
          height: 20px;
          background: rgba(84, 74, 210, .18);
        }
        .status {
          min-width: 220px;
          color: #4b5563;
          font: 600 11px/1.25 Arial, sans-serif;
          white-space: nowrap;
        }
      </style>
      <div data-role="bar">
        <button type="button" data-count="10" title="Selecionar proximos 10 processos">10</button>
        <button type="button" data-count="25" title="Selecionar proximos 25 processos">25</button>
        <button type="button" data-count="50" title="Selecionar proximos 50 processos">50</button>
        <button type="button" class="primary" data-count="100" title="Selecionar proximos 100 processos">100</button>
        <span class="separator"></span>
        <button type="button" data-action="clear" title="Desmarcar processos visiveis">Limpar</button>
        <button type="button" data-action="refresh" title="Atualizar contagem">Atualizar</button>
        <span class="status" data-role="status">Carregando...</span>
      </div>
    `;

    bar = root.querySelector('[data-role="bar"]');
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || busy) return;

      if (button.dataset.count) {
        selectBatch(Number(button.dataset.count));
        return;
      }

      if (button.dataset.action === 'clear') {
        clearVisible();
        return;
      }

      if (button.dataset.action === 'refresh') updateBar();
    });

    return bar;
  }

  function setBusy(value) {
    busy = value;
    const bar = ensureBar();
    bar.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
  }

  function setStatus(message) {
    const status = document.getElementById(BAR_ID)
      ?.shadowRoot
      ?.querySelector('[data-role="status"]');
    if (status) status.textContent = message;
  }

  async function runBatch(cards, desiredChecked) {
    setBusy(true);
    let changed = 0;

    for (const card of cards) {
      if (!document.contains(card) || !isVisible(card)) continue;
      const current = getCheckboxState(card);
      if (current === desiredChecked) continue;

      card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (clickCardCheckbox(card, desiredChecked)) changed += 1;
      setStatus(`Aplicando... ${changed}/${cards.length}`);
      await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
    }

    setBusy(false);
    updateBar();
  }

  function selectBatch(count) {
    const cards = getCards().filter((card) => !getCheckboxState(card)).slice(0, count);
    if (!cards.length) {
      setStatus('Nenhum processo visivel pendente.');
      return;
    }
    runBatch(cards, true);
  }

  function clearVisible() {
    const cards = getCards().filter((card) => getCheckboxState(card));
    if (!cards.length) {
      setStatus('Nenhum processo visivel marcado.');
      return;
    }
    runBatch(cards, false);
  }

  function updateBar() {
    if (!document.body) return;
    const bar = ensureBar();
    const cards = getCards();
    const checked = cards.filter((card) => getCheckboxState(card)).length;
    const pending = cards.length - checked;
    bar.querySelectorAll('button').forEach((button) => {
      button.disabled = busy || !cards.length;
    });
    setStatus(cards.length
      ? `${checked}/${cards.length} marcados. Pendentes: ${pending}.`
      : (isProcessesPage() ? 'Nenhum card de processo detectado.' : 'Abra a tela de Processos.'));
  }

  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateBar, UPDATE_DELAY_MS);
  }

  function start() {
    ensureBar();
    updateBar();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('hashchange', scheduleUpdate);
    window.addEventListener('popstate', scheduleUpdate);
    window.setInterval(scheduleUpdate, 2500);

    console.info('[ATTUS Selecionar Processos] Barra integrada iniciada.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

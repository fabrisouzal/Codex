// ==UserScript==
// @name         ATTUS - Definir Tennant PGESP
// @namespace    http://tampermonkey.net/
// @version      2026-06-25.01
// @description  Garante automaticamente o tennant PGESP quando o ATTUS estiver autenticado.
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
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/definir-tennant-pgesp.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/definir-tennant-pgesp.user.js
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_TENNANT = 'PGESP';
  const API_PATH = '/uaa/usuarios/run-as/login';
  const LOCK_KEY = 'tm:auto-tennant-pgesp:lock';
  const BADGE_ID = 'tm-attus-pgesp-badge';
  const LOCK_TTL_MS = 30 * 1000;
  const CHECK_INTERVAL_MS = 1000;
  const MAX_WAIT_MS = 2 * 60 * 1000;

  const STORAGE_KEYS = {
    currentUser: 'currentUser',
    token: 'TOKEN',
    oauthToken: 'access_token',
    refreshToken: 'REFRESH_TOKEN',
    oauthRefreshToken: 'refresh_token',
    tokenExecutor: 'TOKEN_USUARIO_EXECUTOR',
    usernameExecutor: 'USERNAME_USUARIO_EXECUTOR',
  };

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  console.warn('[ATTUS PGESP] Userscript carregado na pagina:', location.href);

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('role', 'status');
    badge.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'height:34px',
      'padding:0 12px',
      'border-radius:6px',
      'border:1px solid rgba(18,24,38,.14)',
      'box-shadow:0 8px 22px rgba(15,23,42,.16)',
      'font:600 12px/1.2 Arial, sans-serif',
      'letter-spacing:0',
      'background:#ffffff',
      'color:#243044',
      'pointer-events:none',
    ].join(';');

    const dot = document.createElement('span');
    dot.dataset.role = 'dot';
    dot.style.cssText = [
      'width:8px',
      'height:8px',
      'border-radius:50%',
      'background:#9aa4b2',
      'flex:0 0 auto',
    ].join(';');

    const text = document.createElement('span');
    text.dataset.role = 'text';
    text.textContent = 'Tennant: verificando';

    badge.append(dot, text);
    document.documentElement.appendChild(badge);
    return badge;
  }

  function updateBadge(state, detail) {
    const badge = ensureBadge();
    const dot = badge.querySelector('[data-role="dot"]');
    const text = badge.querySelector('[data-role="text"]');

    const states = {
      checking: { dot: '#d97706', border: 'rgba(217,119,6,.28)', bg: '#fffaf0', color: '#7c2d12', label: 'Tennant: verificando' },
      ok: { dot: '#16a34a', border: 'rgba(22,163,74,.28)', bg: '#f0fdf4', color: '#14532d', label: `Tennant: ${TARGET_TENNANT}` },
      changing: { dot: '#2563eb', border: 'rgba(37,99,235,.28)', bg: '#eff6ff', color: '#1e3a8a', label: `Tennant: definindo ${TARGET_TENNANT}` },
      error: { dot: '#dc2626', border: 'rgba(220,38,38,.28)', bg: '#fef2f2', color: '#7f1d1d', label: 'Tennant: erro' },
    };

    const config = states[state] || states.checking;
    dot.style.background = config.dot;
    badge.style.borderColor = config.border;
    badge.style.background = config.bg;
    badge.style.color = config.color;
    text.textContent = detail || config.label;
    badge.title = detail || config.label;
  }

  function getStorageAreas() {
    return [localStorage, sessionStorage];
  }

  function readRawStorage(key) {
    for (const storage of getStorageAreas()) {
      const raw = storage.getItem(key);
      if (raw != null && raw !== '') return raw;
    }

    return null;
  }

  function readStorage(key, fallback = null) {
    const raw = readRawStorage(key);
    if (raw == null || raw === '') return fallback;

    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }

  function writeStorage(key, value) {
    const rawValue = typeof value === 'string' ? value : JSON.stringify(value);

    for (const storage of getStorageAreas()) {
      if (value == null) {
        storage.removeItem(key);
        continue;
      }

      storage.setItem(key, rawValue);
    }
  }

  function removeStorage(key) {
    for (const storage of getStorageAreas()) {
      storage.removeItem(key);
    }
  }

  function writeStorageIfKnown(key, value) {
    if (value == null) {
      removeStorage(key);
      return;
    }

    const rawValue = typeof value === 'string' ? value : JSON.stringify(value);
    let wrote = false;

    for (const storage of getStorageAreas()) {
      if (storage.getItem(key) != null) {
        storage.setItem(key, rawValue);
        wrote = true;
      }
    }

    if (!wrote) {
      localStorage.setItem(key, rawValue);
    }
  }

  function decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;

    const payload = token.split('.')[1];
    if (!payload) return null;

    try {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const json = decodeURIComponent(
        Array.from(atob(padded), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
      );

      return JSON.parse(json);
    } catch (error) {
      console.warn('[ATTUS PGESP] Nao foi possivel decodificar o token atual.', error);
      return null;
    }
  }

  function getCurrentUser() {
    return readStorage(STORAGE_KEYS.currentUser) || decodeJwt(getPrimaryToken());
  }

  function getPrimaryToken() {
    return readStorage(STORAGE_KEYS.token) || readStorage(STORAGE_KEYS.oauthToken);
  }

  function getRefreshToken() {
    return readStorage(STORAGE_KEYS.refreshToken) || readStorage(STORAGE_KEYS.oauthRefreshToken);
  }

  function getUsername() {
    const executor = readStorage(STORAGE_KEYS.usernameExecutor);
    if (executor) return executor;

    const user = getCurrentUser();
    return user?.user_name || user?.username || user?.sub || null;
  }

  function isLocked() {
    const lockedAt = Number(sessionStorage.getItem(LOCK_KEY) || 0);
    return lockedAt && Date.now() - lockedAt < LOCK_TTL_MS;
  }

  function lock() {
    sessionStorage.setItem(LOCK_KEY, String(Date.now()));
  }

  function unlock() {
    sessionStorage.removeItem(LOCK_KEY);
  }

  function shouldDefineTennant() {
    const user = getCurrentUser();
    const token = getPrimaryToken();
    const tenantId = String(user?.tenantId || '').trim().toUpperCase();

    if (!token) return { ok: false, reason: 'sem token no localStorage/sessionStorage' };
    if (!user) return { ok: false, reason: 'sem currentUser/token decodificavel' };
    if (tenantId === TARGET_TENNANT) {
      return { ok: false, done: true, reason: `tenant atual ja e ${TARGET_TENNANT}` };
    }

    return { ok: true, reason: tenantId ? `tenant atual ${tenantId}; ajustando para ${TARGET_TENNANT}` : 'tenant ausente' };
  }

  function persistLoginResponse(data) {
    const accessToken = data?.access_token || data?.accessToken || data?.token || data?.TOKEN;
    const refreshToken = data?.refresh_token || data?.refreshToken || data?.REFRESH_TOKEN;

    if (!accessToken) {
      throw new Error('Resposta sem access_token.');
    }

    const decodedToken = decodeJwt(accessToken);
    if (!decodedToken?.tenantId) {
      throw new Error('Token recebido sem tenantId.');
    }

    if (!readStorage(STORAGE_KEYS.tokenExecutor)) {
      writeStorageIfKnown(STORAGE_KEYS.tokenExecutor, getPrimaryToken());
    }

    const username = getUsername();
    if (username && !readStorage(STORAGE_KEYS.usernameExecutor)) {
      writeStorageIfKnown(STORAGE_KEYS.usernameExecutor, username);
    }

    writeStorageIfKnown(STORAGE_KEYS.token, accessToken);
    writeStorageIfKnown(STORAGE_KEYS.oauthToken, accessToken);
    if (refreshToken) {
      writeStorageIfKnown(STORAGE_KEYS.refreshToken, refreshToken);
      writeStorageIfKnown(STORAGE_KEYS.oauthRefreshToken, refreshToken);
    } else if (getRefreshToken()) {
      console.warn('[ATTUS PGESP] Resposta sem refresh_token; mantendo refresh token atual.');
    }
    writeStorageIfKnown(STORAGE_KEYS.currentUser, decodedToken);
  }

  async function defineTennant() {
    if (isLocked()) return false;

    const decision = shouldDefineTennant();
    if (!decision.ok) {
      if (decision.done) {
        updateBadge('ok');
        console.info(`[ATTUS PGESP] ${decision.reason}.`);
      } else {
        updateBadge('checking', 'Tennant: aguardando login');
      }
      return Boolean(decision.done);
    }

    const token = readStorage(STORAGE_KEYS.tokenExecutor) || getPrimaryToken();
    const username = getUsername();

    if (!token || !username) {
      updateBadge('checking', 'Tennant: aguardando usuario');
      console.info('[ATTUS PGESP] Aguardando token e usuario para chamar run-as/login.');
      return false;
    }

    lock();

    try {
      updateBadge('changing');
      console.info(`[ATTUS PGESP] Chamando ${API_PATH} para definir ${TARGET_TENNANT}. Motivo: ${decision.reason}.`);
      const response = await fetch(`${location.origin}${API_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'X-Usuario': username,
        },
        body: new URLSearchParams({ tennant: TARGET_TENNANT }).toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      persistLoginResponse(await response.json());
      console.info(`[ATTUS PGESP] Tennant ${TARGET_TENNANT} definido automaticamente.`);
      location.reload();
      return true;
    } catch (error) {
      unlock();
      updateBadge('error', 'Tennant: falha ao definir');
      console.error(`[ATTUS PGESP] Falha ao definir o tennant ${TARGET_TENNANT}.`, error);
      return false;
    }
  }

  function startWatcher() {
    const startedAt = Date.now();
    let timerId = null;
    updateBadge('checking');
    console.info('[ATTUS PGESP] Monitor iniciado.');

    const check = async () => {
      const done = await defineTennant();
      if (done || Date.now() - startedAt > MAX_WAIT_MS) {
        clearInterval(timerId);
        if (done) console.info('[ATTUS PGESP] Monitor encerrado.');
        else console.warn('[ATTUS PGESP] Monitor encerrado por tempo limite sem definir o tennant.');
      }
    };

    timerId = setInterval(check, CHECK_INTERVAL_MS);
    check();

    window.addEventListener('storage', check);
    window.addEventListener('focus', check);
    window.addEventListener('load', check);
  }

  pageWindow.__attusPGESPStatus = function () {
    const user = getCurrentUser();
    return {
      scriptVersion: '2026-05-29.07',
      href: location.href,
      targetTennant: TARGET_TENNANT,
      currentTenant: user?.tenantId || null,
      username: getUsername(),
      hasToken: Boolean(getPrimaryToken()),
      hasTokenExecutor: Boolean(readStorage(STORAGE_KEYS.tokenExecutor)),
      decision: shouldDefineTennant(),
    };
  };

  window.__attusPGESPStatus = pageWindow.__attusPGESPStatus;

  startWatcher();
})();

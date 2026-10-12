/* =========================================================================
   MATCHESTOOL.PRO — AUTH GATE
   Market Intelligence Terminal — Access Control Layer
   ========================================================================= */

(function () {
  'use strict';

  // ---- CONFIG ----
  // No reusable access key or administrator password is stored in browser code.
  var CONTACT_URL   = 'https://wa.me/254722713111';
  var CONTACT_LABEL = '0722 713 111';
  var SESSION_KEY   = 'matchestool_session';
  var AUTH_LOCK_TIMER = null;
  var AUTH_LOCK_OBSERVER = null;
  var ORIGINAL_SET_ATTRIBUTE = Element.prototype.setAttribute;
  // A fresh, non-semantic field name on every page load prevents the public
  // origin from being learned as a reusable username/password form.
  var FIELD_NONCE   = Math.random().toString(36).slice(2, 10);

  // ---- HTML TEMPLATE ----
  var GATE_HTML = [
    '<div class="mt-auth-container">',

    '  <div class="mt-brand">',
    '    <div class="mt-brand-mark">',
    '      <span class="mt-brand-arrow">▶</span>',
    '      MATCHESTOOL.PRO',
    '    </div>',
    '    <div class="mt-brand-tagline">Professional Market Intelligence</div>',
    '    <div class="mt-brand-status">',
    '      <span class="mt-status-dot"></span>',
    '      <span>Feeds Active</span>',
    '      <span class="mt-sep">|</span>',
    '      <span class="mt-ticker-live">LIVE</span>',
    '    </div>',
    '  </div>',

    '  <div class="mt-auth-card">',
    '    <div class="mt-card-accent"></div>',
    '    <span class="mt-corner tl"></span>',
    '    <span class="mt-corner tr"></span>',
    '    <span class="mt-corner bl"></span>',
    '    <span class="mt-corner br"></span>',

    '    <div class="mt-card-header">',
    '      <div class="mt-card-eyebrow">Secure client portal</div>',
    '      <div class="mt-card-title">Welcome back</div>',
    '      <div class="mt-card-subtitle">Enter your individual access key to continue to your analytics workspace.</div>',
    '    </div>',

    '    <div class="mt-alert" id="mt-alert">',
    '      <span>&#9888;</span>',
    '      <span id="mt-alert-text">Invalid credentials</span>',
    '    </div>',

    '    <form class="mt-form" id="mt-login-form" autocomplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-protonpass-ignore="true">',
    '      <div class="mt-field">',
    '        <label class="mt-label" for="mt-email">Username (optional)</label>',
    '        <div class="mt-input-wrap">',
    '          <input class="mt-input" type="search" id="mt-email" name="identity_' + FIELD_NONCE + '" placeholder="" autocomplete="off" aria-autocomplete="none" autocapitalize="none" autocorrect="off" inputmode="text" enterkeyhint="next" spellcheck="false" data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-protonpass-ignore="true" />',
    '          <span class="mt-input-icon">@</span>',
    '        </div>',
    '      </div>',

    '      <div class="mt-field">',
    '        <label class="mt-label" for="mt-password">Access Key</label>',
    '        <div class="mt-input-wrap">',
    '          <input class="mt-input mt-access-input" type="text" id="mt-password" name="access_' + FIELD_NONCE + '" placeholder="" autocomplete="off" aria-autocomplete="none" autocapitalize="none" autocorrect="off" inputmode="text" enterkeyhint="go" spellcheck="false" data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-protonpass-ignore="true" />',
    '          <span class="mt-input-icon">&#8918;</span>',
    '        </div>',
    '      </div>',

    '      <button type="submit" class="mt-btn" id="mt-submit-btn">',
    '        <span id="mt-btn-text">Sign in securely &#8594;</span>',
    '      </button>',
    '    </form>',

    '    <div class="mt-pricing">',
    '      <div class="mt-pricing-label">Access key required</div>',
    '      <div class="mt-pricing-amount">Individual access</div>',
    '      <div class="mt-pricing-note">Use the key issued to you by the administrator.</div>',
    '    </div>',

    '    <div class="mt-contact">',
    '      <span>Need access or assistance?</span>',
    '      <a href="' + CONTACT_URL + '" target="_blank" rel="noopener noreferrer" aria-label="Contact us on WhatsApp">',
    '        <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3A12.8 12.8 0 0 0 5.1 22.5L3.4 29l6.7-1.7A12.9 12.9 0 1 0 16 3Zm0 23.4c-2 0-3.9-.5-5.5-1.5l-.4-.2-4 .9 1-3.8-.3-.4A10.3 10.3 0 1 1 16 26.4Zm5.7-7.7c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1-2-.9-3.4-2.5-4.3-4.4-.2-.4.2-.6.5-1 .1-.2.3-.4.4-.6.1-.2.1-.4 0-.6l-1-2.4c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.9 0 1.7 1.3 3.4 1.4 3.6.2.2 2.5 3.8 6 5.3 3.6 1.6 3.6 1.1 4.2 1 .7 0 2.1-.9 2.4-1.7.3-.9.3-1.6.2-1.7-.2-.1-.5-.2-.8-.4Z"/></svg>',
    '        <span><strong>Contact us on WhatsApp</strong><small>' + CONTACT_LABEL + '</small></span>',
    '      </a>',
    '    </div>',

    '  </div>',
    '</div>'
  ].join('\n');

  // ---- BOOT SEQUENCE ----
  var BOOT_LINES = [
    { text: '<span class="mt-prompt">matchestool@terminal</span>:~$ connect --secure', delay: 150 },
    { text: 'Initializing market data feeds... <span class="mt-ok">[OK]</span>',       delay: 350 },
    { text: 'Loading analytics engine... <span class="mt-ok">[OK]</span>',              delay: 550 },
    { text: 'Syncing tick streams... <span class="mt-info">[ACTIVE]</span>',            delay: 750 },
    { text: 'Awaiting authentication...',                                                delay: 950 }
  ];

  // ---- MATRIX RAIN (gold tones) ----
  function initMatrixRain() {
    var canvas = document.getElementById('mt-matrix-canvas');
    if (!canvas) return;
    var ctx    = canvas.getContext('2d');
    var chars  = '01MATCHESTOOL0123456789ABCDEF▲▼◆●○';
    var fontSize = 13;
    var columns = 0;
    var drops   = [];

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.floor(canvas.width / fontSize);
      drops   = new Array(columns).fill(1).map(function () { return Math.random() * -120; });
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      ctx.fillStyle = 'rgba(2,4,10,0.055)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontSize + 'px monospace';
      for (var i = 0; i < drops.length; i++) {
        var char = chars[Math.floor(Math.random() * chars.length)];
        // Lead character brighter gold, trail dimmer
        if (drops[i] * fontSize > 0 && drops[i] * fontSize < canvas.height) {
          ctx.fillStyle = (Math.random() > 0.92) ? '#FCD34D' : '#92600A';
          ctx.fillText(char, i * fontSize, drops[i] * fontSize);
        }
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.972) drops[i] = 0;
        drops[i]++;
      }
    }
    setInterval(draw, 55);
  }

  // ---- BOOT ANIMATION ----
  function playBootSequence() {
    var bootEl = document.getElementById('mt-boot');
    if (!bootEl) return;
    bootEl.innerHTML = '';
    BOOT_LINES.forEach(function (line) {
      var div = document.createElement('div');
      div.className = 'mt-boot-line';
      div.innerHTML = line.text;
      div.style.animationDelay = line.delay + 'ms';
      bootEl.appendChild(div);
    });
  }

  // ---- SESSION ----
  function isAuthenticated() {
    try {
      var raw  = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return data && data.token && data.expiresAt && Date.now() < data.expiresAt;
    } catch (e) { return false; }
  }

  function createSession(user, sessionToken, serverExpiresAt) {
    var token = sessionToken;
    var expiresAtMs = serverExpiresAt ? Date.parse(serverExpiresAt) : Date.now() + (12 * 60 * 60 * 1000);
    var session = {
      token: token,
      user: user || { username: 'Authorized user' },
      expiresAt: expiresAtMs
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // Keep the existing Supabase-client compatibility shim, but never use it
    // as the source of access authorization. The API validates the opaque token.
    var expiresAt = Math.floor(expiresAtMs / 1000);
    var username = session.user.username || 'authorized-user';
    var supaSession = {
      access_token: token,
      refresh_token: 'access-session-' + token,
      expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      expires_at: expiresAt,
      token_type: 'bearer',
      user: {
        id: 'matchestool-access-user',
        email: (username.replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user') + '@access.local',
        app_metadata: {},
        user_metadata: { username: username },
        role: 'authenticated',
        aud: 'authenticated'
      }
    };
    try {
      localStorage.setItem('sb-xrfpqifzmsgsvrqyxygb-auth-token', JSON.stringify(supaSession));
      localStorage.setItem('supabase.auth.token', JSON.stringify(supaSession));
    } catch (e) {}
    return session;
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    try { localStorage.removeItem('supabase.auth.token'); localStorage.removeItem('sb-xrfpqifzmsgsvrqyxygb-auth-token'); } catch (e) {}
  }

  // ---- SERVER-VALIDATED ACCESS ----
  function validateAccessKey(accessKey) {
    return fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ action: 'validate', accessKey: accessKey })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok || !data.sessionToken) {
          throw new Error(data.error || 'Invalid, expired, or revoked access key.');
        }
        return data;
      });
    });
  }

  function getAuthFields() {
    return {
      gate:  document.getElementById('mt-auth-gate'),
      form:  document.getElementById('mt-login-form'),
      email: document.getElementById('mt-email'),
      pass:  document.getElementById('mt-password'),
      btn:   document.getElementById('mt-submit-btn')
    };
  }

  function showSystemAlert(msg) {
    var alertEl = document.getElementById('mt-alert');
    var alertText = document.getElementById('mt-alert-text');
    if (alertText) alertText.textContent = msg;
    if (alertEl) {
      alertEl.classList.remove('show');
      void alertEl.offsetWidth;
      alertEl.classList.add('show');
    }
  }

  function isHiddenLockAttr(name) {
    return name === 'aria-hidden' || name === 'data-aria-hidden';
  }

  function isTrueLike(value) {
    return value === true || String(value).toLowerCase() === 'true';
  }

  function isAuthGateOpen() {
    var gate = document.getElementById('mt-auth-gate');
    return !!(gate && !gate.classList.contains('mt-hidden'));
  }

  function shouldProtectFromA11yHide(el) {
    var gate = document.getElementById('mt-auth-gate');
    if (!gate || !el) return false;
    return el === gate || el.contains(gate) || gate.contains(el);
  }

  function unlockA11yLock(el) {
    if (!el || !el.removeAttribute) return;
    el.removeAttribute('inert');
    el.removeAttribute('aria-hidden');
    el.removeAttribute('data-aria-hidden');
  }

  function protectAuthGateFromA11yHide() {
    if (Element.prototype.setAttribute.__mtAuthProtected) return;
    Element.prototype.setAttribute = function (name, value) {
      if (isAuthGateOpen() && isHiddenLockAttr(name) && isTrueLike(value) && shouldProtectFromA11yHide(this)) {
        unlockA11yLock(this);
        return;
      }
      return ORIGINAL_SET_ATTRIBUTE.call(this, name, value);
    };
    Element.prototype.setAttribute.__mtAuthProtected = true;
  }

  function unlockAuthSurface() {
    var fields = getAuthFields();
    if (!fields.gate) return;

    document.documentElement.classList.remove('mt-auth-pending');
    document.documentElement.classList.add('mt-auth-locked');

    if (document.body) {
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = 'auto';
      }
      document.body.removeAttribute('data-scroll-locked');
      document.body.classList.add('mt-auth-body-unlocked');
    }

    unlockA11yLock(document.documentElement);
    if (document.body) unlockA11yLock(document.body);
    unlockA11yLock(fields.gate);
    fields.gate.style.pointerEvents = 'auto';

    [fields.form, fields.email, fields.pass, fields.btn].forEach(function (el) {
      if (!el) return;
      unlockA11yLock(el);
      if (el !== fields.btn) {
        el.disabled = false;
        el.readOnly = false;
      }
      el.style.pointerEvents = 'auto';
    });
  }

  function startAuthLockObserver() {
    if (AUTH_LOCK_OBSERVER || !window.MutationObserver || !document.body) return;
    AUTH_LOCK_OBSERVER = new MutationObserver(function (mutations) {
      var shouldUnlock = Array.prototype.some.call(mutations, function (mutation) {
        return mutation.type === 'attributes' &&
          (mutation.attributeName === 'aria-hidden' ||
           mutation.attributeName === 'data-aria-hidden' ||
           mutation.attributeName === 'inert' ||
           mutation.attributeName === 'style' ||
           mutation.attributeName === 'data-scroll-locked');
      });
      if (shouldUnlock) unlockAuthSurface();
    });
    AUTH_LOCK_OBSERVER.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-aria-hidden', 'inert', 'style', 'data-scroll-locked']
    });
  }

  function startAuthLockGuard() {
    protectAuthGateFromA11yHide();
    unlockAuthSurface();
    startAuthLockObserver();
    if (AUTH_LOCK_TIMER) window.clearInterval(AUTH_LOCK_TIMER);
    AUTH_LOCK_TIMER = window.setInterval(unlockAuthSurface, 250);
  }

  function stopAuthLockGuard() {
    if (AUTH_LOCK_TIMER) {
      window.clearInterval(AUTH_LOCK_TIMER);
      AUTH_LOCK_TIMER = null;
    }
    if (document.body) {
      document.body.classList.remove('mt-auth-body-unlocked');
    }
    if (AUTH_LOCK_OBSERVER) {
      AUTH_LOCK_OBSERVER.disconnect();
      AUTH_LOCK_OBSERVER = null;
    }
  }

  // ---- SHOW / HIDE ----
  function showGate() {
    if (document.getElementById('mt-auth-gate')) {
      startAuthLockGuard();
      return;
    }
    document.documentElement.classList.remove('mt-auth-pending');
    document.documentElement.classList.add('mt-auth-locked');
    var gate = document.createElement('div');
    gate.id  = 'mt-auth-gate';
    gate.innerHTML = GATE_HTML;
    document.body.appendChild(gate);
    gate.addEventListener('click', function (e) { e.stopPropagation(); });
    // Keep application-wide hotkeys and input handlers from intercepting the
    // login controls. Stopping propagation never cancels native text editing.
    ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'paste',
      'cut', 'compositionstart', 'compositionupdate', 'compositionend'].forEach(function (eventName) {
      gate.addEventListener(eventName, function (e) { e.stopPropagation(); });
    });
    attachFormHandlers();
    startAuthLockGuard();
  }

  function hideGate() {
    var gate = document.getElementById('mt-auth-gate');
    if (!gate) return;
    stopAuthLockGuard();
    gate.classList.add('mt-hidden');
    setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 250);
  }

  // ---- FORM HANDLERS ----
  function attachFormHandlers() {
    var form      = document.getElementById('mt-login-form');
    var alertEl   = document.getElementById('mt-alert');
    var alertText = document.getElementById('mt-alert-text');
    var btn       = document.getElementById('mt-submit-btn');
    var btnText   = document.getElementById('mt-btn-text');
    var emailEl   = document.getElementById('mt-email');
    var passEl    = document.getElementById('mt-password');
    if (!form) return;

    function showAlert(msg) {
      if (alertText) alertText.textContent = msg;
      if (alertEl) {
        alertEl.classList.remove('show');
        void alertEl.offsetWidth;
        alertEl.classList.add('show');
      }
    }
    function hideAlert() { if (alertEl) alertEl.classList.remove('show'); }
    function setLoading(on) {
      btn.disabled = on;
      if (on) {
        btnText.innerHTML = '<span class="mt-btn-loading"><span class="mt-spinner"></span> Authenticating...</span>';
      } else {
        btnText.innerHTML = 'Sign in securely &#8594;';
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      unlockAuthSurface();
      hideAlert();
      var id = emailEl ? emailEl.value : '';
      var pw = passEl  ? passEl.value  : '';
      if (!emailEl || !passEl || !btn || !btnText) {
        showSystemAlert('Login form error. Please refresh and try again.');
        return;
      }
      if (!pw || !pw.trim()) { showAlert('Enter your access key.'); return; }
      setLoading(true);
      validateAccessKey(pw.trim()).then(function (result) {
        unlockAuthSurface();
        createSession(result.user, result.sessionToken, result.expiresAt);
        btnText.innerHTML = '<span class="mt-btn-loading"><span class="mt-spinner"></span> Access Granted</span>';
        setTimeout(function () {
          hideGate();
          window.location.href = '/';
        }, 400);
      }).catch(function (error) {
        setLoading(false);
        showAlert(error && error.message ? error.message : 'Access service unavailable. Try again.');
        if (passEl) { passEl.value = ''; passEl.focus(); }
      });
    });

    if (emailEl) emailEl.addEventListener('input', hideAlert);
    if (passEl)  passEl.addEventListener('input',  hideAlert);
    // Native form submission handles Enter reliably across desktop keyboards,
    // mobile IMEs, accessibility keyboards, and password managers.
  }

  // ---- LOGOUT ----
  window.matchestoolLogout = function () { clearSession(); showGate(); };

  // ---- INIT ----
  function init() {
    var raw = null;
    try { raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
    if (!raw || !raw.token || !raw.expiresAt || Date.now() >= raw.expiresAt) {
      clearSession();
      showGate();
      return;
    }
    fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ action: 'session', sessionToken: raw.token })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.valid) throw new Error('Session invalid');
        createSession(data.user || raw.user, raw.token, data.expiresAt || new Date(raw.expiresAt).toISOString());
        document.documentElement.classList.remove('mt-auth-pending', 'mt-auth-locked');
      });
    }).catch(function () {
      clearSession();
      showGate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Guard against internal /auth redirects after login
  window.addEventListener('popstate', function () {
    if (window.location.pathname === '/auth' && !isAuthenticated()) showGate();
  });

})();

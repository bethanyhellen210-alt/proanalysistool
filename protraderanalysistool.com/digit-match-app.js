(function () {
  'use strict';

  // Public Deriv market data only. This page never places trades or requests an account token.
  var PUBLIC_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  var SAMPLE_SIZE = 1000;
  var LOW_DIGIT_LIMIT = 10.4;
  var HIGH_DIGIT_LIMIT = 10.5;
  var state = {
    ws: null, connected: false, reconnectTimer: null, requestId: 0, requests: {},
    markets: [], selectedSymbol: '', samples: [], pip: 2, subscriptionId: null,
    lastDigit: null, signal: null, sampleReady: false, manualStopped: false
  };

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function send(payload, meta) {
    if (!state.ws || state.ws.readyState !== 1) return;
    var id = ++state.requestId;
    payload.req_id = id;
    if (meta) state.requests[id] = meta;
    state.ws.send(JSON.stringify(payload));
  }
  function symbolOf(m) { return m && (m.symbol || m.underlying_symbol || m.underlying) || ''; }
  function nameOf(m) { return m && (m.display_name || m.underlying_symbol_name || m.name) || symbolOf(m); }
  function clock(epoch) {
    return new Date((Number(epoch) || Date.now() / 1000) * 1000).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  function pct(n) { return Number(n || 0).toFixed(2) + '%'; }

  function template() {
    return '<div class="dm-shell">' +
      '<header class="dm-topbar"><div class="dm-brand"><span class="dm-logo">P</span><div><strong>PROTRADER ANALYSIS</strong><small>Deriv live digit signals</small></div></div>' +
      '<div class="dm-top-actions"><span class="ou-connection" id="ou-connection"><i></i><b id="ou-connection-text">Connecting to Deriv…</b></span><button id="dm-logout">Log out</button></div></header>' +
      '<main class="dm-main ou-main">' +
        '<section class="dm-strategy-strip"><div><span class="dm-kicker">Public market feed</span><strong>Live Deriv tick analysis</strong><small>Volatility · 1-second indices · Jump indices</small></div><div class="dm-strip-rule"><span>Analysis window</span><strong>1,000 ticks</strong><small>Rolling digit frequency</small></div></section>' +
        '<section class="dm-panel ou-controls">' +
          '<div class="dm-panel-heading"><div><span class="dm-kicker">Market &amp; strategy</span><h2>Configure entry signal</h2></div><span class="dm-badge" id="ou-feed-badge">WAITING FOR FEED</span></div>' +
          '<div class="ou-form-grid">' +
            '<label>MARKET SELECT<select id="ou-market" disabled><option>Loading live markets…</option></select></label>' +
            '<label>CONTRACT TYPE<select id="ou-contract"><option value="OVER">Over</option><option value="UNDER">Under</option></select></label>' +
            '<label>DIGIT THRESHOLD<select id="ou-barrier"></select></label>' +
          '</div>' +
          '<div class="ou-rule-note"><strong>Your frequency rule</strong><p>Trigger-side digit frequency must be below 10.4%. At least one eligible target digit on the contract-winning side must be at or above 10.5%. The latest live digit must also be on the trigger side.</p></div>' +
          '<div class="ou-action-row"><button class="dm-activate" id="ou-start" disabled>START ANALYSIS</button><button class="dm-refresh" id="ou-stop" disabled>STOP ANALYSIS</button><span id="ou-sample-status">Waiting for live data…</span></div>' +
        '</section>' +
        '<section class="dm-panel ou-signal-panel">' +
          '<div class="dm-panel-heading"><div><span class="dm-kicker">Live analysis result</span><h2>Entry signal</h2></div><span class="dm-badge" id="ou-signal-state">CONNECTING</span></div>' +
          '<div class="ou-signal-call" id="ou-signal-call"><span class="ou-pulse"></span><strong id="ou-signal-title">CONNECTING TO DERIV</strong><p id="ou-signal-message">Opening the public live market feed and loading available symbols.</p></div>' +
          '<div class="ou-metrics"><article><span>Latest digit</span><strong id="ou-last-digit">—</strong><small id="ou-last-price">Waiting for tick</small></article><article><span>Trigger digit frequency</span><strong id="ou-trigger-frequency">—</strong><small id="ou-trigger-label">Selected trigger digit</small></article><article><span>Target digit frequency</span><strong id="ou-target-frequency">—</strong><small id="ou-target-label">Best eligible target</small></article><article><span>Ticks analysed</span><strong id="ou-tick-count">0</strong><small>Rolling sample, max 1,000</small></article></div>' +
          '<div class="ou-frequency-heading"><strong>Digit frequency · 0–9</strong><small>Observed from live Deriv ticks</small></div>' +
          '<div class="ou-digit-grid" id="ou-digit-grid">' + Array.from({length:10},function(_,i){return '<div class="ou-digit-cell" data-digit="'+i+'"><b>'+i+'</b><span>—</span><i></i></div>';}).join('') + '</div>' +
          '<div class="ou-disclaimer">Analysis signal only. No contract is purchased automatically. Frequencies describe the selected sample and do not guarantee the next digit.</div>' +
        '</section>' +
      '</main></div>';
  }

  function mount() {
    if (document.getElementById('dm-app-root')) return;
    try {
      var session = JSON.parse(sessionStorage.getItem('matchestool_session') || 'null');
      if (!session || !session.token || !session.expiresAt || Date.now() >= session.expiresAt) return;
    } catch (e) { return; }
    document.documentElement.classList.add('dm-strategy-page');
    document.body.classList.add('dm-strategy-app');
    var root = document.createElement('div');
    root.id = 'dm-app-root';
    root.innerHTML = template();
    document.body.appendChild(root);
    el('dm-logout').onclick = function () {
      if (window.matchestoolLogout) window.matchestoolLogout();
      location.href = '/';
    };
    var barrier = el('ou-barrier');
    for (var i = 0; i <= 9; i++) barrier.add(new Option(String(i), String(i)));
    barrier.value = '5';
    el('ou-market').onchange = function () { loadMarket(el('ou-market').value); };
    el('ou-contract').onchange = analyse;
    el('ou-barrier').onchange = analyse;
    el('ou-start').onclick = function () { state.manualStopped = false; if (state.selectedSymbol && state.connected && !state.subscriptionId) loadMarket(state.selectedSymbol); else analyse(); };
    el('ou-stop').onclick = function () {
      state.manualStopped = true;
      forgetSubscription();
      setFeed('Analysis stopped', false);
      el('ou-signal-state').textContent = 'STOPPED';
      el('ou-signal-title').textContent = 'ANALYSIS STOPPED';
      el('ou-signal-message').textContent = 'Press START ANALYSIS to resume the live tick stream.';
      el('ou-start').disabled = !state.connected || !state.selectedSymbol;
      el('ou-stop').disabled = true;
    };
    connect();
  }

  function setFeed(text, live) {
    var node = el('ou-connection');
    if (!node) return;
    node.classList.toggle('is-live', !!live);
    el('ou-connection-text').textContent = text;
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    setFeed('Connecting to Deriv…', false);
    try { state.ws = new WebSocket(PUBLIC_WS); }
    catch (e) {
      setFeed('WebSocket unavailable', false);
      el('ou-signal-title').textContent = 'CONNECTION UNAVAILABLE';
      el('ou-signal-message').textContent = 'Your browser could not open the Deriv public feed. Check the internet connection and reload.';
      state.reconnectTimer = setTimeout(connect, 4000);
      return;
    }
    state.ws.onopen = function () {
      state.connected = true;
      setFeed('Deriv live feed connected', true);
      el('ou-signal-state').textContent = 'LOADING MARKETS';
      el('ou-signal-title').textContent = 'DISCOVERING LIVE MARKETS';
      el('ou-signal-message').textContent = 'Requesting active Volatility, 1-second and Jump symbols from Deriv.';
      send({active_symbols: 'brief'}, {type:'symbols'});
    };
    state.ws.onmessage = onMessage;
    state.ws.onerror = function () {
      setFeed('Market feed error · retrying', false);
      el('ou-signal-state').textContent = 'FEED ERROR';
    };
    state.ws.onclose = function () {
      state.connected = false;
      state.subscriptionId = null;
      setFeed('Disconnected · reconnecting', false);
      if (el('ou-market')) el('ou-market').disabled = true;
      state.reconnectTimer = setTimeout(connect, 2500);
    };
  }

  function onMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    var meta = state.requests[msg.req_id] || {};
    if (msg.error) {
      console.warn('Deriv public feed:', msg.error.message);
      if (meta.type === 'symbols') {
        el('ou-signal-title').textContent = 'MARKET LIST UNAVAILABLE';
        el('ou-signal-message').textContent = msg.error.message || 'Deriv did not return the active market list.';
      } else if (meta.type === 'history') {
        el('ou-signal-title').textContent = 'TICK HISTORY UNAVAILABLE';
        el('ou-signal-message').textContent = msg.error.message || 'Could not load recent ticks for this market.';
      }
      return;
    }
    if (msg.msg_type === 'active_symbols') discover(msg.active_symbols || []);
    if ((msg.msg_type === 'history' || msg.msg_type === 'candles') && meta.type === 'history') receiveHistory(meta.symbol, msg);
    if (msg.msg_type === 'tick' && msg.tick) receiveTick(msg.tick);
    if (msg.subscription && msg.subscription.id) state.subscriptionId = msg.subscription.id;
  }

  function discover(rawSymbols) {
    var mapped = rawSymbols.map(function (m) {
      return {
        raw: m,
        symbol: symbolOf(m),
        name: nameOf(m),
        market: m.market || m.market_display_name || '',
        type: m.underlying_symbol_type || m.symbol_type || ''
      };
    }).filter(function (m) {
      if (!m.symbol) return false;
      var hay = (m.symbol + ' ' + m.name + ' ' + m.market + ' ' + m.type).toLowerCase();
      return /volatility|\b1\s*second|\b1s\b|jump/.test(hay) ||
        /^(R_\d+|1HZ\w+|JD\w*|JUMP\w*)$/i.test(m.symbol);
    }).sort(function (a,b) {
      function group(m) {
        var s=(m.symbol+' '+m.name).toLowerCase();
        return /jump|^jd/.test(s) ? 2 : (/1hz|1 second|1s/.test(s) ? 1 : 0);
      }
      return group(a)-group(b) || a.name.localeCompare(b.name);
    });
    var unique = {};
    state.markets = mapped.filter(function (m) {
      if (unique[m.symbol]) return false;
      unique[m.symbol] = true;
      return true;
    });
    var select = el('ou-market');
    select.innerHTML = '';
    if (!state.markets.length) {
      select.add(new Option('No matching live markets returned', ''));
      select.disabled = true;
      el('ou-signal-title').textContent = 'NO MARKETS FOUND';
      el('ou-signal-message').textContent = 'Deriv returned no matching Volatility, 1-second or Jump symbols. Reconnect or try again later.';
      el('ou-signal-state').textContent = 'NO MARKETS';
      return;
    }
    state.markets.forEach(function (m) {
      var label = m.name + ' (' + m.symbol + ')';
      select.add(new Option(label, m.symbol));
    });
    var preferred = state.markets.find(function (m) { return m.symbol === '1HZ100V'; }) ||
      state.markets.find(function (m) { return m.symbol === 'R_100'; }) || state.markets[0];
    select.value = preferred.symbol;
    select.disabled = false;
    el('ou-start').disabled = false;
    loadMarket(preferred.symbol);
  }

  function forgetSubscription() {
    if (state.subscriptionId && state.connected) send({forget: state.subscriptionId});
    state.subscriptionId = null;
  }

  function loadMarket(symbol) {
    if (!symbol || !state.connected) return;
    forgetSubscription();
    state.selectedSymbol = symbol;
    state.samples = [];
    state.sampleReady = false;
    state.signal = null;
    state.lastDigit = null;
    state.manualStopped = false;
    el('ou-market').value = symbol;
    el('ou-feed-badge').textContent = 'LOADING TICKS';
    el('ou-signal-state').textContent = 'ANALYSING';
    el('ou-signal-title').textContent = 'LOADING LIVE TICK HISTORY';
    el('ou-signal-message').textContent = 'Loading up to 1,000 recent ticks for ' + symbol + '.';
    el('ou-last-digit').textContent = '—';
    el('ou-last-price').textContent = 'Waiting for tick';
    el('ou-tick-count').textContent = '0';
    el('ou-sample-status').textContent = 'Loading recent ticks…';
    el('ou-start').disabled = true;
    el('ou-stop').disabled = false;
    var market = state.markets.find(function (m) { return m.symbol === symbol; });
    send({ticks_history: symbol, end: 'latest', count: SAMPLE_SIZE, style: 'ticks'}, {type:'history', symbol:symbol, market:market});
  }

  function inferPip(prices) {
    var max = 0;
    (prices || []).slice(-100).forEach(function (p) {
      var s = String(p);
      max = Math.max(max, (s.split('.')[1] || '').length);
    });
    return Math.min(8, Math.max(0, max));
  }

  function getDigit(price, pip) {
    var fixed = Number(price).toFixed(Math.max(0, Math.min(8, Number(pip) || 0)));
    return Number(fixed.charAt(fixed.length - 1));
  }

  function receiveHistory(symbol, msg) {
    if (symbol !== state.selectedSymbol) return;
    var history = msg.history || {};
    var prices = history.prices || [];
    if (!prices.length) {
      el('ou-signal-title').textContent = 'NO TICK HISTORY';
      el('ou-signal-message').textContent = 'Deriv returned no recent prices for ' + symbol + '. Select another market.';
      el('ou-signal-state').textContent = 'NO DATA';
      el('ou-start').disabled = false;
      el('ou-sample-status').textContent = 'No historical ticks received.';
      return;
    }
    state.pip = Number(msg.pip_size != null ? msg.pip_size : (msg.tick && msg.tick.pip_size != null ? msg.tick.pip_size : inferPip(prices)));
    state.samples = prices.slice(-SAMPLE_SIZE).map(function (p) { return Number(p); }).filter(Number.isFinite);
    state.sampleReady = true;
    el('ou-feed-badge').textContent = 'LIVE ANALYSIS';
    el('ou-signal-state').textContent = 'WAITING FOR SETUP';
    el('ou-sample-status').textContent = state.samples.length.toLocaleString() + ' historical ticks loaded; waiting for live updates.';
    el('ou-start').disabled = false;
    send({ticks: symbol, subscribe: 1}, {type:'ticks', symbol:symbol});
    analyse();
  }

  function receiveTick(tick) {
    var symbol = tick.symbol || tick.underlying_symbol;
    if (!symbol || symbol !== state.selectedSymbol || state.manualStopped) return;
    var quote = Number(tick.quote);
    if (!Number.isFinite(quote)) return;
    if (tick.pip_size != null) state.pip = Number(tick.pip_size);
    state.samples.push(quote);
    if (state.samples.length > SAMPLE_SIZE) state.samples.shift();
    state.lastDigit = getDigit(quote, state.pip);
    el('ou-last-digit').textContent = String(state.lastDigit);
    el('ou-last-price').textContent = quote.toFixed(state.pip) + ' · ' + clock(tick.epoch);
    el('ou-tick-count').textContent = state.samples.length.toLocaleString();
    el('ou-sample-status').textContent = 'Live tick received at ' + clock(tick.epoch);
    analyse();
  }

  function getStats() {
    var counts = Array(10).fill(0);
    state.samples.forEach(function (price) { counts[getDigit(price, state.pip)]++; });
    var total = state.samples.length;
    return {
      counts: counts,
      freq: counts.map(function (n) { return total ? n / total * 100 : 0; }),
      total: total
    };
  }

  function analyse() {
    if (!el('ou-contract')) return;
    var stats = getStats();
    var type = el('ou-contract').value;
    var barrier = Number(el('ou-barrier').value);
    var current = state.lastDigit;
    var triggerSide = function (d) { return type === 'OVER' ? d <= barrier : d >= barrier; };
    var targetSide = function (d) { return type === 'OVER' ? d > barrier : d < barrier; };
    var eligibleTargets = [];
    for (var d = 0; d <= 9; d++) {
      if (targetSide(d) && stats.freq[d] >= HIGH_DIGIT_LIMIT) eligibleTargets.push(d);
    }
    eligibleTargets.sort(function (a,b) { return stats.freq[b]-stats.freq[a]; });
    var triggerFreq = current == null ? null : stats.freq[current];
    var triggerOK = current != null && triggerSide(current) && triggerFreq < LOW_DIGIT_LIMIT;
    var ready = stats.total >= 100 && triggerOK && eligibleTargets.length > 0 && !state.manualStopped;
    var signalText = 'BUY ' + type + ' ' + barrier;
    var bestTarget = eligibleTargets.length ? eligibleTargets[0] : null;
    renderFrequencies(stats, type, barrier, current, bestTarget);
    el('ou-trigger-frequency').textContent = triggerFreq == null ? '—' : pct(triggerFreq);
    el('ou-trigger-label').textContent = current == null ? 'Waiting for current digit' : 'Digit ' + current + (triggerOK ? ' qualifies' : ' does not qualify');
    el('ou-target-frequency').textContent = bestTarget == null ? '—' : pct(stats.freq[bestTarget]);
    el('ou-target-label').textContent = bestTarget == null ? 'No target at 10.5%+' : 'Target digit ' + bestTarget + (eligibleTargets.length > 1 ? ' (+' + (eligibleTargets.length - 1) + ' more)' : '');
    if (!state.sampleReady) return;
    if (state.manualStopped) {
      el('ou-signal-state').textContent = 'STOPPED';
      return;
    }
    if (ready) {
      state.signal = {type:type, barrier:barrier, trigger:current, triggerFrequency:triggerFreq, target:bestTarget, targetFrequency:stats.freq[bestTarget], time:Date.now()};
      el('ou-signal-state').textContent = 'SIGNAL READY';
      el('ou-signal-title').textContent = signalText;
      el('ou-signal-message').textContent = 'Live trigger digit ' + current + ' is ' + pct(triggerFreq) + ' (below 10.4%). Target digit ' + bestTarget + ' is ' + pct(stats.freq[bestTarget]) + ' (at least 10.5%) in the last ' + stats.total + ' ticks.';
      el('ou-signal-call').classList.add('is-signal');
      el('ou-feed-badge').textContent = 'SIGNAL CONDITION MET';
    } else {
      state.signal = null;
      el('ou-signal-state').textContent = stats.total < 100 ? 'BUILDING SAMPLE' : 'WAITING FOR SETUP';
      el('ou-signal-title').textContent = 'WAITING FOR SIGNAL';
      var why = stats.total < 100 ? 'Collecting enough live tick data before evaluating the rule.' :
        current == null ? 'Waiting for the next live tick.' :
        !triggerSide(current) ? 'Latest digit ' + current + ' is not on the trigger side for ' + type + ' ' + barrier + '.' :
        !(triggerFreq < LOW_DIGIT_LIMIT) ? 'Latest digit frequency is ' + pct(triggerFreq) + '; it must be below 10.4%.' :
        'No eligible target digit on the winning side is at or above 10.5% yet.';
      el('ou-signal-message').textContent = why;
      el('ou-signal-call').classList.remove('is-signal');
      el('ou-feed-badge').textContent = 'LIVE ANALYSIS';
    }
  }

  function renderFrequencies(stats, type, barrier, current, bestTarget) {
    var cells = document.querySelectorAll('.ou-digit-cell');
    Array.prototype.forEach.call(cells, function (cell) {
      var d = Number(cell.getAttribute('data-digit'));
      var f = stats.freq[d] || 0;
      cell.querySelector('span').textContent = stats.total ? pct(f) : '—';
      cell.querySelector('i').style.height = Math.min(100, f * 5) + '%';
      cell.classList.toggle('is-trigger', current === d && (type === 'OVER' ? d <= barrier : d >= barrier));
      cell.classList.toggle('is-target', bestTarget === d);
      cell.classList.toggle('is-winning-side', type === 'OVER' ? d > barrier : d < barrier);
      cell.classList.toggle('is-low-frequency', f < LOW_DIGIT_LIMIT && stats.total >= 100);
    });
  }

  window.addEventListener('load', function () { setTimeout(mount, 120); });
})();
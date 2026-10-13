(function () {
  'use strict';

  // Public Deriv market data only. This page never places trades or requests an account token.
  var PUBLIC_WS_ENDPOINTS = [];
  var derivAppId = '';
  var SAMPLE_SIZE = 1000;
  var LOW_DIGIT_LIMIT = 10.4;
  var HIGH_DIGIT_LIMIT = 10.5;
  var state = {
    ws: null, connected: false, reconnectTimer: null, feedTimeout: null, connectTimeout: null, heartbeatTimer: null, requestId: 0, requests: {}, endpointIndex: 0, marketResponse: false,
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
          '<section class="ou-legacy-match"><div><span class="dm-kicker">Existing feature retained</span><strong>Digit Match monitor</strong><small>Highest-frequency digit from the same live tick sample</small></div><div class="ou-legacy-stat"><b id="ou-legacy-digit">—</b><span id="ou-legacy-frequency">—</span><small id="ou-legacy-count">Waiting for tick data</small></div></section>' +
          '<div class="ou-disclaimer">Analysis signals only. No contract is purchased automatically. Frequencies describe the selected sample and do not guarantee the next digit.</div>' +
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
    loadDerivConfig();
  }

  function loadDerivConfig() {
    fetch('/api/deriv-config', { cache: 'no-store' })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Could not load Deriv App ID configuration.');
          return data;
        });
      })
      .then(function (data) {
        derivAppId = String(data.appId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(derivAppId)) throw new Error('DERIV_APP_ID has an unsupported format. Check your registered Deriv application.');
        var encodedId = encodeURIComponent(derivAppId);
        // The legacy v3 public WebSocket API requires a numeric registered App ID.
        // The supplied mixed-format value is not treated as a valid v3 App ID.
        // Keep the public feed on the documented v3 endpoint and expose connection
        // errors instead of cycling endpoints that cannot fix an invalid App ID.
        PUBLIC_WS_ENDPOINTS = [
          'wss://ws.derivws.com/websockets/v3?app_id=' + encodedId,
          'wss://ws.binaryws.com/websockets/v3?app_id=' + encodedId
        ];
        connect();
      })
      .catch(function (error) {
        setFeed('Deriv App ID not configured', false);
        el('ou-signal-state').textContent = 'CONFIGURATION REQUIRED';
        el('ou-signal-title').textContent = 'ADD YOUR DERIV APP ID';
        el('ou-signal-message').textContent = (error && error.message ? error.message : 'Unable to load the saved Deriv App ID.') + ' Check DERIV_APP_ID in Vercel Settings → Environment Variables, then redeploy.';
        state.reconnectTimer = setTimeout(loadDerivConfig, 5000);
      });
  }

  function setFeed(text, live) {
    var node = el('ou-connection');
    if (!node) return;
    node.classList.toggle('is-live', !!live);
    el('ou-connection-text').textContent = text;
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    clearTimeout(state.feedTimeout);
    clearTimeout(state.connectTimeout);
    clearInterval(state.heartbeatTimer);
    state.connected = false;
    state.marketResponse = false;
    setFeed('Connecting to Deriv…', false);
    var endpoint = PUBLIC_WS_ENDPOINTS[state.endpointIndex % PUBLIC_WS_ENDPOINTS.length];
    var socket;
    try { socket = new WebSocket(endpoint); state.ws = socket; }
    catch (e) {
      setFeed('WebSocket unavailable', false);
      el('ou-signal-title').textContent = 'CONNECTION UNAVAILABLE';
      el('ou-signal-message').textContent = 'Your browser could not open the Deriv public feed. Check the internet connection and reload.';
      state.reconnectTimer = setTimeout(connect, 4000);
      return;
    }
    socket.onopen = function () {
      if (state.ws !== socket) return;
      clearTimeout(state.feedTimeout);
      clearTimeout(state.connectTimeout);
      setFeed('Socket open · checking Deriv API', false);
      el('ou-signal-state').textContent = 'CHECKING CONNECTION';
      el('ou-signal-title').textContent = 'CHECKING DERIV LIVE FEED';
      el('ou-signal-message').textContent = 'Testing the public API connection before requesting available markets.';
      state.marketResponse = false;
      send({ping: 1}, {type:'initial-ping'});
      state.heartbeatTimer = setInterval(function () {
        if (state.ws === socket && socket.readyState === 1) send({ping: 1}, {type:'ping'});
      }, 20000);
      state.feedTimeout = setTimeout(function () {
        if (state.ws === socket && !state.marketResponse) {
          setFeed('No Deriv response · switching endpoint', false);
          try { socket.close(); } catch (e) {}
        }
      }, 9000);
    };
    socket.onmessage = function (event) { if (state.ws === socket) onMessage(event); };
    state.connectTimeout = setTimeout(function () {
      if (state.ws === socket && socket.readyState !== 1) {
        setFeed('Connection timed out · retrying', false);
        try { socket.close(); } catch (e) {}
      }
    }, 10000);
    socket.onerror = function () {
      if (state.ws !== socket) return;
      setFeed('WebSocket error · trying next endpoint', false);
      el('ou-signal-state').textContent = 'FEED ERROR';
      try { socket.close(); } catch (e) {}
    };
    socket.onclose = function (event) {
      if (state.ws !== socket) return;
      clearInterval(state.heartbeatTimer);
      clearTimeout(state.feedTimeout);
      clearTimeout(state.connectTimeout);
      state.connected = false;
      state.subscriptionId = null;
      state.endpointIndex = (state.endpointIndex + 1) % PUBLIC_WS_ENDPOINTS.length;
      var closeInfo = event && event.code ? ' (code ' + event.code + ')' : '';
      setFeed('Disconnected' + closeInfo + ' · trying endpoint ' + ((state.endpointIndex % PUBLIC_WS_ENDPOINTS.length) + 1) + '/' + PUBLIC_WS_ENDPOINTS.length, false);
      if (el('ou-market')) el('ou-market').disabled = true;
      if (el('ou-signal-title')) el('ou-signal-title').textContent = 'RECONNECTING TO DERIV';
      if (el('ou-signal-message')) el('ou-signal-message').textContent = 'Connection ended before Deriv replied' + (event && event.reason ? ' (' + event.reason + ')' : '') + '. Retrying endpoint automatically. The app tries public endpoints without an App ID before trying the configured identifier. If all fail, check the network/browser WebSocket connection.';
      state.reconnectTimer = setTimeout(connect, 1800);
    };
  }

  function onMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    var meta = state.requests[msg.req_id] || {};
    if (meta.type === 'initial-ping' && (msg.msg_type === 'ping' || (msg.echo_req && msg.echo_req.ping))) {
      if (state.ws && state.ws.readyState === 1) {
        el('ou-signal-title').textContent = 'DISCOVERING LIVE MARKETS';
        el('ou-signal-message').textContent = 'Deriv replied. Requesting active Volatility, 1-second, Jump and other available symbols.';
        send({active_symbols: 'brief', product_type: 'basic'}, {type:'symbols'});
      }
      return;
    }
    if (msg.msg_type === 'ping' || (msg.echo_req && msg.echo_req.ping)) return;
    if (msg.error) {
      console.warn('Deriv public feed:', msg.error.code, msg.error.message);
      if (meta.type === 'symbols') {
        state.marketResponse = true;
        clearTimeout(state.feedTimeout);
        setFeed('Deriv rejected market request', false);
        el('ou-signal-title').textContent = 'MARKET LIST UNAVAILABLE';
        el('ou-signal-message').textContent = (msg.error.message || 'Deriv did not return the active market list.') + ' Switching public endpoints automatically.';
        if (state.ws && state.ws.readyState === 1) state.ws.close();
      } else if (meta.type === 'history') {
        el('ou-signal-title').textContent = 'TICK HISTORY UNAVAILABLE';
        el('ou-signal-message').textContent = msg.error.message || 'Could not load recent ticks for this market.';
      }
      return;
    }
    if (msg.msg_type === 'active_symbols') {
      state.connected = true;
      state.marketResponse = true;
      clearTimeout(state.feedTimeout);
      setFeed('Deriv live feed connected', true);
      discover(msg.active_symbols || []);
    }
    if ((msg.msg_type === 'history' || msg.msg_type === 'candles') && meta.type === 'history') receiveHistory(meta.symbol, msg);
    if (msg.msg_type === 'tick' && msg.tick) receiveTick(msg.tick);
    if (msg.subscription && msg.subscription.id) state.subscriptionId = msg.subscription.id;
  }

  function marketGroup(m) {
    var hay = (m.symbol + ' ' + m.name + ' ' + m.market + ' ' + m.type).toLowerCase();
    if (/jump|^jd/.test(hay)) return 'Jump indices';
    if (/1hz|1-second|1 second|\b1s\b/.test(hay)) return '1-second indices';
    if (/volatility|^r_\d+/.test(hay)) return 'Volatility indices';
    if (/forex|currency|\b[a-z]{3}\s*\/\s*[a-z]{3}\b/.test(hay)) return 'Forex & currencies';
    if (/gold|silver|commodity|metal/.test(hay)) return 'Metals & commodities';
    if (/stock|equity|index/.test(hay)) return 'Stocks & other indices';
    return 'Other available markets';
  }

  function discover(rawSymbols) {
    state.marketResponse = true;
    clearTimeout(state.feedTimeout);
    var mapped = rawSymbols.map(function (m) {
      return {
        raw: m,
        symbol: symbolOf(m),
        name: nameOf(m),
        market: m.market || m.market_display_name || '',
        type: m.underlying_symbol_type || m.symbol_type || ''
      };
    }).filter(function (m) { return !!m.symbol; });
    var unique = {};
    state.markets = mapped.filter(function (m) {
      if (unique[m.symbol]) return false;
      unique[m.symbol] = true;
      m.group = marketGroup(m);
      return true;
    }).sort(function (a,b) {
      var order = ['Volatility indices','1-second indices','Jump indices','Forex & currencies','Metals & commodities','Stocks & other indices','Other available markets'];
      var ag = order.indexOf(a.group), bg = order.indexOf(b.group);
      return ag - bg || a.name.localeCompare(b.name);
    });

    var select = el('ou-market');
    select.innerHTML = '';
    if (!state.markets.length) {
      select.add(new Option('Deriv returned no active markets', ''));
      select.disabled = true;
      el('ou-signal-title').textContent = 'NO ACTIVE MARKETS';
      el('ou-signal-message').textContent = 'Deriv connected but returned an empty market list. The app will retry automatically.';
      el('ou-signal-state').textContent = 'NO MARKETS';
      if (state.ws && state.ws.readyState === 1) state.ws.close();
      return;
    }

    var groups = {};
    state.markets.forEach(function (m) {
      if (!groups[m.group]) {
        groups[m.group] = document.createElement('optgroup');
        groups[m.group].label = m.group;
        select.appendChild(groups[m.group]);
      }
      groups[m.group].appendChild(new Option(m.name + ' (' + m.symbol + ')', m.symbol));
    });

    var preferred = state.markets.find(function (m) { return m.symbol === '1HZ100V'; }) ||
      state.markets.find(function (m) { return m.symbol === 'R_100'; }) ||
      state.markets.find(function (m) { return m.group === 'Volatility indices'; }) ||
      state.markets[0];
    select.value = preferred.symbol;
    select.disabled = false;
    el('ou-start').disabled = false;
    el('ou-signal-title').textContent = 'MARKETS READY';
    el('ou-signal-message').textContent = state.markets.length + ' active Deriv markets discovered. Select a market to load live ticks.';
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
    var topDigit = 0;
    for (var td = 1; td <= 9; td++) if (stats.counts[td] > stats.counts[topDigit]) topDigit = td;
    var legacyDigit = el('ou-legacy-digit');
    var legacyFrequency = el('ou-legacy-frequency');
    var legacyCount = el('ou-legacy-count');
    if (legacyDigit) legacyDigit.textContent = stats.total ? String(topDigit) : '—';
    if (legacyFrequency) legacyFrequency.textContent = stats.total ? pct(stats.freq[topDigit]) : '—';
    if (legacyCount) legacyCount.textContent = stats.total ? stats.counts[topDigit] + ' occurrences in ' + stats.total + ' ticks' : 'Waiting for tick data';
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
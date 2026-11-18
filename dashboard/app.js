// Launch Radar's page. It reads window.RADAR (data.js, written beside dashboard/ by main.ts from
// the same model that wrote board.json) and renders the ranked board, a filterable and sortable
// table, a detail view per protocol with the model's own arithmetic, and the already-trading set
// kept apart. No network and no fetch: every byte it shows arrived in data.js.
//
// Routes live in the hash so a view can be linked and screenshotted exactly:
//   #/board            the ranked pre-token board      #/live    the already-trading set
//   #/p/<slug>         one protocol's detail view      #/board?cat=Lending&watch=1   a filtered board
(function () {
  'use strict';

  var DATA = window.RADAR;
  var view = document.getElementById('view');
  if (!DATA || !view) return;

  var state = { tab: 'board', q: '', cat: 'all', chain: 'all', watch: false, sort: 'rank', dir: 1, slug: null };

  /* ---------- formatting ---------- */
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.round(days) + ' days';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- masthead, stats, model strip ---------- */
  document.getElementById('meta').textContent =
    'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · model ' + DATA.model_version;
  var stats = [
    [DATA.scanned, 'protocols scanned'],
    [DATA.board_size, 'pre-token ranked'],
    [DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'],
    [DATA.live_size, 'already trading'],
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>';
  }).join('');

  var m = DATA.model;
  document.getElementById('model-strip').innerHTML =
    '<h2>How a value is made</h2>' +
    '<p><span class="formula">implied = TVL x category multiple x growth x track record x footprint</span></p>' +
    '<p class="fine">The category multiple is the market\'s own price for a launch today: the median market-cap / TVL of the ' +
    'tokenized protocols in the same category, read off this snapshot and shrunk toward the all-market median when a category ' +
    'has few trading peers (shrinkage K = ' + m.shrink_k + ', capped ' + m.multiple_floor + ' to ' + m.multiple_cap + '). ' +
    'Growth multiplies by 1 + clamp(7-day TVL change, ' + m.growth_floor + '%, +' + m.growth_cap + '%) x ' + m.growth_weight + '; ' +
    'track record by ' + m.age_floor + ' rising to 1.00 over ' + (m.age_days_cap / 365) + ' years with no token; footprint adds ' +
    Math.round(m.breadth_per_chain * 100) + '% per extra chain, up to ' + m.breadth_chain_cap + '. No name is special-cased: ' +
    'one function in lib/model.ts scores every row, and each detail view shows its arithmetic. The radar score (0-100) is a ' +
    'readiness gauge beside the value, never the rank: ranks are implied value alone.</p>';

  document.getElementById('foot').innerHTML =
    '<p>Every protocol on this board <b>records no token</b> in the snapshot: DefiLlama carries no market cap, CoinGecko id or ' +
    'symbol for it. That is a statement about the record, not proof no token exists. Wrapped, staked and bridged products of ' +
    'tokens that already trade, versioned pools and exchange house products are screened out by the same rule the house ' +
    'applies to its watchlist; the watchlist\'s $' + (DATA.floor_usd / 1e6) + 'M size floor is the only line this board drops.</p>' +
    '<p>An implied value is this board\'s own claim about what a launch would be worth if the protocol\'s record stayed as it ' +
    'is. It is not a prediction that a token will be issued, or when. Farm plans are starting points with stated costs, not advice.</p>';

  /* ---------- controls ---------- */
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watch');
  var countEl = document.getElementById('count');

  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="all">' + esc(allLabel) + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var cats = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  fillSelect(catEl, cats, 'All categories');
  fillSelect(chainEl, chains, 'All chains');

  function syncControls() {
    qEl.value = state.q;
    catEl.value = state.cat;
    chainEl.value = state.chain;
    watchEl.checked = state.watch;
    document.getElementById('tab-board').classList.toggle('active', state.tab === 'board');
    document.getElementById('tab-live').classList.toggle('active', state.tab === 'live');
    var boardOnly = state.tab === 'board' && !state.slug;
    qEl.disabled = !boardOnly; catEl.disabled = !boardOnly; chainEl.disabled = !boardOnly; watchEl.disabled = !boardOnly;
  }

  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function boardHash() {
    var parts = [];
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    return '#/board' + (parts.length ? '?' + parts.join('&') : '');
  }
  qEl.addEventListener('input', function () { state.q = qEl.value; history.replaceState(null, '', boardHash()); render(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; history.replaceState(null, '', boardHash()); render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; history.replaceState(null, '', boardHash()); render(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; history.replaceState(null, '', boardHash()); render(); });
  document.getElementById('tab-board').addEventListener('click', function () { go('#/board'); });
  document.getElementById('tab-live').addEventListener('click', function () { go('#/live'); });

  /* ---------- the board ---------- */
  var COLUMNS = [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Protocol', num: false },
    { key: 'category', label: 'Category', num: false },
    { key: 'chains', label: 'Chains', num: false, cls: 'chains-col' },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'age_days', label: 'Tracked', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true },
    { key: 'radar_score', label: 'Radar', num: true },
  ];

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + (r.category || '') + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[key]; var y = b[key];
      if (key === 'chains') { x = a.chains.length; y = b.chains.length; }
      if (key === 'name' || key === 'category') {
        x = (x || '').toLowerCase(); y = (y || '').toLowerCase();
        return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * dir;
      }
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x - y) * dir || (a.rank - b.rank);
    });
  }

  function scoreClass(s) { return s >= 60 ? 'score' : s >= 40 ? 'score mid' : 'score low'; }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    countEl.textContent = rows.length + ' of ' + DATA.board_size + ' protocols';
    var head = COLUMNS.map(function (c) {
      var arrow = state.sort === c.key ? ' <span class="dir">' + (state.dir === 1 ? '&#9650;' : '&#9660;') + '</span>' : '';
      return '<th class="sortable' + (c.num ? ' num' : '') + (c.cls ? ' ' + c.cls : '') + '" data-sort="' + c.key + '">' + c.label + arrow + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      var chg = r.change_7d === null ? '<td class="num">n/a</td>'
        : '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>';
      return '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="star">watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains chains-col">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + chg +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="num"><span class="' + scoreClass(r.radar_score) + '">' + r.radar_score + '</span></td></tr>';
    }).join('');
    view.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="9" class="empty">No protocol matches these filters. Loosen one and the radar sweeps again.</td></tr>') +
      '</tbody></table>';
    view.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
        render();
      });
    });
    view.querySelectorAll('tr.row').forEach(function (tr) {
      tr.addEventListener('click', function () { go('#/p/' + tr.getAttribute('data-slug')); });
    });
  }

  /* ---------- the already-trading set ---------- */
  function renderLive() {
    countEl.textContent = DATA.live.length + ' trading protocols, kept off the board';
    var body = DATA.live.map(function (r) {
      var chg = r.change_7d === null ? '<td class="num">n/a</td>'
        : '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>';
      return '<tr><td class="name">' + esc(r.name) + (r.symbol ? ' <span class="slug">' + esc(r.symbol) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains chains-col">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.mcap_usd) + '</b></td>' +
        '<td class="num">' + (r.mcap_tvl === null ? 'n/a' : 'x' + r.mcap_tvl.toFixed(2)) + '</td>' + chg + '</tr>';
    }).join('');
    view.innerHTML =
      '<p class="note" style="margin:2px 0 12px">These protocols already trade: the market, not the model, prices them, so they are ' +
      'never ranked on the board. Their market-cap / TVL ratios are the peer evidence the board\'s category multiples are read from.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="chains-col">Chains</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">MCap / TVL</th><th class="num">7d</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  /* ---------- one protocol ---------- */
  function factorRow(label, value, width, note) {
    return '<tr><td>' + esc(label) + '</td><td class="num">' + esc(value) + '</td>' +
      '<td><div class="bar"><i style="width:' + Math.max(3, Math.min(100, width)) + '%"></i></div></td><td>' + esc(note) + '</td></tr>';
  }

  function renderDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) { view.innerHTML = '<a class="back" href="#/board">&larr; back to the board</a><p class="empty">No board protocol with that name.</p>'; return; }
    countEl.textContent = 'rank #' + r.rank + ' of ' + DATA.board_size;
    var growthW = ((r.growth_multiplier - 0.775) / (1.675 - 0.775)) * 100;
    var ageW = ((r.age_multiplier - 0.65) / 0.35) * 100;
    var breadthW = ((r.breadth_multiplier - 1) / 0.21) * 100;
    var multW = (Math.log(Math.max(r.peer_multiple, 0.03)) - Math.log(0.03)) / (Math.log(1.5) - Math.log(0.03)) * 100;
    var cells = [
      ['Implied launch value', fmtUsd(r.implied_value_usd), 'glow'],
      ['TVL (snapshot)', fmtUsd(r.tvl_usd), ''],
      ['Radar score', String(r.radar_score) + ' / 100', ''],
      ['7-day TVL change', fmtPct(r.change_7d), ''],
      ['Tracked for', fmtAge(r.age_days) + (r.listed_at ? ' (since ' + r.listed_at + ')' : ''), ''],
      ['Board status', r.watchlist ? 'Watchlist (above the $50M floor)' : 'Early find (below the floor)', ''],
    ];
    view.innerHTML =
      '<a class="back" href="#/board">&larr; back to the board</a>' +
      '<section class="detail"><h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · records no token · rank #' + r.rank + '</p>' +
      '<div class="grid">' + cells.map(function (c) {
        return '<div class="cell"><span>' + esc(c[0]) + '</span><b class="' + c[2] + '">' + esc(c[1]) + '</b></div>';
      }).join('') + '</div>' +
      '<h3>How this value is made</h3>' +
      '<table class="factors">' +
      factorRow('TVL base', fmtUsd(r.tvl_usd), 100, 'the protocol\'s own total value locked in the snapshot') +
      factorRow('Category multiple', fmtMult(r.peer_multiple), multW, 'median market-cap / TVL of ' + r.category_peers + ' trading ' + esc(r.category || 'category') + ' peers, shrunk toward the market median') +
      factorRow('Growth', fmtMult(r.growth_multiplier), growthW, '7-day TVL change of ' + fmtPct(r.change_7d) + ', clamped and weighted by the model') +
      factorRow('Track record', fmtMult(r.age_multiplier), ageW, fmtAge(r.age_days) + ' with no token recorded: survival is evidence') +
      factorRow('Footprint', fmtMult(r.breadth_multiplier), breadthW, 'live on ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', '))) +
      '<tr><td>Implied launch value</td><td class="num">' + fmtUsd(r.implied_value_usd) + '</td><td></td><td>the board\'s claim, if the record stayed as it is</td></tr>' +
      '</table>' +
      '<h3>Farm plan</h3><ol class="plan">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<p class="note">Costs are per wallet and stated before you start: size the position to the plan, not the other way round, ' +
      'and never pay a third party to "unlock" a claim. A protocol this size may never issue a token; the plan is written so the ' +
      'position is defensible even if none comes.</p></section>';
  }

  /* ---------- routing ---------- */
  function parseHash() {
    var h = location.hash || '#/board';
    state.slug = null; state.tab = 'board';
    if (h.indexOf('#/p/') === 0) { state.slug = decodeURIComponent(h.slice(4)); return; }
    if (h.indexOf('#/live') === 0) { state.tab = 'live'; return; }
    var qi = h.indexOf('?');
    if (qi >= 0) {
      var params = new URLSearchParams(h.slice(qi + 1));
      state.cat = params.get('cat') || 'all';
      state.chain = params.get('chain') || 'all';
      state.watch = params.get('watch') === '1';
      state.q = params.get('q') || '';
    }
  }

  function render() {
    parseHash();
    syncControls();
    if (state.slug) renderDetail(state.slug);
    else if (state.tab === 'live') renderLive();
    else renderBoard();
  }

  window.addEventListener('hashchange', render);
  render();
})();

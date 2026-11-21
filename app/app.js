/* Zamu — auto-rotating bulk SMS scheduler (interactive prototype).
   Same engine as the Android build: build/app/engine.js. Sending is simulated in the browser. */
(function () {
  'use strict';
  var E = window.ZamuEngine, D = window.ZamuData;
  var Q = new URLSearchParams(location.search);
  var SHOT = Q.get('shot');                         // frozen screen for the boards / screenshots
  var KEY = 'zamu.v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ---------- formatting ---------- */
  function d(ms) { return new Date(ms); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function nf(n) { return Number(n).toLocaleString('en-US'); }
  function t24(ms) { var x = d(ms); return p2(x.getUTCHours()) + ':' + p2(x.getUTCMinutes()); }
  function t12(ms) { var x = d(ms), h = x.getUTCHours(), ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return p2(h) + ':' + p2(x.getUTCMinutes()) + ' ' + ap; }
  function dShort(ms) { var x = d(ms); return p2(x.getUTCDate()) + ' ' + MON[x.getUTCMonth()]; }
  function dDow(ms) { var x = d(ms); return DOW[x.getUTCDay()] + ' ' + p2(x.getUTCDate()) + ' ' + MON[x.getUTCMonth()]; }
  function dFull(ms) { var x = d(ms); return DOW[x.getUTCDay()] + ' ' + p2(x.getUTCDate()) + ' ' + MON[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ph(e164) { return E.displayPhone(e164); }
  function ini(name) { return name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function avc(i) { return 'a' + ((i % 5) + 1); }
  function ic(name, cls) { return '<span class="ms' + (cls ? ' ' + cls : '') + '">' + name + '</span>'; }

  /* ---------- state ---------- */
  var S = { sch: null, running: true, route: 'home', ui: {}, settings: null, now: 0, timer: null };
  var DEF_SETTINGS = {
    autoAdd: true, fwdNumber: '0754 818 020', fwdMissed: true, fwdReplies: true, autoReply: true, replyTo: 'All',
    autoResched: true, autoAllow: true, resume: true, battery: true, sim: 1,
    rules: [['BEI', 'Bei ya DOT 4 ni TSh 18,000 kwa lita. Karibu dukani!'], ['MAHALI', 'Tupo Mbeya mjini, karibu na stendi kuu.'], ['STOP', 'Umeondolewa. Hutapokea SMS zaidi.']]
  };

  function boot() {
    S.settings = JSON.parse(JSON.stringify(DEF_SETTINGS));
    var restored = false;
    if (!SHOT) {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
          var snap = JSON.parse(raw);
          var clients = snap.clients.map(function (c) { return { name: c[0], phone: c[1], group: c[2] }; });
          S.sch = E.Scheduler.restore(snap.sch, clients);
          S.settings = Object.assign(S.settings, snap.settings || {});
          S.running = false; restored = true;
        }
      } catch (e) { S.sch = null; }
    }
    if (!S.sch) { S.sch = D.demoScheduler(); S.running = !!SHOT; }
    S.now = lastMs() + 25000;
    S.route = SHOT ? ({ search: 'planner' }[SHOT] || SHOT) : (location.hash.replace('#/', '') || 'home');
    if (SHOT) presetShot(SHOT);
    render();
    if (restored) toast('Resumed from SMS #' + nf(S.sch.log.length + 1) + ' — exactly where it stopped');
    window.addEventListener('hashchange', function () { var r = location.hash.replace('#/', '') || 'home'; if (r !== S.route) { S.route = r; S.ui.sheet = null; render(); } });
  }
  function lastMs() { var l = S.sch.log; return l.length ? l[l.length - 1].ms : S.sch.timeOf(0) - 60000; }
  function save() {
    if (SHOT) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ sch: S.sch.snapshot(), settings: S.settings, clients: S.sch.clients.map(function (c) { return [c.name, c.phone, c.group]; }) }));
    } catch (e) { /* quota: keep running */ }
  }
  function presetShot(s) {
    if (s === 'clients') { S.ui.sheet = 'phonebook'; S.ui.pbQuery = 'jo'; S.ui.pbSel = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 }; S.ui.importInfo = { file: 'wateja_mbeya.xlsx', rows: 3000, added: 2987, dup: 13, ms: 1400 }; }
    if (s === 'search') { S.ui.search = '0755 214 873'; S.ui.selClient = 0; S.ui.selRows = {}; S.sch.forClient(0).forEach(function (r) { if (r.state !== 'sent') S.ui.selRows[r.ms] = 1; }); }
  }

  /* ---------- helpers on the plan ---------- */
  function T(i) { return S.sch.templates[i]; }
  function tn(i) { return T(i).id; }                       // stable template number (T1…T5)
  function tcls(i) { return 't' + (((T(i).id - 1) % 5) + 1); }
  function chip(i, lg) { return '<span class="tc ' + tcls(i) + (lg ? ' lg' : '') + '">T' + tn(i) + '</span>'; }
  function tplText(i, name) { return T(i).text.replace(/\{name\}/g, name ? name.split(' ')[0] : '{name}'); }
  function rotationOk() { var l = S.sch.log, act = S.sch.activeTemplates(); for (var i = 1; i < l.length; i++) { if (l[i].retry || l[i - 1].retry) continue; var a = act.indexOf(l[i - 1].t), b = act.indexOf(l[i].t); if (a >= 0 && b >= 0 && b !== (a + 1) % act.length) return false; } return true; }
  function perClientDays() { var M = S.sch.activeClientCount(), perDay = S.sch.clock.perDay; return Math.max(1, Math.round(M / perDay * 7 / (7 - (S.sch.cfg.skipDays || []).length))); }

  /* ---------- chrome ---------- */
  function statusBar() {
    return '<div class="statusbar"><span class="num">' + t24(S.now) + '</span><span class="sb-r">' +
      '<span class="sim">' + ic('signal_cellular_alt', 'f') + '<b>1</b></span><span class="sim">' + ic('signal_cellular_alt_2_bar', 'f') + '<b>2</b></span>' +
      ic('wifi', 'f') + ic('battery_5_bar', 'f') + '<span class="batt">86%</span></span></div>';
  }
  function gesture() { return '<div class="gesture"><i></i></div>'; }
  function nav(active) {
    var items = [['home', 'home', 'Home'], ['clients', 'group', 'Clients'], ['templates', 'view_carousel', 'Templates'], ['planner', 'calendar_month', 'Planner'], ['report', 'receipt_long', 'Report']];
    return '<nav class="nav">' + items.map(function (it) {
      return '<button data-go="' + it[0] + '" class="' + (it[0] === active ? 'on' : '') + '"><span class="pill">' + ic(it[1]) + '</span>' + it[2] + '</button>';
    }).join('') + '</nav>';
  }
  function subBar(title, sub, right) {
    return '<div class="appbar sub"><button class="iconbtn" data-go="home">' + ic('arrow_back') + '</button><div class="grow"><h1 style="font-size:21px">' + title + '</h1>' +
      (sub ? '<div class="sub-t">' + sub + '</div>' : '') + '</div>' + (right || '') + '</div>';
  }
  function mark(size) {
    var cols = ['#6C5CE7', '#F2B233', '#23A26D', '#EF6F3C', '#3B82E0'], r = 13, c = 18, out = '';
    for (var i = 0; i < 5; i++) {
      var a1 = (-90 + i * 72 + 11) * Math.PI / 180, a2 = (-90 + (i + 1) * 72 - 11) * Math.PI / 180;
      out += '<path d="M' + (c + r * Math.cos(a1)).toFixed(2) + ' ' + (c + r * Math.sin(a1)).toFixed(2) + ' A' + r + ' ' + r + ' 0 0 1 ' + (c + r * Math.cos(a2)).toFixed(2) + ' ' + (c + r * Math.sin(a2)).toFixed(2) + '" stroke="' + cols[i] + '" stroke-width="5.2" stroke-linecap="round" fill="none"/>';
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 36 36"><rect width="36" height="36" rx="11" fill="#15171C"/>' + out + '<circle cx="18" cy="18" r="3.2" fill="#fff"/></svg>';
  }

  /* ---------- rotation dial ---------- */
  function dial(nextT) {
    var act = S.sch.activeTemplates(), n = act.length, cx = 75, r = 61, out = '';
    var seg = 360 / n, gap = n > 1 ? 15 : 0;
    act.forEach(function (ti, j) {
      var mid = -90 + j * seg, a1 = (mid - seg / 2 + gap / 2) * Math.PI / 180, a2 = (mid + seg / 2 - gap / 2) * Math.PI / 180;
      var on = ti === nextT, col = getComputedStyle(document.documentElement).getPropertyValue('--' + tcls(ti)).trim();
      var large = (seg - gap) > 180 ? 1 : 0;
      out += '<path d="M' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cx + r * Math.sin(a1)).toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a2)).toFixed(2) + ' ' + (cx + r * Math.sin(a2)).toFixed(2) +
        '" stroke="' + col + '" stroke-width="' + (on ? 17 : 11) + '" stroke-linecap="round" fill="none" opacity="' + (on ? 1 : .9) + '"/>';
      var lr = r + (on ? 0 : 0), lx = cx + lr * Math.cos(mid * Math.PI / 180), ly = cx + lr * Math.sin(mid * Math.PI / 180);
      out += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3.6).toFixed(1) + '" text-anchor="middle" font-size="' + (on ? 10 : 8.5) + '" font-weight="800" fill="' + (tcls(ti) === 't2' ? '#3A2A00' : '#fff') + '" font-family="Plus Jakarta Sans">' + tn(ti) + '</text>';
      if (on) {
        var pr = r + 15, px = cx + pr * Math.cos(mid * Math.PI / 180), py = cx + pr * Math.sin(mid * Math.PI / 180), ang = mid + 90;
        out += '<path d="M0 -5 L5 3.5 L-5 3.5 Z" fill="#15171C" transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ') rotate(' + (ang + 180).toFixed(1) + ')"/>';
      }
    });
    return '<svg viewBox="0 0 150 150" width="150" height="150">' + out + '</svg>';
  }

  /* ================= SCREENS ================= */
  function scrHome() {
    var s = S.sch, nx = s.next(), act = s.activeTemplates(), n = act.length;
    var nextT = nx ? nx.t : act[0], ci = nx ? s.clients[nx.c] : null, nextMs = nx ? s.timeOf(0) : null;
    var sent = s.sentCount(), failed = s.failedCount(), total = s.total(), pct = total ? (s.log.length / total * 100) : 0;
    var secs = nextMs ? Math.max(0, Math.round((nextMs - S.now) / 1000)) : 0;
    // carousel strip: the last sends and the coming ones, in time order
    var pos = act.indexOf(nextT), steps = '';
    for (var j = 0; j < n; j++) {
      var ti = act[j], rel = (j - pos + n) % n, ms, cls;
      if (j < pos) { ms = s.timeOf(0) - (pos - j) * s.clock.intervalMs; cls = 'done'; }
      else { ms = s.timeOf(j - pos); cls = j === pos ? 'now' : ''; }
      steps += (j ? '<span class="ms arr">chevron_right</span>' : '') + '<div class="step ' + cls + '">' + chip(ti) + '<small class="num">' + (j === pos ? 'Next' : t24(ms)) + '</small></div>';
    }
    var loopMs = s.timeOf(n - pos);
    var tiles = [
      ['clients', 'group', 'Clients', nf(s.activeClientCount())], ['templates', 'view_carousel', 'Templates', n + ' in turn'],
      ['schedule', 'event_repeat', 'Schedule', (s.cfg.intervalSec % 60 ? s.cfg.intervalSec + ' s' : s.cfg.intervalSec / 60 + ' min') + ' · SIM ' + s.cfg.sim],
      ['planner', 'calendar_month', 'Planner', nf(total)], ['report', 'receipt_long', 'Sent report', nf(sent) + ' sent'],
      ['auto', 'forward_to_inbox', 'Forwarding', S.settings.fwdMissed || S.settings.fwdReplies ? 'On' : 'Off'],
      ['auto', 'quickreply', 'Auto-reply', S.settings.rules.length + ' rules'], ['test', 'labs', 'Rotation test', '6 SMS']
    ];
    return statusBar() +
      '<div class="brandbar">' + mark(38) + '<div style="flex:1"><div class="word">zamu</div><div class="date">' + DOWL[d(S.now).getUTCDay()] + ', ' + p2(d(S.now).getUTCDate()) + ' ' + MON[d(S.now).getUTCMonth()] + ' ' + d(S.now).getUTCFullYear() + '</div></div>' +
      '<span class="simchip">' + ic('sim_card') + 'SIM ' + s.cfg.sim + '</span><button class="iconbtn tonal" data-go="auto">' + ic('settings') + '</button></div>' +
      '<div class="scroll"><div class="pad">' +
      '<div class="card engine">' +
      '<div class="top">' + (S.running ? '<span class="pill-s run"><i></i>Sending</span>' : '<span class="pill-s paused"><i></i>Paused</span>') +
      '<span class="meta">1 SMS every ' + (s.cfg.intervalSec % 60 ? s.cfg.intervalSec + ' sec' : (s.cfg.intervalSec / 60) + ' min') + ' · 07:00–19:00</span></div>' +
      '<div class="mid"><div class="dial">' + dial(nextT) + '<div class="c"><span class="k">Next</span><span class="v" style="color:var(--' + tcls(nextT) + ')">T' + tn(nextT) + '</span><span class="w">' + esc(T(nextT).title) + '</span></div></div>' +
      '<div class="nextbox">' + (ci ? '<div class="when">' + ic('schedule_send') + 'Today ' + t12(nextMs) + '<span class="cd">' + Math.floor(secs / 60) + ':' + p2(secs % 60) + '</span></div>' +
        '<div class="nm1 ell">' + esc(ci.name) + '</div><div class="ph num">' + ph(ci.phone) + '</div><div class="msg"><span>' + esc(tplText(nextT, ci.name)) + '</span></div>' : '<div class="nm1">All SMS sent</div>') + '</div></div>' +
      '<div class="carousel">' + steps + '<div class="loop">' + ic('replay') + '<small class="num">' + t24(loopMs) + '</small></div></div>' +
      '<div class="prog"><div class="l"><span><b class="num">' + nf(s.log.length) + '</b> of ' + nf(total) + ' processed</span><span class="num">' + pct.toFixed(1) + '%</span></div><div class="bar"><i style="width:' + Math.max(1.5, pct).toFixed(2) + '%"></i></div></div>' +
      '<div class="acts"><button class="btn pri" data-act="toggle">' + ic(S.running ? 'pause' : 'play_arrow', 'f') + (S.running ? 'Pause sending' : 'Start sending') + '</button>' +
      '<button class="btn sec2" data-act="test" style="padding:0 14px">' + ic('labs') + 'Test</button></div>' +
      '</div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="v num">' + nf(s.activeClientCount()) + '</div><div class="k">Clients</div></div>' +
      '<div class="stat"><div class="v num">' + nf(sent) + '</div><div class="k"><i style="background:var(--ok)"></i>Sent</div></div>' +
      '<div class="stat"><div class="v num">' + nf(failed) + '</div><div class="k"><i style="background:var(--bad)"></i>Failed</div></div>' +
      '<div class="stat"><div class="v num">' + nf(s.pending()) + '</div><div class="k"><i style="background:var(--ink4)"></i>Pending</div></div>' +
      '</div>' +
      '<div class="card lastcard"><span class="ic">' + ic('event_available') + '</span><div style="flex:1"><div class="k">Last SMS of the whole plan</div><div class="v num">' + dFull(s.lastPlannedMs()) + ' · ' + t12(s.lastPlannedMs()) + '</div></div>' +
      '<span class="muted" style="font-size:12px;font-weight:700">' + Math.max(0, Math.round((s.lastPlannedMs() - S.now) / E.DAY)) + ' days</span></div>' +
      '<div class="sec"><span class="label">All pages</span></div>' +
      '<div class="pages">' + tiles.map(function (t) { return '<button class="page" data-go="' + t[0] + '"><span class="pi">' + ic(t[1]) + '</span><b>' + t[2] + '</b></button>'; }).join('') + '</div>' +
      '<div style="height:6px"></div></div></div>' + nav('home') + gesture();
  }

  function scrClients() {
    var s = S.sch, q = (S.ui.clientQuery || '').trim().toLowerCase(), list = [], info = S.ui.importInfo;
    for (var i = 0; i < s.clients.length && list.length < 40; i++) {
      if (s.removed[i]) continue; var c = s.clients[i];
      if (!q || c.name.toLowerCase().indexOf(q) >= 0 || c.phone.indexOf(q.replace(/\D/g, '').replace(/^0/, '')) >= 0) list.push(i);
    }
    var html = statusBar() +
      '<div class="appbar"><div class="grow"><h1>Clients</h1><div class="sub-t num">' + nf(s.activeClientCount()) + ' in the running plan · 5 groups</div></div>' +
      '<button class="iconbtn tonal" data-act="exportClients">' + ic('download') + '</button></div>' +
      '<div class="scroll"><div class="pad">' +
      '<div class="sources">' +
      '<button class="source" data-act="addManual"><span class="si">' + ic('person_add') + '</span>Add<small>manually</small></button>' +
      '<button class="source" data-act="phonebook"><span class="si">' + ic('contacts') + '</span>Phonebook<small>search & pick</small></button>' +
      '<button class="source" data-act="importFile"><span class="si">' + ic('upload_file') + '</span>Excel / CSV<small>.xlsx .csv</small></button>' +
      '<button class="source" data-act="sheetUrl"><span class="si">' + ic('table_view') + '</span>Sheet<small>Google link</small></button>' +
      '</div>' +
      '<div class="card autobar"><span class="ic">' + ic('sync') + '</span><div style="flex:1;min-width:0"><div class="t">Auto-add new phone contacts</div><div class="s">Join the running plan · nobody else moves</div></div><button class="sw ' + (S.settings.autoAdd ? 'on' : '') + '" data-set="autoAdd"></button></div>' +
      (info ? '<div class="importok">' + ic('task_alt', 'f') + '<div><b>' + esc(info.file) + ' · ' + nf(info.rows) + ' rows</b><small class="num">' + nf(info.added) + ' added · ' + nf(info.dup) + ' duplicates skipped · ' + (info.ms / 1000).toFixed(1) + ' s</small></div></div>' : '') +
      '<div class="field" style="margin-top:10px">' + ic('search') + '<input data-in="clientQuery" placeholder="Search name or phone…" value="' + esc(S.ui.clientQuery || '') + '"></div>' +
      '<div class="card" style="margin-top:10px">' + list.map(function (i) {
        var c = s.clients[i], nx = null;
        for (var k = 0; k < Math.min(s.pending(), 20000); k++) { if (s.entryAt(k).c === i) { nx = { t: s.entryAt(k).t, ms: s.timeOf(k) }; break; } }
        return '<div class="row"><span class="av ' + avc(i) + '">' + ini(c.name) + '</span><div class="grow"><div class="t ell">' + esc(c.name) + '</div><div class="s num">' + ph(c.phone) + ' · ' + esc(c.group || '—') + '</div></div>' +
          (nx ? '<div style="text-align:right">' + chip(nx.t) + '<div class="s num" style="margin-top:3px;font-size:11px">' + dShort(nx.ms) + '</div></div>' : '<span class="grp">Done</span>') + '</div>';
      }).join('') + '</div><div style="height:16px"></div></div></div>' + nav('clients') + gesture();
    if (S.ui.sheet === 'phonebook') html += sheetPhonebook();
    return html;
  }
  function sheetPhonebook() {
    var q = (S.ui.pbQuery || '').toLowerCase(), list = D.PHONEBOOK.map(function (c, i) { return [c, i]; }).filter(function (x) { return !q || x[0].name.toLowerCase().indexOf(q) === 0; });
    var sel = list.filter(function (x) { return S.ui.pbSel && S.ui.pbSel[x[1]]; }).length, all = list.length && sel === list.length;
    return '<div class="scrim" data-act="closeSheet"></div><div class="sheet"><div class="handle"></div>' +
      '<div class="hd"><span class="iconbtn tonal" style="width:40px;height:40px">' + ic('contacts') + '</span><div class="grow"><h2>Import from phonebook</h2><small>Type a few letters, select, import</small></div><button class="iconbtn" data-act="closeSheet">' + ic('close') + '</button></div>' +
      '<div class="field filled">' + ic('search') + '<input data-in="pbQuery" value="' + esc(S.ui.pbQuery || '') + '" placeholder="Search phonebook"><span class="muted num" style="font-size:12.5px;font-weight:700">' + list.length + ' found</span></div>' +
      '<div class="selall" data-act="pbAll"><span class="cb ' + (all ? 'on' : '') + '"></span>Select all<span class="cnt">' + sel + ' selected</span></div>' +
      list.map(function (x) {
        var c = x[0], i = x[1], L = q.length;
        return '<div class="pb" data-act="pbOne" data-i="' + i + '"><span class="cb ' + (S.ui.pbSel && S.ui.pbSel[i] ? 'on' : '') + '"></span><span class="av ' + avc(i + 2) + '" style="width:36px;height:36px;font-size:13px">' + ini(c.name) + '</span>' +
          '<div style="flex:1"><div class="t"><u>' + esc(c.name.slice(0, L)) + '</u>' + esc(c.name.slice(L)) + '</div><div class="s num">' + ph(c.phone) + '</div></div></div>';
      }).join('') +
      '<div class="foot"><button class="btn pri" data-act="pbImport">' + ic('person_add') + 'Import ' + sel + ' contacts</button><small>Added to the running plan · everyone else keeps their times</small></div>' + gesture() + '</div>';
  }

  function scrTemplates() {
    var s = S.sch, act = s.activeTemplates(), nx = s.next(), nextT = nx ? nx.t : act[0];
    var flow = act.map(function (ti, j) { return (j ? ic('arrow_forward') : '') + chip(ti); }).join('');
    return statusBar() +
      '<div class="appbar"><div class="grow"><h1>SMS templates</h1><div class="sub-t">' + act.length + ' in rotation · next is T' + tn(nextT) + '</div></div>' +
      '<button class="iconbtn tonal" data-act="exportTpl">' + ic('download') + '</button></div>' +
      '<div class="scroll"><div class="pad">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn pri" data-act="newTpl">' + ic('edit_square') + 'Type new</button><button class="btn sec2" data-act="importTpl">' + ic('upload_file') + 'Excel / CSV</button></div>' +
      '<div class="card rot" style="margin-top:10px"><span class="label">Rotation order</span><div class="flow">' + flow + '<span class="back">' + ic('replay') + 'back to T' + tn(act[0]) + '</span></div>' +
      '<p>Every outgoing SMS takes the next template — no random picks, no repeats. After the last one it loops to the first.</p></div>' +
      '<div class="sec"><span class="label">Templates · drag to reorder</span><span class="label">Edit = all scheduled</span></div>' +
      act.map(function (ti) {
        var t = T(ti), seg = E.segments(t.text.replace(/\{name\}/g, 'Clinton'));
        var body = esc(t.text).replace(/\{name\}/g, '<em>{name}</em>');
        return '<div class="card tpl" style="--tcol:var(--' + tcls(ti) + ')"><div class="h">' + chip(ti, true) + '<b>' + esc(t.title) + '</b>' + (ti === nextT ? '<span class="nx now">Next</span>' : '') + ic('drag_indicator', 'grip') + '</div>' +
          '<p>' + body + '</p><div class="f"><span class="num">' + seg.chars + ' / 160 chars</span><span>·</span><span>' + seg.parts + ' SMS</span>' +
          '<span class="acts"><span data-act="editTpl" data-t="' + ti + '">' + ic('edit') + '</span><span data-act="delTpl" data-t="' + ti + '">' + ic('delete') + '</span></span></div></div>';
      }).join('') + '<div style="height:16px"></div></div></div>' + nav('templates') + gesture();
  }

  function scrSchedule() {
    var s = S.sch, c = s.cfg, iv = c.intervalSec, unitMin = iv % 60 === 0, val = unitMin ? iv / 60 : iv;
    var days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], dayIdx = [1, 2, 3, 4, 5, 6, 0];
    var M = s.activeClientCount(), N = s.activeTemplates().length;
    return statusBar() + subBar('Schedule', 'Applies to the whole plan', '<button class="txtbtn" data-act="saveSchedule">Save</button>') +
      '<div class="scroll"><div class="pad">' +
      '<div class="card blk"><div class="bh"><span class="ic">' + ic('calendar_today') + '</span><b>Date & time</b><small>first SMS · daily hours</small></div>' +
      '<div class="duo"><label class="inp"><small>Start date</small><span class="num">' + dFull(c.startMs) + ic('expand_more') + '</span></label><label class="inp"><small>Start time</small><span class="num">' + t12(c.startMs) + ic('expand_more') + '</span></label>' +
      '<label class="inp"><small>Send from</small><span class="num">07:00 AM' + ic('expand_more') + '</span></label><label class="inp"><small>Pause at</small><span class="num">07:00 PM' + ic('expand_more') + '</span></label></div>' +
      '<div class="hint">Pauses at night and resumes the remaining SMS at 07:00.</div></div>' +
      '<div class="card blk"><div class="bh"><span class="ic">' + ic('timer') + '</span><b>SMS interval</b><span class="seg" style="margin-left:auto"><span class="' + (unitMin ? '' : 'on') + '" data-act="unit" data-u="s">sec</span><span class="' + (unitMin ? 'on' : '') + '" data-act="unit" data-u="m">min</span></span></div>' +
      '<div class="stepper"><button class="sbtn" data-act="iv" data-d="-1">' + ic('remove') + '</button><div class="val num">' + val + '<small>' + (unitMin ? (val === 1 ? 'minute' : 'minutes') : 'seconds') + '</small></div><button class="sbtn" data-act="iv" data-d="1">' + ic('add') + '</button></div>' +
      '<div class="hint">Gap between two SMS — every send takes the next template.</div></div>' +
      '<div class="card blk"><div class="bh"><span class="ic">' + ic('event_busy') + '</span><b>Skip days</b><small>no SMS on red days</small></div><div class="days">' +
      days.map(function (l, j) { var off = (c.skipDays || []).indexOf(dayIdx[j]) >= 0; return '<button class="day ' + (off ? 'off' : '') + '" data-act="day" data-d="' + dayIdx[j] + '">' + l + '<small>' + (off ? 'skip' : 'send') + '</small></button>'; }).join('') + '</div></div>' +
      '<div class="card blk"><div class="bh" style="margin-bottom:0"><span class="ic">' + ic('sim_card') + '</span><b>SIM card</b>' +
      '<span class="seg" style="margin-left:auto"><span class="' + (c.sim === 1 ? 'on' : '') + '" data-act="sim" data-s="1"><i class="simn">1</i>Vodacom</span><span class="' + (c.sim === 2 ? 'on' : '') + '" data-act="sim" data-s="2"><i class="simn">2</i>Airtel</span></span></div></div>' +
      '<div class="summary"><div class="k">Your plan</div><div class="big num">' + nf(M * N) + ' SMS <small>' + nf(M) + ' clients × ' + N + ' templates</small></div>' +
      '<div class="g"><div><b>≈ every ' + perClientDays() + ' days</b><small>1 SMS per client</small></div><div><b class="num">' + dShort(s.lastPlannedMs()) + ' · ' + t24(s.lastPlannedMs()) + '</b><small>last SMS of the plan</small></div></div></div>' +
      '<div style="height:10px"></div></div></div>' +
      '<div class="dock"><button class="btn pri" data-act="toggle">' + ic(S.running ? 'pause' : 'play_arrow', 'f') + (S.running ? 'Pause queue' : 'Start queue') + '</button><button class="btn sec2" data-act="test" style="flex:0 0 auto">' + ic('labs') + 'Test 6 SMS</button></div>' + gesture();
  }

  function scrPlanner() {
    if (S.ui.search) return scrSearch();
    var s = S.sch, act = s.activeTemplates(), rows = [];
    for (var i = 0; i < s.clients.length && rows.length < (S.ui.gridRows || 10); i++) if (!s.removed[i]) rows.push(i);
    return statusBar() +
      '<div class="appbar"><div class="grow"><h1>Planner</h1><div class="sub-t num">' + nf(s.activeClientCount()) + ' clients × ' + act.length + ' templates ' + (s.activeClientCount() * act.length === s.total() - s.retry.length ? '= ' : '· ') + nf(s.total() - s.retry.length) + ' SMS' + (s.retry.length ? ' · +' + s.retry.length + ' retries' : '') + '</div></div>' +
      '<button class="iconbtn tonal" data-act="exportPlan">' + ic('download') + '</button></div>' +
      '<div class="scroll"><div class="pad">' +
      '<div class="field">' + ic('search') + '<input data-in="search" placeholder="Search number or name…" value=""></div>' +
      '<div class="facts"><div class="card fact"><div class="k">' + ic('flag') + 'Last SMS of plan</div><div class="v num">' + dDow(s.lastPlannedMs()) + ' · ' + t24(s.lastPlannedMs()) + '</div></div>' +
      '<div class="card fact"><div class="k">' + ic('history') + 'Last sent</div><div class="v num">' + (s.log.length ? 'Today ' + t24(lastMs()) : '—') + '</div></div></div>' +
      '<div class="bulk"><button class="chip" data-act="bulkEdit">' + ic('edit_note') + 'Bulk edit</button><button class="chip" data-act="bulkDel">' + ic('delete_sweep') + 'Bulk delete</button><button class="chip" data-act="selMode">' + ic('checklist') + 'Select</button></div>' +
      '<div class="card grid"><div class="gh"><span class="ch">Client</span>' + act.map(function (ti) { return '<span data-act="editTpl" data-t="' + ti + '">' + chip(ti) + '</span>'; }).join('') + '</div>' +
      rows.map(function (ci) {
        var c = s.clients[ci], map = {};
        s.forClient(ci).forEach(function (r) { map[r.t] = r; });
        return '<div class="gr"><div class="n"><b>' + esc(c.name) + '</b><small>' + ph(c.phone) + '</small></div>' + act.map(function (ti) {
          var r = map[ti]; if (!r) return '<span></span>';
          return '<span class="cell ' + tcls(ti) + (r.state === 'sent' ? ' sent' : '') + '"><small>' + dShort(r.ms) + '</small><b>' + t24(r.ms) + '</b></span>';
        }).join('') + '</div>';
      }).join('') + '<div class="more" data-act="moreRows">Show more · ' + nf(s.activeClientCount() - rows.length) + ' clients</div></div>' +
      '<div style="height:16px"></div></div></div>' + nav('planner') + gesture();
  }

  function scrSearch() {
    var s = S.sch, q = S.ui.search.replace(/\s/g, '').toLowerCase(), digits = q.replace(/\D/g, '').replace(/^0/, '').replace(/^255/, '');
    var found = [];
    for (var i = 0; i < s.clients.length && found.length < 30; i++) { if (s.removed[i]) continue; var c = s.clients[i]; if ((digits.length >= 3 && c.phone.indexOf(digits) >= 0) || (!digits && c.name.toLowerCase().replace(/\s/g, '').indexOf(q) >= 0)) found.push(i); }
    var sel = S.ui.selClient != null && found.indexOf(S.ui.selClient) >= 0 ? S.ui.selClient : (found.length === 1 ? found[0] : null);
    S.ui.selClient = sel;
    var head = statusBar() + subBar('Planner', 'Search · show · delete by number').replace('data-go="home"', 'data-act="clearSearch"') +
      '<div class="pad"><div class="field filled">' + ic('search') + '<input data-in="search" value="' + esc(S.ui.search) + '"><button class="clear" data-act="clearSearch">' + ic('close') + '</button></div></div>';
    if (sel == null) {
      return head + '<div class="scroll"><div class="pad"><div class="sec"><span class="label">' + found.length + ' clients found</span></div><div class="card">' + found.map(function (i) {
        var c = s.clients[i]; return '<div class="row" data-act="pick" data-c="' + i + '"><span class="av ' + avc(i) + '">' + ini(c.name) + '</span><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="s num">' + ph(c.phone) + '</div></div>' + ic('chevron_right') + '</div>';
      }).join('') + '</div></div></div>' + nav('planner') + gesture();
    }
    var c = s.clients[sel], rows = s.forClient(sel), fut = rows.filter(function (r) { return r.state !== 'sent' && r.state !== 'failed'; });
    var nSel = fut.filter(function (r) { return S.ui.selRows[r.ms]; }).length, allSel = fut.length && nSel === fut.length;
    return head + '<div class="scroll"><div class="pad">' +
      '<div class="sec" style="margin-top:14px"><span class="label">1 client · ' + rows.length + ' SMS</span><span class="label" data-act="selAllRows" style="color:var(--ink);cursor:pointer">' + (allSel ? 'Clear' : 'Select all') + '</span></div>' +
      '<div class="card"><div class="who"><span class="av ' + avc(sel) + '" style="width:44px;height:44px">' + ini(c.name) + '</span><div style="flex:1;min-width:0"><div class="t">' + esc(c.name) + '</div><div class="s num">+255 ' + c.phone.slice(4, 7) + ' ' + c.phone.slice(7, 10) + ' ' + c.phone.slice(10) + ' · ' + esc(c.group) + '</div></div><span class="grp">' + rows.length + ' SMS</span></div>' +
      '<div class="every">' + ic('repeat') + 'One SMS every ≈ ' + perClientDays() + ' days · same gap between each</div></div>' +
      '<div class="card tl" style="margin-top:10px">' + rows.map(function (r) {
        var done = r.state === 'sent' || r.state === 'failed';
        var st = r.state === 'sent' ? '<span class="st ok">' + ic('check_circle', 'f') + 'Sent</span>' : r.state === 'failed' ? '<span class="st bad">' + ic('error', 'f') + 'Failed</span>' : r.state === 'retry' ? '<span class="st retry">' + ic('replay') + 'Retry</span>' : '<span class="st sch">' + ic('schedule') + 'Planned</span>';
        return '<div class="tli" ' + (done ? '' : 'data-act="row" data-ms="' + r.ms + '"') + '><span class="cb ' + (done ? 'dis' : (S.ui.selRows[r.ms] ? 'on' : '')) + '"></span><div class="grow"><div class="a">' + chip(r.t) + '<b>' + esc(T(r.t).title) + '</b>' + st + '</div>' +
          '<div class="d">' + dFull(r.ms) + ' · ' + t12(r.ms) + '</div><div class="m ell">' + esc(tplText(r.t, c.name)) + '</div></div></div>';
      }).join('') + '</div>' +
      '<div class="infonote">' + ic('info') + '<div>Only <b>future</b> SMS are deleted — sent history stays in the report. The carousel re-flows, so the next SMS still takes the next template.</div></div>' +
      '<div style="height:12px"></div></div></div>' +
      '<div class="delbar"><div class="r1"><span class="num">' + nSel + ' future SMS selected</span><small class="num">Clients ' + nf(s.activeClientCount()) + ' → ' + nf(s.activeClientCount() - (nSel === fut.length && nSel ? 1 : 0)) + '</small></div>' +
      '<button class="btn danger" style="width:100%" data-act="delRows" data-c="' + sel + '">' + ic('delete') + 'Delete ' + nSel + ' future SMS of this number</button></div>' + gesture();
  }

  function scrReport() {
    var s = S.sch, f = S.ui.reportFilter || 'all', today = Math.floor(S.now / E.DAY) * E.DAY;
    var all = s.log, rows = [];
    for (var i = all.length - 1; i >= 0 && rows.length < 8; i--) {
      var l = all[i]; if (f === 'sent' && !l.ok) continue; if (f === 'failed' && l.ok) continue; rows.push(l);
    }
    rows.reverse();
    var todayN = 0; for (var j = all.length - 1; j >= 0 && all[j].ms >= today; j--) todayN++;
    var ok = rotationOk();
    return statusBar() +
      '<div class="appbar"><div class="grow"><h1>Sent report</h1><div class="sub-t">Which number got which template, and when</div></div>' +
      '<button class="btn sm pri" data-act="exportLog">' + ic('download') + 'Log .csv</button></div>' +
      '<div class="scroll"><div class="pad">' +
      '<div class="kpis"><div class="card kpi"><div class="v num">' + nf(s.sentCount()) + '</div><div class="k"><i style="background:var(--ok)"></i>Sent</div></div>' +
      '<div class="card kpi"><div class="v num">' + nf(s.failedCount()) + '</div><div class="k"><i style="background:var(--bad)"></i>Failed</div></div>' +
      '<div class="card kpi"><div class="v num">' + nf(todayN) + '</div><div class="k"><i style="background:var(--ink)"></i>Today</div></div></div>' +
      '<div class="verify">' + ic(ok ? 'verified' : 'error', 'f') + '<div><b class="num">' + (ok ? 'Rotation verified · ' + nf(s.log.length) + ' sends' : 'Rotation check failed') + '</b><small>Strict order T1 → T' + s.activeTemplates().length + ' → T1 · nothing skipped or repeated</small></div></div>' +
      '<div class="chips">' + [['all', 'All', s.log.length], ['sent', 'Sent', s.sentCount()], ['failed', 'Failed', s.failedCount()]].map(function (c) {
        return '<button class="chip ' + (f === c[0] ? 'on' : '') + '" data-act="rf" data-f="' + c[0] + '">' + c[1] + ' <span class="n num">' + nf(c[2]) + '</span></button>';
      }).join('') + '<span class="chip">' + ic('sim_card') + 'SIM 1</span></div>' +
      '<div class="sec" style="margin-top:14px"><span class="label">Today · ' + dFull(S.now).replace(/^\w+ /, '') + '</span><span class="label num">#' + nf(rows.length ? rows[0].n : 0) + ' – #' + nf(rows.length ? rows[rows.length - 1].n : 0) + '</span></div>' +
      '<div class="card log">' + rows.map(function (l, k) {
        var c = s.clients[l.c], last = k === rows.length - 1;
        return '<div class="lr ' + (l.ok ? '' : 'fail ') + (last && l.ok ? 'latest' : '') + '"><span class="tm">' + t24(l.ms) + '<small>#' + nf(l.n) + '</small></span>' + chip(l.t) +
          '<span class="nm"><b>' + esc(c.name) + '</b><small>' + ph(c.phone) + '</small></span>' +
          '<span class="rs">' + (l.ok ? '<span class="st ok">' + ic('check_circle', 'f') + 'Sent</span><small>SIM ' + l.sim + '</small>' : '<span class="st bad">' + ic('error', 'f') + 'Failed</span><small>' + esc(l.err) + ' → resend at end</small>') + '</span></div>';
      }).join('') + '</div><div style="height:16px"></div></div></div>' + nav('report') + gesture();
  }

  function scrAuto() {
    var st = S.settings, s = S.sch;
    function sw(k) { return '<button class="sw ' + (st[k] ? 'on' : '') + '" data-set="' + k + '"></button>'; }
    return statusBar() + subBar('Forwarding & auto-reply', 'Runs in the background, even when the app is closed') +
      '<div class="scroll"><div class="pad">' +
      '<div class="seg full" style="margin-top:2px"><span class="' + (s.cfg.sim === 1 ? 'on' : '') + '" data-act="sim" data-s="1"><i class="simn">1</i>Send from Vodacom</span><span class="' + (s.cfg.sim === 2 ? 'on' : '') + '" data-act="sim" data-s="2"><i class="simn">2</i>Airtel</span></div>' +
      '<div class="sec"><span class="label">Forward to my other phone</span></div><div class="card">' +
      '<div class="fwdnum"><span class="ic iconbtn tonal" style="width:36px;height:36px">' + ic('call_made') + '</span><div class="grow"><small>Destination number</small><span>' + esc(st.fwdNumber) + '</span></div>' + ic('edit') + '</div>' +
      '<div class="set"><span class="ic">' + ic('phone_missed') + '</span><div class="grow"><div class="t">Missed-call details</div><div class="s">Caller name + number by SMS</div></div>' + sw('fwdMissed') + '</div>' +
      '<div class="bubble"><b>Missed call:</b> John Peter 0755 200 444 tried to call you · 10:12</div>' +
      '<div class="set"><span class="ic">' + ic('reply_all') + '</span><div class="grow"><div class="t">SMS replies</div><div class="s">Sender name, number and text</div></div>' + sw('fwdReplies') + '</div>' +
      '<div class="bubble"><b>John Peter 0755 200 444:</b> Bei ya DOT 4 ni ngapi?</div></div>' +
      '<div class="sec"><span class="label">Auto-response</span></div><div class="card">' +
      '<div class="set"><span class="ic">' + ic('quickreply') + '</span><div class="grow"><div class="t">Reply to SMS with keywords</div><div class="s">' + st.rules.map(function (r) { return '<span class="kw">' + esc(r[0]) + '</span>'; }).join(' ') + ' · to: ' + esc(st.replyTo) + '</div></div>' + sw('autoReply') + '</div></div>' +
      '<div class="sec"><span class="label">Never stop sending</span></div><div class="card">' +
      '<div class="set"><span class="ic">' + ic('event_repeat') + '</span><div class="grow"><div class="t">Reschedule failed SMS</div><div class="s num">Resent at the end of the plan · ' + s.retry.length + ' queued</div></div>' + sw('autoResched') + '</div>' +
      '<div class="set"><span class="ic">' + ic('verified_user') + '</span><div class="grow"><div class="t">Auto-allow “large number of SMS”</div><div class="s">Answers Android’s limit popup with Allow</div></div>' + sw('autoAllow') + '</div>' +
      '<div class="set"><span class="ic">' + ic('restart_alt') + '</span><div class="grow"><div class="t">Resume after crash or restart</div><div class="s num">Continues from SMS #' + nf(s.log.length + 1) + '</div></div>' + sw('resume') + '</div>' +
      '<div class="set"><span class="ic">' + ic('battery_saver') + '</span><div class="grow"><div class="t">Battery optimisation</div><div class="s">Off for Zamu — runs all day</div></div><span class="ok">' + (st.battery ? 'Unrestricted' : 'Turn off') + '</span></div>' +
      '</div><div style="height:16px"></div></div></div>' + gesture();
  }

  /* ---------- sheets for the live prototype ---------- */
  function sheet(title, sub, body) {
    return '<div class="scrim" data-act="closeSheet"></div><div class="sheet"><div class="handle"></div><div class="hd"><div class="grow"><h2>' + title + '</h2>' + (sub ? '<small>' + sub + '</small>' : '') + '</div><button class="iconbtn" data-act="closeSheet">' + ic('close') + '</button></div>' + body + '<div style="height:14px"></div>' + gesture() + '</div>';
  }
  function sheetHtml() {
    var u = S.ui, s = S.sch;
    if (u.sheet === 'addManual') return sheet('Add client', 'Saved to Clients and added to the running plan',
      '<div class="formrow"><label>Name</label><input id="f-name" placeholder="e.g. Neema Kalinga"></div><div class="formrow"><label>Phone</label><input id="f-phone" inputmode="tel" placeholder="07XX XXX XXX or +255…"></div><div class="formrow"><label>Group (optional)</label><input id="f-group" placeholder="Gereji, Boda, Lori…"></div><button class="btn pri" style="width:100%" data-act="saveManual">' + ic('person_add') + 'Add client</button>');
    if (u.sheet === 'sheetUrl') return sheet('Import from Google Sheet', 'File → Share → Publish to web → CSV, then paste the link',
      '<div class="formrow"><label>Published CSV link</label><input id="f-url" placeholder="https://docs.google.com/…/pub?output=csv"></div><div class="hint" style="margin:0 0 12px">Columns: <b class="mono">name, phone, group</b> — the same as the CSV import.</div><button class="btn pri" style="width:100%" data-act="fetchSheet">' + ic('download') + 'Import sheet</button>');
    if (u.sheet === 'tpl') {
      var t = u.editT != null ? T(u.editT) : null, txt = u.draft != null ? u.draft : (t ? t.text : ''), seg = E.segments(txt.replace(/\{name\}/g, 'Clinton'));
      return sheet(t ? 'Bulk edit T' + t.id : 'New SMS template', t ? 'One master text — every scheduled SMS #' + t.id + ' changes instantly' : 'Added at the end of the rotation',
        (t ? '' : '<div class="formrow"><label>Short title</label><input id="f-title" placeholder="e.g. Ofa ya wiki"></div>') +
        '<textarea class="ta" id="f-text" data-in="draft">' + esc(txt) + '</textarea><div class="hint" style="display:flex;justify-content:space-between;margin:6px 2px 12px"><span>Use <b>{name}</b> for the client’s first name</span><span class="num"><b>' + seg.chars + '</b> chars · ' + seg.parts + ' SMS' + (seg.unicode ? ' · Unicode' : '') + '</span></div>' +
        '<button class="btn pri" style="width:100%" data-act="saveTpl">' + ic('check') + (t ? 'Update all scheduled SMS' : 'Save template') + '</button>');
    }
    if (u.sheet === 'importMode') return sheet('Import templates', 'How should the ' + u.pendingTpl.length + ' templates from the file be added?',
      '<button class="btn pri" style="width:100%;margin-bottom:8px" data-act="tplMode" data-m="append">' + ic('playlist_add') + 'Add to existing (keep old)</button><button class="btn sec2" style="width:100%" data-act="tplMode" data-m="replace">' + ic('swap_horiz') + 'Replace all (delete old)</button>');
    if (u.sheet === 'bulkPick') return sheet(u.bulkKind === 'del' ? 'Bulk delete' : 'Bulk edit', u.bulkKind === 'del' ? 'Remove one template from every future SMS' : 'Edit one master SMS for every client',
      '<div class="card">' + s.activeTemplates().map(function (ti) { var n = s.queue.filter(function (e) { return e.t === ti; }).length; return '<div class="row" data-act="' + (u.bulkKind === 'del' ? 'delTpl' : 'editTpl') + '" data-t="' + ti + '">' + chip(ti, true) + '<div class="grow"><div class="t">' + esc(T(ti).title) + '</div><div class="s num">' + nf(n) + ' scheduled</div></div>' + ic(u.bulkKind === 'del' ? 'delete' : 'edit') + '</div>'; }).join('') + '</div>');
    if (u.sheet === 'test') {
      var rs = u.testRows || [], done = rs.length >= 6, pass = done && rs.every(function (r, i) { return i === 0 || r.ti === s.activeTemplates()[(s.activeTemplates().indexOf(rs[i - 1].ti) + 1) % s.activeTemplates().length]; });
      return sheet('Live rotation test', 'Sends 6 consecutive SMS to your own number (simulated here)',
        '<div class="card">' + (rs.length ? rs.map(function (r) { return '<div class="lr"><span class="tm">' + r.time + '</span>' + chip(r.ti) + '<span class="nm"><b>' + esc(T(r.ti).title) + '</b><small>to 0754 818 020</small></span><span class="rs"><span class="st ok">' + ic('check_circle', 'f') + 'Sent</span></span></div>'; }).join('') : '<div class="row"><div class="s">Starting…</div></div>') + '</div>' +
        (done ? '<div class="verify">' + ic(pass ? 'verified' : 'error', 'f') + '<div><b>' + (pass ? 'PASS — templates rotated in order' : 'FAIL') + '</b><small>' + rs.map(function (r) { return 'T' + tn(r.ti); }).join(' → ') + '</small></div></div>' : ''));
    }
    return '';
  }

  /* ---------- render ---------- */
  var SCREENS = { home: scrHome, clients: scrClients, templates: scrTemplates, schedule: scrSchedule, planner: scrPlanner, report: scrReport, auto: scrAuto };
  function render() {
    var root = document.getElementById('app'), r = S.route;
    if (r === 'test') { r = S.route = 'home'; openTest(); }
    if (!SCREENS[r]) r = S.route = 'home';
    var keepScroll = root.querySelector('.scroll'), top = keepScroll ? keepScroll.scrollTop : 0, same = root.getAttribute('data-r') === r;
    var focus = document.activeElement && document.activeElement.getAttribute('data-in'), caret = focus ? document.activeElement.selectionStart : 0;
    var html = SCREENS[r]();
    if (S.ui.sheet && S.ui.sheet !== 'phonebook') html += sheetHtml();
    if (S.ui.toast) html += '<div class="toast">' + ic('task_alt', 'f') + '<span>' + esc(S.ui.toast) + '</span></div>';
    root.innerHTML = html; root.setAttribute('data-r', r);
    var sc = root.querySelector('.scroll'); if (sc && same) sc.scrollTop = top;
    if (focus) { var el = root.querySelector('[data-in="' + focus + '"]'); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { } } }
    document.querySelectorAll('[data-route]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-route') === r); });
  }
  function go(r) { S.route = r; S.ui.sheet = null; if (r !== 'planner') { S.ui.search = ''; S.ui.selClient = null; } if (!SHOT) history.replaceState(null, '', '#/' + r); render(); }
  var toastT; function toast(msg) { S.ui.toast = msg; render(); clearTimeout(toastT); toastT = setTimeout(function () { S.ui.toast = null; render(); }, 3200); }

  /* ---------- live sending (simulated SmsManager) ---------- */
  var simRng = D.rng(Date.now() % 100000);
  function tick() {
    var s = S.sch; if (!s.pending()) { S.running = false; clearInterval(S.timer); toast('All SMS of the plan are sent'); return; }
    var rec = s.step(function () { return simRng() < 0.985 ? { ok: true } : { ok: false, err: 'Generic failure' }; }, S.settings.autoResched);
    S.now = rec.ms + 25000; save(); if (!S.ui.sheet) render();
  }
  function setRunning(on) { S.running = on; clearInterval(S.timer); if (on && !SHOT) S.timer = setInterval(tick, 1100); render(); }
  function openTest() {
    S.ui.sheet = 'test'; S.ui.testRows = []; render();
    var act = S.sch.activeTemplates(), nx = S.sch.next(), start = nx ? act.indexOf(nx.t) : 0, base = Date.now();
    var i = 0, iv = setInterval(function () {
      if (S.ui.sheet !== 'test') { clearInterval(iv); return; }
      var dt = new Date(base + i * 60000), ti = act[(start + i) % act.length];
      S.ui.testRows.push({ ti: ti, time: p2(dt.getHours()) + ':' + p2(dt.getMinutes()) }); i++; render();
      if (i >= 6) clearInterval(iv);
    }, 650);
  }

  /* ---------- imports ---------- */
  function addClientsFrom(res, label, t0) {
    var s = S.sch, existing = {}; s.clients.forEach(function (c) { existing[c.phone] = 1; });
    var fresh = res.clients.filter(function (c) { return !existing[c.phone]; });
    var dup = res.duplicates + (res.clients.length - fresh.length);
    if (fresh.length) s.addClients(fresh);
    S.ui.importInfo = { file: label, rows: res.rows, added: fresh.length, dup: dup, ms: Math.max(1, performance.now() - t0) };
    save(); toast(nf(fresh.length) + ' clients added to the running plan' + (res.invalid ? ' · ' + res.invalid + ' invalid numbers skipped' : ''));
  }
  function readXlsx(buf) {                // minimal .xlsx reader: zip central directory + DecompressionStream
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error('Not an .xlsx file'));
    var cnt = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), files = {};
    for (var n = 0; n < cnt; n++) {
      var nameLen = dv.getUint16(off + 28, true), extra = dv.getUint16(off + 30, true), comLen = dv.getUint16(off + 32, true);
      var name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
      files[name] = { method: dv.getUint16(off + 10, true), size: dv.getUint32(off + 20, true), local: dv.getUint32(off + 42, true) };
      off += 46 + nameLen + extra + comLen;
    }
    function read(name) {
      var f = files[name]; if (!f) return Promise.resolve(null);
      var lo = f.local, start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), data = u8.subarray(start, start + f.size);
      if (f.method === 0) return Promise.resolve(new TextDecoder().decode(data));
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    var sheetName = Object.keys(files).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); }).sort()[0];
    return Promise.all([read('xl/sharedStrings.xml'), read(sheetName)]).then(function (x) {
      var P = new DOMParser(), ss = [];
      if (x[0]) Array.prototype.forEach.call(P.parseFromString(x[0], 'application/xml').getElementsByTagName('si'), function (si) { ss.push(Array.prototype.map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join('')); });
      var rows = [];
      Array.prototype.forEach.call(P.parseFromString(x[1], 'application/xml').getElementsByTagName('row'), function (r) {
        var out = [];
        Array.prototype.forEach.call(r.getElementsByTagName('c'), function (c) {
          var ref = c.getAttribute('r') || '', col = 0; ref.replace(/^[A-Z]+/, function (L) { for (var j = 0; j < L.length; j++) col = col * 26 + L.charCodeAt(j) - 64; return L; }); col = Math.max(0, col - 1);
          var t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = '';
          if (t === 's' && v) val = ss[+v.textContent] || ''; else if (t === 'inlineStr') val = (c.getElementsByTagName('t')[0] || {}).textContent || ''; else if (v) val = v.textContent;
          if (/^\d+(\.\d+)?E\+\d+$/i.test(val)) val = Number(val).toFixed(0);
          out[col] = val;
        });
        for (var k = 0; k < out.length; k++) if (out[k] == null) out[k] = '';
        rows.push(out);
      });
      return rows;
    });
  }
  function pickFile(accept, cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var t0 = performance.now();
      if (/\.xlsx$/i.test(f.name)) f.arrayBuffer().then(readXlsx).then(function (rows) { cb(rows, f.name, t0); }).catch(function (e) { toast('Could not read file: ' + e.message); });
      else f.text().then(function (txt) { cb(E.parseCSV(txt), f.name, t0); });
    };
    inp.click();
  }
  function download(name, text) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; a.click(); }
  function csvq(v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-go],[data-act],[data-set],[data-route]'); if (!el || SHOT) return;
    if (el.hasAttribute('data-route')) { ev.preventDefault(); var rr = el.getAttribute('data-route'); if (rr === 'test') { go('home'); openTest(); } else { if (rr === 'search') { go('planner'); S.ui.search = '0755 214 873'; render(); } else go(rr); } return; }
    if (el.hasAttribute('data-go')) { var g = el.getAttribute('data-go'); if (g === 'test') { openTest(); } else go(g); return; }
    if (el.hasAttribute('data-set')) { var k = el.getAttribute('data-set'); S.settings[k] = !S.settings[k]; save(); render(); return; }
    var a = el.getAttribute('data-act'), s = S.sch, u = S.ui;
    switch (a) {
      case 'toggle': setRunning(!S.running); toast(S.running ? 'Sending resumed from SMS #' + nf(s.log.length + 1) : 'Paused — resumes from the same SMS'); break;
      case 'test': openTest(); break;
      case 'closeSheet': u.sheet = null; render(); break;
      case 'addManual': u.sheet = 'addManual'; render(); break;
      case 'saveManual': {
        var nm = document.getElementById('f-name').value.trim(), p = E.normalizePhone(document.getElementById('f-phone').value), gr = document.getElementById('f-group').value.trim();
        if (!p) { toast('Check the phone number (07XX XXX XXX)'); break; }
        u.sheet = null; addClientsFrom({ clients: [{ name: nm || ph(p), phone: p, group: gr }], rows: 1, invalid: 0, duplicates: 0 }, 'Manual entry', performance.now()); break;
      }
      case 'phonebook':
        if (navigator.contacts && navigator.contacts.select) {
          navigator.contacts.select(['name', 'tel'], { multiple: true }).then(function (list) {
            var cl = []; list.forEach(function (c) { (c.tel || []).slice(0, 1).forEach(function (t) { var p = E.normalizePhone(t); if (p) cl.push({ name: (c.name || [])[0] || ph(p), phone: p, group: '' }); }); });
            addClientsFrom({ clients: cl, rows: list.length, invalid: list.length - cl.length, duplicates: 0 }, 'Phonebook', performance.now());
          }).catch(function () { });
        } else { u.sheet = 'phonebook'; u.pbQuery = 'jo'; u.pbSel = {}; render(); }
        break;
      case 'pbAll': { var q = (u.pbQuery || '').toLowerCase(), ids = []; D.PHONEBOOK.forEach(function (c, i) { if (!q || c.name.toLowerCase().indexOf(q) === 0) ids.push(i); }); var all = ids.every(function (i) { return u.pbSel[i]; }); ids.forEach(function (i) { if (all) delete u.pbSel[i]; else u.pbSel[i] = 1; }); render(); break; }
      case 'pbOne': { var i = +el.getAttribute('data-i'); if (u.pbSel[i]) delete u.pbSel[i]; else u.pbSel[i] = 1; render(); break; }
      case 'pbImport': { var pick = D.PHONEBOOK.filter(function (c, i) { return u.pbSel[i]; }); u.sheet = null; addClientsFrom({ clients: pick, rows: pick.length, invalid: 0, duplicates: 0 }, 'Phonebook', performance.now()); break; }
      case 'importFile': pickFile('.csv,.xlsx,text/csv', function (rows, name, t0) { addClientsFrom(E.rowsToClients(rows), name, t0); render(); }); break;
      case 'sheetUrl': u.sheet = 'sheetUrl'; render(); break;
      case 'fetchSheet': {
        var url = document.getElementById('f-url').value.trim(), t0 = performance.now(); if (!url) break;
        fetch(url).then(function (r) { return r.text(); }).then(function (txt) { u.sheet = null; addClientsFrom(E.rowsToClients(E.parseCSV(txt)), 'Google Sheet', t0); }).catch(function () { toast('Could not load the sheet — is it published as CSV?'); });
        break;
      }
      case 'exportClients': download('clients.csv', 'name,phone,group\n' + s.clients.filter(function (c, i) { return !s.removed[i]; }).map(function (c) { return [csvq(c.name), ph(c.phone).replace(/ /g, ''), csvq(c.group)].join(','); }).join('\n')); break;
      case 'newTpl': u.sheet = 'tpl'; u.editT = null; u.draft = ''; render(); break;
      case 'editTpl': u.sheet = 'tpl'; u.editT = +el.getAttribute('data-t'); u.draft = null; render(); break;
      case 'saveTpl': {
        var txt = document.getElementById('f-text').value.trim(); if (!txt) break;
        if (u.editT != null) { var n = s.editTemplate(u.editT, txt); u.sheet = null; save(); toast(nf(n) + ' scheduled SMS #' + T(u.editT).id + ' updated'); }
        else { var title = (document.getElementById('f-title').value.trim() || 'Template ' + (s.templates.length + 1)); s.templates.push({ id: s.templates.length + 1, title: title, text: txt }); rebuildFromHere(); u.sheet = null; toast('T' + s.templates.length + ' added to the rotation'); }
        break;
      }
      case 'delTpl': { var t = +el.getAttribute('data-t'); if (s.activeTemplates().length <= 1) { toast('Keep at least one template'); break; } if (!confirm('Delete T' + T(t).id + ' from every future SMS?')) break; var dn = s.deleteTemplate(t); u.sheet = null; save(); toast(nf(dn) + ' scheduled SMS removed · rotation continues'); break; }
      case 'importTpl': pickFile('.csv,.xlsx,text/csv', function (rows) {
        var head = (rows[0] || []).map(function (h) { return String(h).toLowerCase().trim(); }), ci = Math.max(0, head.indexOf('template') >= 0 ? head.indexOf('template') : head.indexOf('sms') >= 0 ? head.indexOf('sms') : head.indexOf('message'));
        var hasHead = head.some(function (h) { return ['template', 'sms', 'message', 'text'].indexOf(h) >= 0; });
        u.pendingTpl = rows.slice(hasHead ? 1 : 0).map(function (r) { return String(r[ci] || '').trim(); }).filter(Boolean);
        if (!u.pendingTpl.length) { toast('No templates found in the file'); return; }
        u.sheet = 'importMode'; render();
      }); break;
      case 'tplMode': {
        var mode = el.getAttribute('data-m');
        if (mode === 'replace') s.templates.forEach(function (t) { t.deleted = true; });
        u.pendingTpl.forEach(function (txt) { s.templates.push({ id: s.templates.length + 1, title: txt.split(/[.!?:]/)[0].slice(0, 22), text: txt }); });
        rebuildFromHere(); u.sheet = null; toast(u.pendingTpl.length + ' templates imported'); break;
      }
      case 'exportTpl': download('templates.csv', 'id,template\n' + s.activeTemplates().map(function (i) { return T(i).id + ',' + csvq(T(i).text); }).join('\n')); break;
      case 'unit': { var m = el.getAttribute('data-u') === 'm', cur = s.cfg.intervalSec; s.cfg.intervalSec = m ? Math.max(60, Math.round(cur / 60) * 60) : Math.max(5, cur % 60 === 0 ? cur / 60 * 10 : cur); render(); break; }
      case 'iv': { var dd = +el.getAttribute('data-d'), unitMin = s.cfg.intervalSec % 60 === 0; s.cfg.intervalSec = Math.max(unitMin ? 60 : 5, s.cfg.intervalSec + dd * (unitMin ? 60 : 5)); s.clock = E.makeClock(s.cfg); render(); break; }
      case 'day': { var dy = +el.getAttribute('data-d'), sk = s.cfg.skipDays || [], ix = sk.indexOf(dy); if (ix >= 0) sk.splice(ix, 1); else if (sk.length < 6) sk.push(dy); s.cfg.skipDays = sk; render(); break; }
      case 'sim': s.cfg.sim = +el.getAttribute('data-s'); save(); render(); break;
      case 'saveSchedule': retime(); save(); toast('Schedule saved · last SMS ' + dDow(s.lastPlannedMs()) + ' ' + t24(s.lastPlannedMs())); break;
      case 'moreRows': u.gridRows = (u.gridRows || 10) + 20; render(); break;
      case 'bulkEdit': u.sheet = 'bulkPick'; u.bulkKind = 'edit'; render(); break;
      case 'bulkDel': u.sheet = 'bulkPick'; u.bulkKind = 'del'; render(); break;
      case 'selMode': u.search = ''; toast('Search a number or name to select its SMS'); break;
      case 'exportPlan': {
        var lines = ['send_no,datetime,template,client,phone,status'];
        for (var j = 0; j < s.pending(); j++) { var e = s.entryAt(j), c = s.clients[e.c], ms = s.timeOf(j); lines.push([s.log.length + j + 1, dFull(ms) + ' ' + t24(ms), 'T' + T(e.t).id, csvq(c.name), ph(c.phone).replace(/ /g, ''), e.retry ? 'RETRY' : 'SCHEDULED'].join(',')); }
        download('planner.csv', lines.join('\n')); break;
      }
      case 'clearSearch': u.search = ''; u.selClient = null; u.selRows = {}; render(); break;
      case 'pick': u.selClient = +el.getAttribute('data-c'); u.selRows = {}; render(); break;
      case 'row': { var k2 = el.getAttribute('data-ms'); if (u.selRows[k2]) delete u.selRows[k2]; else u.selRows[k2] = 1; render(); break; }
      case 'selAllRows': { var rows = s.forClient(u.selClient).filter(function (r) { return r.state !== 'sent' && r.state !== 'failed'; }); var allOn = rows.every(function (r) { return u.selRows[r.ms]; }); u.selRows = {}; if (!allOn) rows.forEach(function (r) { u.selRows[r.ms] = 1; }); render(); break; }
      case 'delRows': {
        var c3 = +el.getAttribute('data-c'), fut = s.forClient(c3).filter(function (r) { return r.state !== 'sent' && r.state !== 'failed'; }), selN = fut.filter(function (r) { return u.selRows[r.ms]; });
        if (!selN.length) break;
        if (selN.length === fut.length) { var removed = s.deleteFuture([c3]); toast(removed + ' future SMS deleted · clients now ' + nf(s.activeClientCount())); }
        else { var keyset = {}; selN.forEach(function (r) { keyset[r.ms] = 1; }); var drop = {}; for (var x = 0; x < s.pending(); x++) if (keyset[s.timeOf(x)] && s.entryAt(x).c === c3) drop[x] = 1; s.queue = E.repair(s.queue.filter(function (e2, x2) { return !drop[x2]; }), s.lastT, s.activeTemplates()); toast(selN.length + ' SMS deleted · rotation kept in order'); }
        u.selRows = {}; save(); render(); break;
      }
      case 'rf': u.reportFilter = el.getAttribute('data-f'); render(); break;
      case 'exportLog': {
        var out = ['send_no,datetime,template,template_title,client,phone,sim,status,error'];
        s.log.forEach(function (l) { var c = s.clients[l.c]; out.push([l.n, dFull(l.ms) + ' ' + t24(l.ms), 'T' + T(l.t).id, csvq(T(l.t).title), csvq(c.name), ph(c.phone).replace(/ /g, ''), 'SIM ' + l.sim, l.ok ? 'SENT' : 'FAILED', csvq(l.err || '')].join(',')); });
        download('sent-report.csv', out.join('\n')); break;
      }
    }
  });
  document.addEventListener('input', function (ev) {
    var k = ev.target.getAttribute && ev.target.getAttribute('data-in'); if (!k || SHOT) return;
    S.ui[k] = ev.target.value; if (k === 'search') { S.ui.selClient = null; S.ui.selRows = {}; }
    clearTimeout(S.inT); S.inT = setTimeout(render, k === 'draft' ? 0 : 160);
  });
  function rebuildFromHere() {                       // templates changed: re-plan every future SMS from the current position
    var s = S.sch, act = s.activeTemplates(), M = s.clients.length, live = [];
    for (var i = 0; i < M; i++) if (!s.removed[i]) live.push(i);
    var q = E.buildQueue(live.length, act.length).map(function (e) { return { c: live[e.c], t: act[e.t], key: e.key }; });
    s.queue = E.repair(q, s.lastT, act); save(); render();
  }
  function retime() { var s = S.sch; s.cfg.startMs = Math.max(s.cfg.startMs, S.now); s.cursor = 0; s.clock = E.makeClock(s.cfg); render(); }

  window.Zamu = { state: S, go: go, reset: function () { localStorage.removeItem(KEY); location.reload(); } };
  boot();
})();

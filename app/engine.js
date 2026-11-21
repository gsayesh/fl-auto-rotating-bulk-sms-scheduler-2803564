/* Zamu rotation engine (shared by the app prototype and the Node tests).
 *
 * THE RULE
 *   Send #k (k = 0, 1, 2 …) always uses template  T[(k mod N) + 1]   →  T1 → T2 → … → TN → T1 …
 *   No randomness, no batch reuse: every single send moves the carousel one step.
 *   Every client receives every template exactly once, and a client's messages are spaced about
 *   one full pass of the client list apart (60 clients × 1-minute interval → one SMS per client per hour).
 *
 *   client(k) = (k + floor(k / L)) mod M      with  M = clients, N = templates, g = gcd(M, N), L = M·N / g
 *   (when M and N share no factor, g = 1 and every client is visited exactly every M sends).
 *
 * Times are "wall clock" milliseconds in East Africa Time (no DST) stored with UTC fields.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZamuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60000, DAY = 86400000;

  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }
  function wall(y, m, d, hh, mm, ss) { return Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0); }

  /* ---------- slot clock: k-th sending slot -> wall time ---------- */
  function makeClock(cfg) {
    var iv = Math.max(1, Math.round(cfg.intervalSec)) * 1000;
    var from = cfg.windowFrom * MIN, to = cfg.windowTo * MIN;           // minutes after midnight
    if (to <= from) to = from + iv;                                    // degenerate window guard
    var skip = {}; (cfg.skipDays || []).forEach(function (d) { skip[d] = true; });
    if (Object.keys(skip).length >= 7) skip = {};                      // never skip the whole week
    var perDay = Math.max(1, Math.ceil((to - from) / iv));
    function allowed(dayMs) { return !skip[new Date(dayMs).getUTCDay()]; }
    function nextAllowed(dayMs) { var d = dayMs + DAY; while (!allowed(d)) d += DAY; return d; }

    var day0 = Math.floor(cfg.startMs / DAY) * DAY;
    var first = Math.max(cfg.startMs - day0, from);
    if (first >= to || !allowed(day0)) { day0 = nextAllowed(day0); first = from; }
    var cap0 = Math.max(1, Math.ceil((to - first) / iv));
    var days = [day0];
    function dayAt(i) { while (days.length <= i) days.push(nextAllowed(days[days.length - 1])); return days[i]; }

    function at(k) {
      if (k < cap0) return day0 + first + k * iv;
      var j = k - cap0, i = Math.floor(j / perDay) + 1, off = j % perDay;
      return dayAt(i) + from + off * iv;
    }
    /* number of slots strictly before wall time ms */
    function slotsBefore(ms) {
      var lo = 0, hi = 1;
      while (at(hi) < ms) hi *= 2;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (at(mid) < ms) lo = mid + 1; else hi = mid; }
      return lo;
    }
    return { at: at, slotsBefore: slotsBefore, perDay: perDay, firstDayCapacity: cap0, intervalMs: iv };
  }

  /* ---------- the rotation order (closed form) ---------- */
  function rotationClient(k, M, N) {
    var g = gcd(M, N), L = (M * N) / g;
    return (k + Math.floor(k / L)) % M;
  }
  /* send index at which client c receives template t (inverse of the rule) */
  function sendIndexFor(c, t, M, N) {
    var g = gcd(M, N), L = (M * N) / g;
    var b = (((c - t) % g) + g) % g;
    var k = b * L + ((((c - b - b * L) % M) + M) % M);
    while (k % N !== t) k += M;
    return k;
  }
  function buildQueue(M, N) {
    var q = new Array(M * N);
    for (var k = 0; k < M * N; k++) q[k] = { c: rotationClient(k, M, N), t: k % N, key: k };
    return q;
  }

  /* strict carousel repair after edits: keeps each template's internal order,
     always takes the next template after `lastT` that still has pending sends. */
  function repair(queue, lastT, activeTemplates) {
    var order = activeTemplates.slice().sort(function (a, b) { return a - b; });
    if (!order.length || !queue.length) return queue.slice(0, 0);
    var buckets = {}; order.forEach(function (t) { buckets[t] = []; });
    queue.forEach(function (e) { if (buckets[e.t]) buckets[e.t].push(e); });
    order.forEach(function (t) { buckets[t].sort(function (a, b) { return a.key - b.key; }); });
    var heads = {}; order.forEach(function (t) { heads[t] = 0; });
    var idx = 0; while (idx < order.length && order[idx] <= lastT) idx++; idx = idx % order.length;
    var out = [], left = 0; order.forEach(function (t) { left += buckets[t].length; });
    while (left > 0) {
      var tries = 0;
      while (heads[order[idx]] >= buckets[order[idx]].length && tries < order.length) { idx = (idx + 1) % order.length; tries++; }
      var t = order[idx];
      out.push(buckets[t][heads[t]++]); left--;
      idx = (idx + 1) % order.length;
    }
    return out;
  }

  /* ---------- runtime scheduler with edits, failures, retries and resume ---------- */
  function Scheduler(opts) {
    this.clients = opts.clients;                 // [{id, name, phone, group}]
    this.templates = opts.templates;             // [{id, title, text, deleted?}]
    this.cfg = opts.cfg;                         // {startMs, intervalSec, windowFrom, windowTo, skipDays, sim}
    this.clock = makeClock(this.cfg);
    this.cursor = 0;                             // slots consumed (sent + failed)
    this.lastT = -1;                             // template index of the last send
    this.log = [];                               // [{n, c, t, ms, ok, sim, err}]
    this.retry = [];                             // failed sends, resent at the end of the plan
    this.removed = {};                           // client index -> true (deleted from future plan)
    this.queue = buildQueue(this.clients.length, this.activeTemplates().length);
    // map compact template positions to real template indexes
    var act = this.activeTemplates();
    this.queue.forEach(function (e) { e.t = act[e.t]; });
  }
  Scheduler.prototype.activeTemplates = function () {
    var a = []; this.templates.forEach(function (t, i) { if (!t.deleted) a.push(i); }); return a;
  };
  Scheduler.prototype.pending = function () { return this.queue.length + this.retry.length; };
  Scheduler.prototype.total = function () { return this.log.length + this.pending(); };
  Scheduler.prototype.entryAt = function (i) { return i < this.queue.length ? this.queue[i] : this.retry[i - this.queue.length]; };
  Scheduler.prototype.timeOf = function (i) { return this.clock.at(this.cursor + i); };
  Scheduler.prototype.next = function () { return this.pending() ? this.entryAt(0) : null; };
  Scheduler.prototype.lastPlannedMs = function () { return this.pending() ? this.timeOf(this.pending() - 1) : (this.log.length ? this.log[this.log.length - 1].ms : null); };
  Scheduler.prototype.sentCount = function () { var n = 0; this.log.forEach(function (l) { if (l.ok) n++; }); return n; };
  Scheduler.prototype.failedCount = function () { return this.log.length - this.sentCount(); };

  /* process one send; deliver(entry) -> {ok, err} lets the caller decide success (real SmsManager or simulation) */
  Scheduler.prototype.step = function (deliver, autoReschedule) {
    if (!this.pending()) return null;
    var fromRetry = this.queue.length === 0;
    var e = fromRetry ? this.retry.shift() : this.queue.shift();
    var ms = this.clock.at(this.cursor);
    var r = deliver ? deliver(e, ms) : { ok: true };
    var rec = { n: this.log.length + 1, c: e.c, t: e.t, ms: ms, ok: !!r.ok, sim: this.cfg.sim || 1, err: r.err || '', retry: !!e.retry };
    this.log.push(rec);
    this.cursor++;
    this.lastT = e.t;
    if (!rec.ok && autoReschedule !== false) this.retry.push({ c: e.c, t: e.t, key: 1e9 + rec.n, retry: true });
    return rec;
  };

  /* search & show: every planned + sent SMS of one client, in time order */
  Scheduler.prototype.forClient = function (c) {
    var self = this, rows = [];
    this.log.forEach(function (l) { if (l.c === c) rows.push({ t: l.t, ms: l.ms, state: l.ok ? 'sent' : 'failed' }); });
    for (var i = 0; i < this.pending(); i++) { var e = this.entryAt(i); if (e.c === c) rows.push({ t: e.t, ms: this.timeOf(i), state: e.retry ? 'retry' : 'scheduled', i: i }); }
    rows.sort(function (a, b) { return a.ms - b.ms; });
    return rows;
  };

  /* search & delete: remove every FUTURE SMS of the given clients (the carousel stays strict) */
  Scheduler.prototype.deleteFuture = function (clientIdxs) {
    var del = {}; clientIdxs.forEach(function (c) { del[c] = true; });
    var before = this.pending();
    this.queue = repair(this.queue.filter(function (e) { return !del[e.c]; }), this.lastT, this.activeTemplates());
    this.retry = this.retry.filter(function (e) { return !del[e.c]; });
    var self = this; clientIdxs.forEach(function (c) { self.removed[c] = true; });
    return before - this.pending();
  };
  Scheduler.prototype.activeClientCount = function () { return this.clients.length - Object.keys(this.removed).length; };

  /* bulk delete: drop template t from every future SMS */
  Scheduler.prototype.deleteTemplate = function (t) {
    this.templates[t].deleted = true;
    var before = this.pending();
    this.queue = repair(this.queue.filter(function (e) { return e.t !== t; }), this.lastT, this.activeTemplates());
    this.retry = this.retry.filter(function (e) { return e.t !== t; });
    return before - this.pending();
  };
  /* bulk edit: one master text -> every scheduled SMS of that template (entries reference the template) */
  Scheduler.prototype.editTemplate = function (t, text) { this.templates[t].text = text; return this.queue.filter(function (e) { return e.t === t; }).length; };

  /* auto-update: new contacts join the running plan, one SMS per upcoming pass, without moving anyone else */
  Scheduler.prototype.addClients = function (newClients) {
    var act = this.activeTemplates(), N = act.length, M = this.activeClientCount() + newClients.length;
    var base = this.queue.length ? this.queue[0].key : 0;
    var self = this, start = this.clients.length;
    newClients.forEach(function (cl, j) {
      self.clients.push(cl);
      var c = start + j;
      for (var p = 0; p < N; p++) {
        var t = act[(c + p) % N];
        self.queue.push({ c: c, t: t, key: base + p * M + (j % Math.max(1, M)) + 0.5 });
      }
    });
    this.queue = repair(this.queue, this.lastT, act);
    return newClients.length * N;
  };

  /* crash / reboot resume: everything needed to continue from the exact same send */
  Scheduler.prototype.snapshot = function () {
    return {
      v: 1, cfg: this.cfg, cursor: this.cursor, lastT: this.lastT, removed: this.removed,
      templates: this.templates,
      queue: this.queue.map(function (e) { return [e.c, e.t, e.key]; }),
      retry: this.retry.map(function (e) { return [e.c, e.t, e.key]; }),
      log: this.log.map(function (l) { return [l.c, l.t, l.ms, l.ok ? 1 : 0, l.sim, l.err, l.retry ? 1 : 0]; })
    };
  };
  Scheduler.restore = function (snap, clients) {
    var s = Object.create(Scheduler.prototype);
    s.clients = clients; s.templates = snap.templates; s.cfg = snap.cfg; s.clock = makeClock(snap.cfg);
    s.cursor = snap.cursor; s.lastT = snap.lastT; s.removed = snap.removed || {};
    s.queue = snap.queue.map(function (a) { return { c: a[0], t: a[1], key: a[2] }; });
    s.retry = snap.retry.map(function (a) { return { c: a[0], t: a[1], key: a[2], retry: true }; });
    s.log = snap.log.map(function (a, i) { return { n: i + 1, c: a[0], t: a[1], ms: a[2], ok: !!a[3], sim: a[4], err: a[5], retry: !!a[6] }; });
    return s;
  };

  /* ---------- phone numbers (Tanzania default +255) ---------- */
  function normalizePhone(raw, cc) {
    cc = cc || '255';
    var d = String(raw == null ? '' : raw).replace(/\.0+$/, '').replace(/[^\d+]/g, '');
    if (!d) return null;
    if (d[0] === '+') d = d.slice(1);
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.indexOf(cc) === 0 && d.length === cc.length + 9) d = d.slice(cc.length);
    else if (d[0] === '0' && d.length === 10) d = d.slice(1);
    if (!/^[67]\d{8}$/.test(d)) return null;
    return '+' + cc + d;
  }
  function displayPhone(e164) { var n = '0' + e164.slice(-9); return n.slice(0, 4) + ' ' + n.slice(4, 7) + ' ' + n.slice(7); }

  /* ---------- CSV (comma, semicolon or tab; quoted fields) ---------- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    var firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
    var delim = [',', ';', '\t'].map(function (d) { return [d, firstLine.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.join('').trim()) rows.push(row); row = []; }
      else f += ch;
    }
    row.push(f); if (row.join('').trim()) rows.push(row);
    return rows;
  }

  /* rows -> clients. Header names: name/jina, phone/simu/mobile/number, group/kundi. No header: A = name, B = phone. */
  function rowsToClients(rows, existingPhones) {
    var seen = {}; (existingPhones || []).forEach(function (p) { seen[p] = true; });
    var head = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
    function col(names) { for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) >= 0) return i; return -1; }
    var iName = col(['name', 'jina', 'client', 'full name', 'contact']), iPhone = col(['phone', 'simu', 'mobile', 'number', 'phone number', 'namba']), iGroup = col(['group', 'kundi', 'category']);
    var hasHeader = iPhone >= 0;
    if (!hasHeader) { iName = 0; iPhone = 1; iGroup = 2; }
    var out = [], invalid = 0, dup = 0;
    for (var r = hasHeader ? 1 : 0; r < rows.length; r++) {
      var phone = normalizePhone(rows[r][iPhone]);
      if (!phone) { invalid++; continue; }
      if (seen[phone]) { dup++; continue; }
      seen[phone] = true;
      out.push({ name: String(rows[r][iName] || '').trim() || displayPhone(phone), phone: phone, group: iGroup >= 0 ? String(rows[r][iGroup] || '').trim() : '' });
    }
    return { clients: out, invalid: invalid, duplicates: dup, rows: rows.length - (hasHeader ? 1 : 0) };
  }

  /* SMS segment counter (GSM-7 160 / 153, Unicode 70 / 67) */
  var GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  var GSM_EXT = '^{}\\[~]|€';
  function segments(text) {
    var units = 0, uni = false;
    for (var i = 0; i < text.length; i++) { var ch = text[i]; if (GSM.indexOf(ch) >= 0) units++; else if (GSM_EXT.indexOf(ch) >= 0) units += 2; else { uni = true; break; } }
    if (uni) { var n = Array.from(text).length; return { chars: n, parts: n <= 70 ? 1 : Math.ceil(n / 67), unicode: true }; }
    return { chars: units, parts: units <= 160 ? 1 : Math.ceil(units / 153), unicode: false };
  }

  return {
    MIN: MIN, DAY: DAY, gcd: gcd, wall: wall, makeClock: makeClock,
    rotationClient: rotationClient, sendIndexFor: sendIndexFor, buildQueue: buildQueue, repair: repair,
    Scheduler: Scheduler, normalizePhone: normalizePhone, displayPhone: displayPhone,
    parseCSV: parseCSV, rowsToClients: rowsToClients, segments: segments
  };
});

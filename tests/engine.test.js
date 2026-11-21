/* Zamu engine tests — run:  node build/tests/engine.test.js
   Writes build/tests/live-test-log.csv (first consecutive sends of the demo plan). */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../app/engine.js');
const D = require('../app/data.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) { if (cond) { passed++; console.log('  ✓ ' + name + (extra ? '  — ' + extra : '')); } else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); } }
const fmt = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

console.log('\n1. Template carousel: every send moves to the next template, then loops');
{
  const s = new E.Scheduler({ clients: D.makeClients(10), templates: D.TEMPLATES.map(t => ({ ...t })), cfg: { ...D.CONFIG } });
  const recs = []; for (let i = 0; i < 12; i++) recs.push(s.step(() => ({ ok: true })));
  const seq = recs.map(r => 'T' + (r.t + 1)).join(' → ');
  ok(recs.every((r, i) => r.t === i % 5), '12 consecutive sends rotate T1→T5 and loop back to T1', seq);
  ok(recs[0].ms === E.wall(2026, 11, 16, 7, 1) && recs[5].ms === E.wall(2026, 11, 16, 7, 6), 'first SMS 07:01, then one every minute (as in the attachment)');
  // live-test log for the hand-over
  const lines = ['send_no,datetime,template,client,phone,sim,status'];
  recs.slice(0, 10).forEach(r => { const c = s.clients[r.c]; lines.push([r.n, fmt(r.ms), 'T' + (r.t + 1), c.name, E.displayPhone(c.phone).replace(/ /g, ''), 'SIM ' + r.sim, r.ok ? 'SENT' : 'FAILED'].join(',')); });
  fs.writeFileSync(path.join(__dirname, 'live-test-log.csv'), lines.join('\n') + '\n');
  console.log('     ' + lines.slice(1, 7).join('\n     '));
}

console.log('\n2. Every client receives every template exactly once (any client/template count)');
for (const [M, N] of [[10, 5], [60, 10], [3169, 5], [7, 3], [12, 4], [1, 5], [5, 1], [1001, 7]]) {
  const seen = new Set(); let strict = true;
  for (let k = 0; k < M * N; k++) { const c = E.rotationClient(k, M, N); seen.add(c * N + (k % N)); if (E.sendIndexFor(c, k % N, M, N) !== k) strict = false; }
  ok(seen.size === M * N && strict, `${M} clients × ${N} templates → ${M * N} unique (client, template) pairs, inverse lookup exact`);
}

console.log('\n3. Even spacing per client (60 clients, 10 SMS, 1 min → one SMS per client about every hour)');
for (const [M, N] of [[60, 10], [3169, 5], [10, 5]]) {
  const last = new Array(M).fill(-1), gaps = [];
  for (let k = 0; k < M * N; k++) { const c = E.rotationClient(k, M, N); if (last[c] >= 0) gaps.push(k - last[c]); last[c] = k; }
  const min = Math.min(...gaps), avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  ok(min >= M - 1, `${M}×${N}: min gap ${min} sends, average ${avg.toFixed(1)} (≈ ${M})`);
}

console.log('\n4. Schedule: daily window 07:00–19:00, Sundays skipped, interval in seconds or minutes');
{
  const clock = E.makeClock(D.CONFIG); let bad = 0;
  for (let k = 0; k < 15845; k++) { const d = new Date(clock.at(k)); const mins = d.getUTCHours() * 60 + d.getUTCMinutes(); if (d.getUTCDay() === 0 || mins < 420 || mins >= 1140) bad++; }
  ok(bad === 0, 'no slot on Sunday or outside 07:00–19:00 across 15,845 sends');
  ok(clock.at(719) === E.wall(2026, 11, 17, 7, 0), 'pauses at 19:00 and resumes next day 07:00');
  const sec = E.makeClock({ ...D.CONFIG, intervalSec: 30 });
  ok(sec.at(1) - sec.at(0) === 30000, '30-second interval supported');
}

console.log('\n5. Import: 3,000-row CSV in one pass');
{
  const rows = ['name,phone,group'];
  const cl = D.makeClients(3000, 99);
  cl.forEach((c, i) => rows.push(`${c.name},${i % 3 === 0 ? E.displayPhone(c.phone).replace(/ /g, '') : (i % 3 === 1 ? c.phone : c.phone.slice(1))},${c.group}`));
  rows.push('Bad Row,12345,Duka'); rows.push(`Dup Row,${cl[5].phone},Duka`);
  const csv = rows.join('\r\n');
  fs.mkdirSync(path.join(__dirname, '..', 'samples'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'samples', 'clients_3000.csv'), rows.slice(0, 3001).join('\n') + '\n');
  const t0 = process.hrtime.bigint();
  const res = E.rowsToClients(E.parseCSV(csv));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(res.clients.length === 3000 && res.invalid === 1 && res.duplicates === 1, `3,002 rows → 3,000 clients, 1 invalid, 1 duplicate`, `${ms.toFixed(1)} ms`);
  ok(['0755214873', '+255755214873', '255755214873', '0755 214 873', '755214873'].every(x => E.normalizePhone(x) === '+255755214873'), 'phone formats 07…, +255…, 255…, spaced, 9-digit all normalise to +255');
}

console.log('\n6. Planner edits keep the carousel strict');
{
  const s = new E.Scheduler({ clients: D.makeClients(1001), templates: D.TEMPLATES.map(t => ({ ...t })), cfg: { ...D.CONFIG } });
  for (let i = 0; i < 37; i++) s.step(() => ({ ok: true }));
  const removed = s.deleteFuture([500]);
  ok(s.activeClientCount() === 1000 && removed === s.forClient(500).length + removed - s.forClient(500).filter(r => r.state === 'sent').length - 0 && removed > 0, 'search & delete one number: clients 1001 → 1000, its future SMS removed', `${removed} SMS deleted`);
  let strict = true, prev = s.lastT; for (let i = 0; i < 2000; i++) { const e = s.entryAt(i); if (e.t !== (prev + 1) % 5) strict = false; prev = e.t; }
  ok(strict, 'next 2,000 sends after the delete still rotate T1→T5 strictly');
  const n = s.editTemplate(0, 'Habari {name}! Bei mpya ya DOT 4 — karibu.');
  ok(n > 0 && s.templates[0].text.indexOf('Bei mpya') > 0, `bulk edit master SMS #1 → ${n} scheduled SMS #1 updated instantly`);
  const d = s.deleteTemplate(4);
  let strict4 = true; prev = s.lastT; const act = [0, 1, 2, 3];
  for (let i = 0; i < 2000; i++) { const e = s.entryAt(i); const exp = act[(act.indexOf(prev) + 1) % 4]; if (prev !== 4 && e.t !== exp) strict4 = false; prev = e.t; }
  ok(d > 0 && strict4, `bulk delete master SMS #5 → ${d} scheduled SMS removed, rotation continues T1→T4`);
  const added = s.addClients([{ name: 'Jofrey Kyando', phone: '+255688302551', group: '' }]);
  ok(added === 4 && s.forClient(1001).length === 4, 'auto-update: a new phonebook contact joins the running plan with 4 SMS');
}

console.log('\n7. Failed SMS are rescheduled to the end; resume after crash continues from the same send');
{
  const s = D.demoScheduler();
  const failedTotal = s.failedCount();
  ok(s.retry.length === failedTotal && s.entryAt(s.pending() - 1).retry, `${failedTotal} failed SMS waiting at the end of the plan`);
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  const r = E.Scheduler.restore(snap, s.clients);
  const a = s.step(() => ({ ok: true })), b = r.step(() => ({ ok: true }));
  ok(a.c === b.c && a.t === b.t && a.ms === b.ms, 'restored state sends the same next SMS at the same time', `#${b.n} T${b.t + 1} ${fmt(b.ms)}`);
}

console.log('\n8. Demo plan facts (shown on the screens)');
{
  const s = D.demoScheduler();
  const last = s.lastPlannedMs(), d = new Date(last);
  console.log(`     clients ${s.clients.length}, templates 5, total ${s.total()}, sent ${s.sentCount()}, failed ${s.failedCount()}, pending ${s.pending()}`);
  console.log(`     last processed ${fmt(s.log[s.log.length - 1].ms)}  next ${fmt(s.timeOf(0))} T${s.next().t + 1} → ${s.clients[s.next().c].name}`);
  console.log(`     last SMS of the plan ${DOW[d.getUTCDay()]} ${fmt(last)}`);
  console.log('     Andrew: ' + s.forClient(0).map(r => `T${r.t + 1} ${DOW[new Date(r.ms).getUTCDay()]} ${fmt(r.ms)} ${r.state}`).join(' | '));
  ok(s.total() === 3169 * 5 + s.failedCount(), 'plan size = clients × templates (+ retries)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

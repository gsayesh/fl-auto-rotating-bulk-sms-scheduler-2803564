/* Zamu demo data: a lubricants & spare-parts shop in Mbeya sending product-education SMS in Swahili.
   Deterministic (seeded) so every screen, test and board shows the same numbers. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ZamuData = factory(root.ZamuEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  var TEMPLATES = [
    { id: 1, title: 'DOT 4 · joto kali', text: 'Habari {name}! DOT 4 inahimili joto kali zaidi ya DOT 3, inafaa kwa magari mazito ya mizigo. Karibu dukani!' },
    { id: 2, title: 'Oil ya injini', text: '{name}, badilisha oil ya injini kila km 5,000 ili injini idumu. Oil 15W-40 ipo sasa kwa bei nafuu.' },
    { id: 3, title: 'Brake fluid', text: 'Je, wajua? Brake fluid hufyonza unyevu (maji) taratibu. Ibadilishe kila miaka 2 kwa usalama wa breki zako.' },
    { id: 4, title: 'Mzigo mpya', text: 'Mzigo mpya umefika! Filters, grease na coolant za magari na pikipiki. Tembelea duka letu leo, {name}.' },
    { id: 5, title: 'Asante', text: 'Asante kwa kununua kwetu, {name}! Ukihitaji ushauri wa oil au breki, tupigie au tutumie SMS. Jibu STOP kusitisha.' }
  ];

  // the first ten clients follow the order of the planner example in the brief's attachment
  var FIRST = [
    ['Andrew Mwakyusa', '0755214873', 'Gereji'], ['Briton Kyando', '0713590214', 'Lori'], ['Clinton Mwaipopo', '0784336092', 'Boda'],
    ['Brown Mbilinyi', '0655718440', 'Duka'], ['Edward Sanga', '0754902611', 'Gereji'], ['Fred Mwakalinga', '0767145380', 'Daladala'],
    ['Grace Ngonyani', '0622873905', 'Duka'], ['Happy Mwamba', '0745261734', 'Boda'], ['Irene Haule', '0688430157', 'Lori'],
    ['Jack Mwasomola', '0717604922', 'Gereji']
  ];
  var GIVEN = ['John', 'Joseph', 'Emmanuel', 'Neema', 'Baraka', 'Rehema', 'Juma', 'Halima', 'Amina', 'Daudi', 'Elia', 'Faraja', 'Godfrey', 'Hamisi', 'Isaya',
    'Janeth', 'Kelvin', 'Lucy', 'Mussa', 'Nuru', 'Omary', 'Paulo', 'Rose', 'Salome', 'Tumaini', 'Upendo', 'Victor', 'Winfrida', 'Yusuph', 'Zawadi', 'Agnes',
    'Bahati', 'Charles', 'Dickson', 'Erasto', 'Furaha', 'Gift', 'Hosea', 'Imani', 'Jacob', 'Khadija', 'Lameck', 'Mary', 'Nassoro', 'Obadia', 'Peter',
    'Rashidi', 'Sophia', 'Tatu', 'Yohana', 'Ally', 'Anna', 'Shabani', 'Frank', 'Ezekiel', 'Mariam', 'Aloyce', 'Selemani', 'Esther', 'Gerald'];
  var FAMILY = ['Mwakyusa', 'Kyando', 'Mwaipopo', 'Mbilinyi', 'Sanga', 'Mwakalinga', 'Ngonyani', 'Mwamba', 'Haule', 'Mwasomola', 'Mwakasege', 'Mwaipaja',
    'Mwangosi', 'Mwakilema', 'Mwansasu', 'Kalinga', 'Mwaisaka', 'Mwalukasa', 'Mwakibete', 'Mwanjala', 'Mbwambo', 'Mushi', 'Massawe', 'Lyimo', 'Komba',
    'Mapunda', 'Nyirenda', 'Simbeye', 'Mwampamba', 'Kibona', 'Mwaisumo', 'Ndele', 'Chaula', 'Kayuni', 'Sichalwe', 'Mwanga', 'Shitindi', 'Mwalyego'];
  var PREFIX = ['074', '075', '076', '068', '069', '078', '065', '067', '071', '062', '061'];
  var GROUPS = ['Gereji', 'Boda', 'Lori', 'Daladala', 'Duka'];

  function makeClients(count, seed) {
    var r = rng(seed || 2026), out = [], seen = {};
    FIRST.forEach(function (f) { var p = E.normalizePhone(f[1]); seen[p] = 1; out.push({ name: f[0], phone: p, group: f[2] }); });
    while (out.length < count) {
      var name = GIVEN[Math.floor(r() * GIVEN.length)] + ' ' + FAMILY[Math.floor(r() * FAMILY.length)];
      var num = PREFIX[Math.floor(r() * PREFIX.length)] + String(Math.floor(r() * 1e7)).padStart(7, '0');
      var p = E.normalizePhone(num); if (!p || seen[p]) continue; seen[p] = 1;
      out.push({ name: name, phone: p, group: GROUPS[Math.floor(r() * GROUPS.length)] });
    }
    return out;
  }

  // phonebook sample used by "Import from phonebook" (type "jo" → John, Jofrey, Jose …, as in the brief)
  var PHONEBOOK = [
    ['John Mwakalinga', '0754118204'], ['Jofrey Kyando', '0688302551'], ['Jose Mbilinyi', '0713447090'], ['Joseph Sanga', '0765239118'],
    ['Joyce Haule', '0622915336'], ['Juma Mwamba', '0745880412'], ['Neema Kalinga', '0655104738'], ['Baraka Mushi', '0784670293']
  ].map(function (p) { return { name: p[0], phone: E.normalizePhone(p[1]) }; });

  var CONFIG = {                       // Schedule page defaults (mirrors the brief's example: 1-minute interval, start 7 AM)
    startMs: E.wall(2026, 11, 16, 7, 1), // Mon 16 Nov 2026, 07:01 = first SMS
    intervalSec: 60, windowFrom: 7 * 60, windowTo: 19 * 60, skipDays: [0], sim: 1
  };
  var DEMO_CURSOR = 2367;              // sends already processed in the frozen demo state (Thu 19 Nov, 10:27)

  /* frozen demo state used for screenshots: 2,365 sends done, 31 failed (rescheduled to the end) */
  function demoScheduler(opts) {
    opts = opts || {};
    var clients = makeClients(opts.clients || 3169, 2026);
    var templates = TEMPLATES.map(function (t) { return { id: t.id, title: t.title, text: t.text }; });
    var s = new E.Scheduler({ clients: clients, templates: templates, cfg: Object.assign({}, CONFIG) });
    var r = rng(77), fails = {}, n = 0;
    while (n < 30) { var k = Math.floor(r() * (DEMO_CURSOR - 40)) + 20; if (!fails[k]) { fails[k] = 1; n++; } }
    fails[DEMO_CURSOR - 4] = 1;        // one recent failure so the report shows a reschedule
    var errs = ['No credit (SIM 1)', 'Generic failure', 'No service', 'Radio off'];
    var cursor = opts.cursor == null ? DEMO_CURSOR : opts.cursor;
    for (var i = 0; i < cursor; i++) {
      s.step(function () { return fails[i] ? { ok: false, err: i === DEMO_CURSOR - 4 ? 'No credit' : errs[i % errs.length] } : { ok: true }; }, true);
    }
    return s;
  }

  return { TEMPLATES: TEMPLATES, PHONEBOOK: PHONEBOOK, CONFIG: CONFIG, DEMO_CURSOR: DEMO_CURSOR, GROUPS: GROUPS, makeClients: makeClients, demoScheduler: demoScheduler, rng: rng };
});

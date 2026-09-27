'use strict';
/**
 * One risk scale, and only one.
 *
 * riskClass() used to end in a catch-all: anything that was not red, orange,
 * high or purple became "moderate". So Watch and Moderate were painted the
 * same amber in the Upcoming Forecasts table - which is what prompted this -
 * and, far worse, so was Green. Measured against the live feed at the time:
 * 749 of 795 records carried the amber warning badge for a level that was not
 * Moderate, 732 of them labelled "Green". A routine detection looked like a
 * warning on a disaster site.
 *
 * That was one palette misbehaving. The site then turned out to have four of
 * them - the nav badges, the severity pills, the timeline bars and the
 * accuracy page's own <style> - which disagreed about direction as well as
 * hue: `.badge.watch` was blue while `.sev-moderate` was yellow, so the same
 * level read calmer in one table than in the next. And the map encoded risk in
 * hue alone.
 *
 * So these tests hold three things rather than one: the vocabulary resolves
 * each level to its own class, every rendering carries a second channel
 * besides colour, and nowhere in the site keeps a scale of its own.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RISK = require(path.join(ROOT, 'risk.js'));
/* jsdom windows keep interval timers alive; without this the runner hangs
   after the last test rather than exiting. */
const { renderPage, closeAllWindows } = require('./render.js');
test.after(closeAllWindows);
const CSS = read('risk.css');
const PAGES = fs.readdirSync(ROOT).filter(n => /\.html$/.test(n));

/* ------------------------------------------------- one level, one colour */

test('each risk level resolves to its own class', () => {
  const got = {};
  for (const level of ['Red', 'Orange', 'Moderate', 'Watch', 'Green']) {
    got[level] = RISK.classOf(level);
  }
  // The original complaint: Watch and Moderate rendered identically.
  assert.notEqual(got.Watch, got.Moderate,
    'Watch and Moderate share the class "' + got.Watch + '", so they share a colour');
  // And the larger case underneath it.
  assert.notEqual(got.Green, got.Moderate,
    'a routine Green record is painted with the Moderate warning colour');
  /* GDACS Orange and this app's Moderate ARE one level, and land on one
     swatch on purpose; the six levels themselves must stay six. */
  assert.equal(got.Orange, got.Moderate,
    'the same level under two vocabularies is painted two ways');
  const classes = RISK.LEVELS.map(l => 'risk-' + l.key.toLowerCase());
  assert.equal(new Set(classes).size, classes.length,
    'two levels collapsed into one class: ' + JSON.stringify(classes));
  assert.equal(classes.length, 6, 'the scale is no longer six levels');
});

test('an unrecognised level is not painted as a warning', () => {
  for (const v of ['', ' ', undefined, null, 'Bananas', 'Unknown']) {
    assert.equal(RISK.levelOf(v), 'UNKNOWN',
      JSON.stringify(v) + ' falls through to a level on the scale');
    assert.equal(RISK.level(v).colour, null,
      JSON.stringify(v) + ' was given a colour from the scale');
  }
  /* And the stylesheet must not quietly give it one either. */
  const rule = (CSS.match(/\.risk-unknown\{[^}]*\}/) || [''])[0];
  assert.ok(rule, 'risk-unknown has no styling at all');
  assert.match(rule, /background:transparent/,
    'an unrated record is filled like a level on the scale');
});

test('a substring never decides a colour', () => {
  // "yellow" contains "low"; an includes() check painted it as routine.
  assert.equal(RISK.levelOf('Yellow'), 'WATCH', 'Yellow is the lowest non-green PAGER level');
  assert.notEqual(RISK.levelOf('Yellow'), 'LOW', '"yellow" was matched on its "low" substring');
  // "very high" contains "high"; the old order matched the wrong branch first.
  assert.equal(RISK.levelOf('very high'), 'EXTREME');
  // "Thailand" contains "hail"; a place name is not a level.
  assert.equal(RISK.levelOf('Thailand'), 'UNKNOWN');
});

test('a level named after a colour is painted that colour', () => {
  /* Ranking the words on meaning alone put GDACS Orange on the red swatch and
     Red on the dark-red one. Measured in a browser: a badge reading "Orange"
     filled in red, next to one reading "Moderate" filled in orange. The badge
     always shows the provider's own word, so the fill must not argue with it. */
  const NAMED = { Green: '#22C55E', Yellow: '#FACC15', Orange: '#F97316',
    Red: '#EF4444', Purple: '#7C3AED' };
  const wrong = [];
  for (const [word, hex] of Object.entries(NAMED)) {
    const got = RISK.level(word).colour;
    if (String(got).toUpperCase() !== hex) wrong.push(word + ' is painted ' + got);
  }
  assert.deepEqual(wrong, [],
    'these badges contradict their own text:\n' + wrong.join('\n'));

  /* And the two levels above them are reached by words that are not colours:
     the impact severities this site assigns from what was reported. */
  assert.equal(RISK.levelOf('SEVERE'), 'SEVERE');
  assert.equal(RISK.levelOf('CATASTROPHIC'), 'EXTREME');
  for (const word of Object.keys(NAMED)) {
    assert.ok(!['SEVERE', 'EXTREME'].includes(RISK.levelOf(word)) || word === 'Purple',
      word + ' reaches a level reserved for observed impact');
  }
});

test('the vocabulary covers every level the app and its providers use', () => {
  const unmapped = [];
  for (const v of ['Red', 'Orange', 'Green',                      // GDACS
    'High', 'Moderate', 'Watch', 'Advisory', 'Minor',             // this app
    'CATASTROPHIC', 'EXTREME', 'SEVERE', 'SIGNIFICANT', 'MODERATE', 'MINOR', // observed ledger
    'Yellow', 'Purple', 'very high', 'Critical', 'Informational', 'Routine']) {
    if (RISK.levelOf(v) === 'UNKNOWN') unmapped.push(v);
  }
  assert.deepEqual(unmapped, [],
    'these levels fall off the scale and render unrated: ' + unmapped.join(', '));
});

/* ---------------------------------------------- nowhere keeps its own scale */

test('the classifier exists in exactly one place', () => {
  /* Pages that render before portal.js has loaded used to carry their own
     copy of the vocabulary. Each copy was a place to drift, and one of them -
     home-v3.html, live in production - was missed the first time this test
     was written. Now there is one implementation and everything delegates to
     it, so the drift test becomes a count. */
  const copies = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js)$/.test(n))) {
    if (f === 'risk.js') continue;
    for (const m of read(f).matchAll(/\b(red|orange|green)\b[^\n]{0,80}\?\s*'(?:critical|high|moderate|watch|routine|neutral)'/gi)) {
      copies.push(f + ': ' + m[0].slice(0, 70));
    }
  }
  assert.deepEqual(copies, [],
    'a second risk vocabulary still ships:\n' + copies.join('\n'));
});

test('no page keeps a risk palette of its own', () => {
  /* The hexes the four old palettes used, in any stylesheet or inline style.
     A page that reintroduces one is a page whose levels stop matching the
     rest of the site. */
  const RETIRED = ['#ce2632', '#4aa3df', '#d39018', '#ff5d1b', '#9827c5', '#3fbf8f',
    '#ff8f6b', '#ffc861', '#ff9a9a', '#ffc08a', '#ffe08a'];
  const offenders = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|css)$/.test(n))) {
    const src = read(f);
    for (const hex of RETIRED) if (src.toLowerCase().includes(hex)) offenders.push(f + ' → ' + hex);
  }
  assert.deepEqual(offenders, [],
    'a retired risk colour is still shipping:\n' + offenders.join('\n'));
});

test('the scale is defined once and reaches every page', () => {
  const defs = fs.readdirSync(ROOT)
    .filter(n => /\.(html|css)$/.test(n))
    .filter(n => /--risk-low\s*:/.test(read(n)));
  assert.deepEqual(defs, ['risk.css'],
    'the palette is declared in more than one place: ' + defs.join(', '));

  const missing = PAGES.filter(f => !/href="\/risk\.css"/.test(read(f)));
  assert.deepEqual(missing, [],
    'these pages cannot colour a risk level at all:\n' + missing.join('\n'));

  /* And the scale has to win where a page also loads the shared sheets, or a
     later rule in portal.css decides the level instead. */
  const order = [];
  for (const f of PAGES) {
    const src = read(f);
    const risk = src.indexOf('href="/risk.css"');
    for (const other of ['portal.css', 'app-pages.css']) {
      const i = src.indexOf('href="/' + other + '"');
      if (i >= 0 && i > risk) order.push(f + ': ' + other + ' is loaded after risk.css');
    }
  }
  assert.deepEqual(order, [], order.join('\n'));
});

test('every class a level can resolve to has a colour in the stylesheet', () => {
  const used = [...new Set(['Red', 'Orange', 'Green', 'High', 'Moderate', 'Watch',
    'Yellow', 'Purple', 'Bananas'].map(v => RISK.classOf(v)))];
  const missing = used.filter(c =>
    !new RegExp('\\.' + c + '\\{[^}]*background:').test(CSS));
  assert.deepEqual(missing, [], 'no background for: ' + missing.join(', '));
});

test('no two risk levels are painted the same colour', () => {
  const byColour = {};
  for (const lv of RISK.LEVELS) (byColour[lv.colour] = byColour[lv.colour] || []).push(lv.key);
  const shared = Object.entries(byColour).filter(([, ks]) => ks.length > 1);
  assert.deepEqual(shared, [],
    'these levels share a colour, so they are indistinguishable: ' +
    shared.map(([hex, ks]) => ks.join(' + ') + ' = ' + hex).join(', '));

  /* And the hexes in the module are the hexes that ship. */
  for (const lv of RISK.LEVELS) {
    assert.match(CSS, new RegExp('--risk-' + lv.key.toLowerCase() + ':' + lv.colour, 'i'),
      lv.key + ' is ' + lv.colour + ' in risk.js but not in risk.css');
  }
});

/* --------------------------------------------------- never colour alone */

test('every level carries a shape as well as a colour', () => {
  const shapes = RISK.LEVELS.map(l => l.shape).concat(RISK.UNKNOWN.shape);
  assert.equal(new Set(shapes).size, shapes.length,
    'two levels draw the same shape, so they differ only by hue: ' + shapes.join(', '));
  /* Each one has to be drawn, in both the badge and the marker. */
  const missing = [];
  for (const lv of RISK.LEVELS.concat([RISK.UNKNOWN])) {
    const c = 'risk-' + lv.key.toLowerCase();
    if (!new RegExp('\\.' + c + '::before\\{').test(CSS)) missing.push(c + ' badge');
    if (!new RegExp('\\.risk-mk\\.' + c + ' \\.risk-shape[,{]').test(CSS)) missing.push(c + ' marker');
    /* And in the map's key, which has to show the same shape it explains. */
    if (!new RegExp('\\.pnd-key-mark\\.' + c + ' \\.risk-shape\\{').test(CSS)) missing.push(c + ' key');
  }
  assert.deepEqual(missing, [], 'shapes not drawn for: ' + missing.join(', '));
});

test('a badge is colour, text and shape together', () => {
  for (const lv of RISK.LEVELS) {
    const html = RISK.badge(lv.label);
    assert.match(html, new RegExp('class="risk risk-' + lv.key.toLowerCase() + '[ "]'),
      lv.key + ' badge carries no level class');
    assert.ok(html.includes('>' + lv.label + '<'),
      lv.key + ' badge does not say its level in words');
    assert.match(html, /<i class="risk-shape" aria-hidden="true"><\/i>/,
      lv.key + ' badge has no shape');
  }
  /* The record's own word is what is shown, not the scale's. */
  assert.ok(RISK.badge('Red').includes('>Red<'), 'the provider\u2019s own level was rewritten');
  assert.ok(RISK.badge('CATASTROPHIC').includes('>CATASTROPHIC<'));
  /* The shape is decorative: it must not be announced as part of the name. */
  assert.ok(!/aria-label/.test(RISK.badge('Red')));
});

test('a map marker is never a bare coloured dot', () => {
  const icon = RISK.markerIcon('Red', 'M6.2 earthquake');
  assert.match(icon.className, /risk-mk risk-high/);
  assert.match(icon.html, /role="img"/, 'the marker is not exposed as an image');
  assert.match(icon.html, /aria-label="M6\.2 earthquake — High risk"/,
    'the marker has no accessible name, so a screen reader announces nothing');
  /* Size carries the level too, so the shapes are not the only fallback. */
  const sizes = RISK.LEVELS.map(l => RISK.markerIcon(l.label).iconSize[0]);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), 'marker size does not follow the scale');
  assert.equal(new Set(sizes).size, sizes.length, 'two levels draw the same size marker');
});

test('no page draws its own event marker', () => {
  /* Every map page had its own ternary on three off-palette hues. */
  const offenders = PAGES.filter(f => /circleMarker\(\[[^\]]*\],\s*\{[^}]*alert/.test(read(f)));
  assert.deepEqual(offenders, [],
    'these pages still colour markers by hand:\n' + offenders.join('\n'));
  const usesShared = PAGES.filter(f => /PNDMap\.riskMarker\(/.test(read(f)));
  assert.ok(usesShared.length >= 12,
    'only ' + usesShared.length + ' pages draw markers from the shared scale');
});

/* ------------------------------------- the badge says what it means */

test('a badge never shows a provider\u2019s colour word as its label', async () => {
  /* Measured on the live feed: one card read "Green" beside "Informational",
     the next "Orange" beside "Moderate", and a third "Moderate" beside
     "Moderate" - the same fact printed twice. "Green" and "Orange" are
     GDACS's internal vocabulary and tell a reader nothing about what to do.
     The badge names the level on this site's scale; the provider's own word
     is what it was derived from, and lives in the title. */
  const LEVELS = RISK.LEVELS.map(l => l.label).concat(['Not rated']);
  const COLOUR_WORDS = /^(red|orange|green|yellow|amber|purple|blue)$/i;
  const bad = [];
  for (const page of ['events.html', 'alerts.html', 'live-map.html', 'recent-events.html']) {
    const r = await renderPage(page, { timeoutMs: 6000,
      waitFor: d => d.querySelectorAll('.risk').length > 0 });
    for (const el of r.document.querySelectorAll('.risk')) {
      const text = (el.textContent || '').trim();
      if (COLOUR_WORDS.test(text)) bad.push(page + ': badge reads "' + text + '"');
      else if (!LEVELS.includes(text)) bad.push(page + ': badge reads "' + text + '", not a level on the scale');
      const title = el.getAttribute('title') || '';
      if (!/risk scale|No alert level was published/.test(title)) {
        bad.push(page + ': badge "' + text + '" does not say what it was derived from');
      }
    }
    r.close();
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('one record gets one risk badge, not two saying the same thing', async () => {
  const r = await renderPage('events.html', { timeoutMs: 6000,
    waitFor: d => d.querySelectorAll('.event-card').length > 0 });
  const many = [];
  for (const card of r.document.querySelectorAll('.event-card')) {
    const n = card.querySelectorAll('.risk').length;
    if (n > 1) many.push((card.querySelector('h3') || {}).textContent + ' has ' + n + ' risk badges');
  }
  assert.deepEqual(many, [], many.join('\n'));
  assert.ok(r.document.querySelectorAll('.event-card .risk').length > 0,
    'no card carries a risk level at all');
  r.close();
});

test('a record with no level published is not given one', async () => {
  const r = await renderPage('events.html', { timeoutMs: 6000,
    waitFor: d => d.querySelectorAll('.risk').length > 0 });
  const PND = r.window.PND;
  const tag = PND.riskTag({ title: 'x' });
  assert.match(tag, /risk-unknown/, 'an unrated record was given a level from the scale');
  assert.match(tag, />Not rated</, 'an unrated record does not say it is unrated');
  /* The words these lists used to invent for a record with no level. */
  for (const invented of ['>Live<', '>Watch<']) {
    assert.ok(!tag.includes(invented), 'an unrated record was labelled ' + invented);
  }
  r.close();
});

test('the source pill is short enough to be a pill, with the full name kept', async () => {
  const r = await renderPage('events.html', { timeoutMs: 6000,
    waitFor: d => d.querySelectorAll('.source').length > 0 });
  const long = [];
  for (const el of r.document.querySelectorAll('.source')) {
    const text = (el.textContent || '').trim();
    if (text.length > 30) long.push('"' + text + '" (' + text.length + ' chars)');
    if (!el.getAttribute('title')) long.push('"' + text + '" has no full name behind it');
  }
  assert.deepEqual(long, [], 'source pills that will wrap:\n' + long.join('\n'));
  r.close();
});

/* --------------------------------------------- provenance is not a level */

test('provenance and verdicts are kept off the risk scale', () => {
  for (const sel of ['.prov,.provenance-badge', '.verdict']) {
    const rule = (CSS.match(new RegExp(sel.replace(/[.,]/g, c => '\\' + c) + '\\{[^}]*\\}')) || [''])[0];
    assert.ok(rule, sel + ' has no styling of its own');
    assert.match(rule, /background:transparent/,
      sel + ' is filled like a risk level');
  }
  /* And no page paints one with a level class. */
  const bad = [];
  for (const f of PAGES) {
    for (const m of read(f).matchAll(/class="[^"]*\b(?:badge|risk)[^"]*"[^>]*>\s*(OFFICIAL WARNING|OBSERVED EVENT|MODEL OUTLOOK|EXPERIMENTAL FORECAST|PENDING VERIFICATION|PARTIALLY VERIFIED)/gi)) {
      bad.push(f + ': ' + m[0].slice(0, 80));
    }
  }
  assert.deepEqual(bad, [],
    'these are provenance or verdicts wearing a risk colour:\n' + bad.join('\n'));
});

/* -------------------------------------------------------------- contrast */

function channels(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const linear = c => (c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const luminance = hex => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every risk badge reads at WCAG AA against its own ink', () => {
  const fails = [];
  for (const lv of RISK.LEVELS) {
    const ratio = contrast(lv.colour, lv.ink);
    if (ratio < 4.5) fails.push(lv.key + ' ' + lv.colour + ' on ' + lv.ink + ' = ' + ratio.toFixed(2) + ':1');
  }
  assert.deepEqual(fails, [], 'below AA:\n' + fails.join('\n'));

  /* Each level's ink is the better of the two, not merely a passing one. */
  const worse = RISK.LEVELS.filter(lv =>
    contrast(lv.colour, lv.ink) < contrast(lv.colour, lv.ink === '#000000' ? '#FFFFFF' : '#000000'));
  assert.deepEqual(worse.map(l => l.key), [], 'these levels could read better with the other ink');
});

test('the ink the stylesheet paints is the ink that was measured', () => {
  for (const lv of RISK.LEVELS) {
    const rule = (CSS.match(new RegExp('\\.risk-' + lv.key.toLowerCase() + '\\{[^}]*\\}')) || [''])[0];
    assert.ok(rule, lv.key + ' has no rule in risk.css');
    const wantsDark = lv.ink === '#000000';
    assert.match(rule, wantsDark ? /color:var\(--risk-ink-dark\)/ : /color:var\(--risk-ink-light\)/,
      lv.key + ' is painted with the ink this test did not measure');
  }
  assert.match(CSS, /--risk-ink-dark:#000/);
  assert.match(CSS, /--risk-ink-light:#fff/);
});

/* ------------------------------ no link offered to a reader opens raw JSON */

test('no source link shown to a reader opens a machine-readable endpoint', async () => {
  // A National Weather Service record carried p['@id'] — the CAP record's API
  // URL — as its source link, so "Open original source record" dropped the
  // reader into raw GeoJSON. 36 of 795 live records did this.
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  const { callApi } = require('./render.js');
  const { events } = await (await callApi(handler, '/api/events')).json();

  const RAW = /(^https?:\/\/api\.|\/api\/|\.json($|\?)|\/gdacsapi\/|geteventlist|urn:oid:)/i;
  const bad = events
    .filter(e => e.sourceUrl && RAW.test(e.sourceUrl))
    .map(e => e.source + ' → ' + e.sourceUrl);
  assert.deepEqual(bad, [],
    'these source links open a payload rather than a page:\n' + bad.join('\n'));

  // Every record still has somewhere to send a reader.
  const none = events.filter(e => !e.sourceUrl).map(e => e.source + ' — ' + e.title);
  assert.deepEqual(none, [], 'records with no source link at all:\n' + none.join('\n'));
});

test('a machine-readable record is kept for provenance under its own name', async () => {
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  const { callApi } = require('./render.js');
  const { events } = await (await callApi(handler, '/api/events')).json();
  const nws = events.filter(e => /Weather Service/.test(String(e.source)) && !e.forecast);
  assert.ok(nws.length, 'fixture should include National Weather Service records');
  // The API URL is not thrown away — it moves to a field whose name says what
  // it is, so provenance survives without being offered as something to read.
  assert.ok(nws.some(e => e.sourceApiUrl), 'the API record should be retained as sourceApiUrl');
  for (const e of nws) {
    assert.ok(!/^https?:\/\/api\./.test(e.sourceUrl || ''),
      e.title + ' still links a reader to the API');
  }
});

test('no page offers sourceApiUrl to a reader as a source to open', () => {
  const offenders = fs.readdirSync(ROOT)
    .filter(f => /\.(html|js)$/.test(f))
    .filter(f => /sourceApiUrl/.test(read(f)));
  assert.deepEqual(offenders, [],
    'the machine-readable URL is for provenance, not for a link: ' + offenders.join(', '));
});

/* ------------------------------------------ found reviewing the clutter report */

test('a detail page headlines the site’s level, never the provider’s colour word', async () => {
  /* The lists were fixed; the detail pages were not. Event detail opened with
     "ALERT / RISK: Red" and its action panel read "Severe · Red", alert
     detail printed "Live" for a record with no level at all. */
  const { renderPage } = require('./render.js');
  const { callApi } = require('./render.js');
  const evs = (await (await callApi(require('../api/events.js'), '/api/events')).json()).events;
  const red = evs.find(e => !e.forecast && e.alert === 'Red');
  assert.ok(red, 'fixture: the feed should carry a red record');
  const r = await renderPage('event-detail.html', { search: '?id=' + encodeURIComponent(red.id), timeoutMs: 6000 });
  const k = r.document.getElementById('kRisk').textContent.trim();
  const a = r.document.getElementById('aSeverity').textContent.trim();
  for (const [where, text] of [['the headline box', k], ['the action panel', a]]) {
    assert.doesNotMatch(text, /\b(Red|Orange|Green|Live)\b/,
      where + ' prints "' + text + '", a provider colour or an invented level');
  }
  assert.ok(r.window.PNDRisk.LEVELS.some(l => k.includes(l.label)), 'the headline is not a level on the scale: ' + k);
  r.close();

  for (const page of ['alert-detail.html', 'calamity-detail.html', 'forecast-detail.html']) {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', page), 'utf8');
    assert.doesNotMatch(src, /textContent=e\.alert\|\|'(Live|—)'/,
      page + ' still prints the provider’s alert word as its level');
  }
});

test('a storm’s category is not labelled twice', () => {
  /* The card read "Category Category 3": the label and a value that already
     names itself. */
  const vm = require('node:vm');
  const fs = require('node:fs'), path = require('node:path');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hazard-model.js'), 'utf8'), ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.js'), 'utf8');
  const body = src.slice(src.indexOf('  keyFactsLine(e,max){'), src.indexOf('impactText(e)'));
  const line = new Function('H', 'return {keyFacts(e){return H.keyFacts(e)},esc:s=>s,' +
    body.replace(/,\s*$/, '') + '};')(ctx.window.PNDHazards || require('../hazard-model.js'));
  const text = line.keyFactsLine({ type: 'Tropical Cyclone', windKt: 105, pressureMb: 948 }, 3);
  assert.doesNotMatch(text, /Category Category/, text);
  assert.match(text, /Category 3/);
  assert.match(text, /Maximum sustained wind 105 kt/, 'an ordinary fact lost its label');
});

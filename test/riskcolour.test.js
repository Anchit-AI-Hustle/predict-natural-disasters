'use strict';
/**
 * Every risk level gets its own colour.
 *
 * riskClass() ended in a catch-all: anything that was not red, orange, high or
 * purple became "moderate". So Watch and Moderate were painted the same amber
 * in the Upcoming Forecasts table — which is what prompted this — and, far
 * worse, so was Green. Measured against the live feed at the time: 749 of 795
 * records carried the amber warning badge for a level that was not Moderate,
 * 732 of them labelled "Green". A routine detection looked like a warning on a
 * disaster site.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/**
 * Every implementation that ships, found by scanning rather than by naming.
 *
 * The first version of this test compared portal.js against index.html — the
 * two copies I happened to know about — and passed while home-v3.html, a page
 * live in production, kept the old classifier and its own amber Green badges.
 * Checking the copies you already know about is not a drift test.
 */
function implementations() {
  const found = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js)$/.test(n))) {
    const src = read(f);
    for (const m of src.matchAll(/riskClass\s*\(\s*v\s*=\s*''\s*\)\s*\{/g)) {
      // Take the function body by balancing braces from the opening one.
      let i = m.index + m[0].length - 1, depth = 0, end = -1;
      for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) { end = j; break; }
      }
      assert.ok(end > 0, f + ': could not read the riskClass body');
      found.push({ file: f, fn: new Function('v', src.slice(i + 1, end)) });
    }
  }
  assert.ok(found.length >= 2,
    'expected the shared helper and at least one standalone copy, found ' + found.length);
  return found;
}
const portalImpl = () => {
  const p = implementations().find(x => x.file === 'portal.js');
  assert.ok(p, 'portal.js no longer defines riskClass');
  return p.fn;
};
const portal = portalImpl;

/* ------------------------------------------------- one level, one colour */

test('each risk level resolves to its own class', () => {
  const r = portal();
  const got = {};
  for (const level of ['Red', 'Orange', 'Moderate', 'Watch', 'Green']) got[level] = r(level);

  // The complaint: Watch and Moderate rendered identically.
  assert.notEqual(got.Watch, got.Moderate,
    'Watch and Moderate share the class "' + got.Watch + '", so they share a colour');
  // And the larger case underneath it.
  assert.notEqual(got.Green, got.Moderate,
    'a routine Green record is painted with the Moderate warning colour');

  const classes = Object.values(got);
  assert.equal(new Set(classes).size, classes.length,
    'two levels collapsed into one class: ' + JSON.stringify(got));
});

test('an unrecognised level is not painted as a warning', () => {
  const r = portal();
  for (const v of ['', ' ', undefined, null, 'Bananas', 'Unknown']) {
    assert.equal(r(v), 'neutral',
      JSON.stringify(v) + ' falls through to a warning colour');
  }
});

test('a substring never decides a colour', () => {
  const r = portal();
  // "yellow" contains "low"; an includes() check painted it as routine.
  assert.equal(r('Yellow'), 'moderate', 'Yellow is the lowest non-green PAGER level');
  assert.notEqual(r('Yellow'), 'routine', '"yellow" was matched on its "low" substring');
  // "very high" contains "high"; the old order matched the wrong branch first.
  assert.equal(r('very high'), 'veryhigh');
});

test('every copy of the classifier anywhere in the site agrees with the shared one', () => {
  // Pages that render their list before portal.js must have loaded carry their
  // own copy. Each copy is a place to drift, and one of them — home-v3.html,
  // live in production — was missed the first time this test was written.
  const impls = implementations();
  const ref = impls.find(x => x.file === 'portal.js');
  assert.ok(ref, 'portal.js no longer defines riskClass');

  const LEVELS = ['Red', 'Orange', 'Green', 'High', 'Moderate', 'Watch', 'Yellow',
    'Advisory', 'Extreme', 'Severe', 'Minor', 'Informational', 'Purple', '',
    'Bananas', 'Red Warning', 'very high'];
  const drift = [];
  for (const { file, fn } of impls) {
    if (file === 'portal.js') continue;
    for (const v of LEVELS) {
      if (fn(v) !== ref.fn(v)) {
        drift.push(`${file} ${JSON.stringify(v)}: ${fn(v)} vs portal.js ${ref.fn(v)}`);
      }
    }
  }
  assert.deepEqual(drift, [], 'copies disagree with the shared helper:\n' + drift.join('\n'));
});

test('a page carrying its own classifier also loads a stylesheet that colours it', () => {
  const missing = [];
  for (const { file } of implementations()) {
    if (!/\.html$/.test(file)) continue;
    const src = read(file);
    const inline = /\.watch\{background:#[0-9a-f]{6}\}/.test(src);
    const sheet = /href="\/(portal|app-pages)\.css"/.test(src);
    if (!inline && !sheet) missing.push(file + ' defines riskClass but loads no stylesheet with the colours');
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

/* ------------------------------------------- the colours actually ship */

const CLASSES = ['critical', 'veryhigh', 'high', 'moderate', 'watch', 'routine', 'neutral'];

test('every class a level can resolve to has a colour in every stylesheet', () => {
  const r = portal();
  const used = [...new Set(['Red', 'Orange', 'Green', 'High', 'Moderate', 'Watch',
    'Yellow', 'Purple', 'Bananas'].map(r))];
  const missing = [];
  for (const file of ['portal.css', 'app-pages.css', 'index.html']) {
    const src = read(file);
    for (const c of used) {
      if (!new RegExp('\\.' + c + '\\{background:#[0-9a-f]{6}\\}').test(src)) {
        missing.push(file + ' has no background for .' + c);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('no two risk classes are painted the same colour', () => {
  const src = read('portal.css');
  const byColour = {};
  for (const c of CLASSES) {
    const m = new RegExp('\\.' + c + '\\{background:(#[0-9a-f]{6})\\}').exec(src);
    if (!m) continue;
    (byColour[m[1]] = byColour[m[1]] || []).push(c);
  }
  const shared = Object.entries(byColour).filter(([, cs]) => cs.length > 1);
  assert.deepEqual(shared, [],
    'these classes share a colour, so the levels are indistinguishable: ' +
    shared.map(([hex, cs]) => cs.join(' + ') + ' = ' + hex).join(', '));
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

test('every risk badge reads at WCAG AA against its own text colour', () => {
  const INK = '#10130f';      // --ink, used on the light fills
  const PAPER = '#eaf7f1';    // the page's default foreground on dark fills
  const src = read('portal.css');
  // Which classes the stylesheet paints ink on; the rest inherit paper.
  const inked = new Set((/([^{}]*)\{color:var\(--ink\)\}/.exec(src) || ['', ''])[1]
    .split(',').map(s => s.trim().replace(/^\.(badge|risk)\./, '').replace(/^\./, '')));

  const fails = [];
  for (const c of CLASSES) {
    const m = new RegExp('\\.' + c + '\\{background:(#[0-9a-f]{6})\\}').exec(src);
    if (!m) continue;
    const fg = inked.has(c) ? INK : PAPER;
    const ratio = contrast(m[1], fg);
    if (ratio < 4.5) fails.push(`.${c} ${m[1]} on ${fg} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(fails, [], 'below AA:\n' + fails.join('\n'));
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

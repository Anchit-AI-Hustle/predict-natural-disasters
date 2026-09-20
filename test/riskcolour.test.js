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

/** The two implementations, pulled from the files that actually ship. */
function impl(file, re) {
  const m = re.exec(read(file));
  assert.ok(m, file + ' no longer defines riskClass in the expected shape');
  return new Function('v', m[1]);
}
const portal = () => impl('portal.js', /riskClass\(v=''\)\{([\s\S]*?return 'neutral';)\}/);
const home = () => impl('index.html', /function riskClass\(v=''\)\{([\s\S]*?return 'neutral';)\}/);

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

test('the homepage and the shared helper agree on every level', () => {
  // index.html carries its own copy so its list renders before portal.js must
  // have loaded. Two copies is two places to drift.
  const a = portal(), b = home();
  const drift = [];
  for (const v of ['Red', 'Orange', 'Green', 'High', 'Moderate', 'Watch', 'Yellow',
    'Advisory', 'Extreme', 'Severe', 'Minor', 'Informational', 'Purple', '',
    'Bananas', 'Red Warning', 'very high']) {
    if (a(v) !== b(v)) drift.push(v + ': portal.js=' + a(v) + ' index.html=' + b(v));
  }
  assert.deepEqual(drift, [], 'the two implementations disagree:\n' + drift.join('\n'));
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

'use strict';
/**
 * Colour contrast.
 *
 * A link with no author `color` rule falls through to the browser's default
 * #0000EE, and #551A8B once visited. On this site's dark green surfaces those
 * land at 1.3:1 and 1.1:1 — the source links, coordinate links and every
 * donation and helpline link on the detail pages were unreadable in production.
 * jsdom cannot catch this: it has no UA stylesheet for links, so it reports the
 * anchor inheriting body colour and the page looks fine. These rules are
 * therefore checked against the stylesheet source, which is what ships.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ------------------------------------------------------------- WCAG maths */

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
/** WCAG 2.1 contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;   // normal-size text
const AAA = 7;    // enhanced

test('the contrast maths matches the published WCAG reference values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  // #767676 is the canonical grey that sits exactly on the 4.5:1 AA threshold.
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54');
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'));
});

/* Every surface the site paints text on, sampled at its darkest and lightest. */
const SURFACES = {
  'body (darkest)': '#02100d', 'body (gradient peak)': '#0b3c2d',
  'panel (top)': '#07251b', 'panel (bottom)': '#051b14',
  'card': '#09231b', 'item': '#08251c', 'step': '#08271e',
  'hero (left)': '#03130f', 'hero (mid)': '#073328', 'input': '#09251d'
};
const worstSurface = colour => Object.entries(SURFACES)
  .map(([name, bg]) => ({ name, ratio: contrast(colour, bg) }))
  .sort((a, b) => a.ratio - b.ratio)[0];

/* --------------------------------------------------- the rules that ship */

const SHEETS = ['portal.css', 'app-pages.css'];
// index.html and dashboard.html load neither stylesheet, so they carry their own.
const SELF_CONTAINED = ['index.html', 'dashboard.html'];
const ALL = [...SHEETS, ...SELF_CONTAINED];

/** The style rules that ship for a page: its stylesheet, or its inline <style>. */
function rulesOf(file) {
  const raw = read(file);
  const css = (file.endsWith('.html')
    ? [...raw.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    : raw).replace(/\/\*[\s\S]*?\*\//g, '');   // comments would swallow braces
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: m[1].split(',').map(s => s.trim()), body: m[2] });
  }
  return { css, rules };
}

/** The colour a rule like `a{color:#6fe3ff}` sets, resolved through :root tokens. */
function colourFor(file, selector) {
  const { css, rules } = rulesOf(file);
  // Last declaration wins, as it does in the cascade at equal specificity.
  let value = null;
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    const decl = r.body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
    if (decl) value = decl[1].trim();
  }
  if (!value) return null;
  const token = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!token) return /^#[0-9a-f]{3,8}$/i.test(value) ? value : null;
  const def = css.match(new RegExp(token[1] + '\\s*:\\s*(#[0-9a-f]{3,8})', 'i'));
  return def ? def[1] : null;
}

test('every stylesheet gives bare links an explicit colour', () => {
  // The defect was the absence of this rule, not a bad value in it.
  const missing = ALL.filter(f => colourFor(f, 'a') === null);
  assert.deepEqual(missing, [], 'links fall back to the browser default in: ' + missing.join(', '));
});

test('link colours are readable on every surface the site paints', () => {
  const bad = [];
  for (const file of ALL) {
    for (const selector of ['a', 'a:visited', 'a:hover']) {
      const colour = colourFor(file, selector);
      assert.ok(colour, file + ' has no colour for ' + selector);
      const worst = worstSurface(colour);
      if (worst.ratio < AAA) {
        bad.push(`${file} ${selector} ${colour} → ${worst.ratio.toFixed(2)}:1 on ${worst.name}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'link colours below 7:1:\n' + bad.join('\n'));
});

test('a visited link stays distinguishable from an unvisited one', () => {
  for (const file of ALL) {
    const link = colourFor(file, 'a'), visited = colourFor(file, 'a:visited');
    assert.notEqual(link.toLowerCase(), visited.toLowerCase(), file + ': visited matches unvisited');
  }
});

test('the browser default link colours would fail — which is why the rule is required', () => {
  // Guards the premise: if these ever passed, the rule above would be pointless.
  for (const uaDefault of ['#0000EE', '#551A8B']) {
    assert.ok(worstSurface(uaDefault).ratio < 2,
      uaDefault + ' unexpectedly readable at ' + worstSurface(uaDefault).ratio.toFixed(2) + ':1');
  }
});

/* ------------------------------------------------------------------ badges */

/** Severity badges are 9px bold, so they need the full 4.5:1, not the large-text 3:1. */
const BADGE_INK = '#10130f';
const BADGES = {
  critical: '#ce2632', veryhigh: '#9827c5', high: '#ff5d1b',
  moderate: '#d39018', low: '#187858', 'low (app)': '#16755b',
  blue: '#155a8f', purple: '#7f2aa7'
};

test('every severity badge reads against its own background', () => {
  // high and moderate are too light for white; the stylesheets give them dark ink.
  const darkInk = new Set(['high', 'moderate']);
  const bad = [];
  for (const [name, bg] of Object.entries(BADGES)) {
    const fg = darkInk.has(name) ? BADGE_INK : '#ffffff';
    const r = contrast(fg, bg);
    if (r < AA) bad.push(`${name} ${fg} on ${bg} → ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], 'badges below 4.5:1:\n' + bad.join('\n'));
});

test('the light badges actually carry the dark ink rule', () => {
  for (const file of ALL) {
    const { css } = rulesOf(file);
    assert.match(css, /\.badge\.high\s*,\s*\.badge\.moderate[^}]*\{[^}]*color:\s*(?:var\(--ink\)|#10130f)/,
      file + ': high/moderate badges still take white text');
  }
});

test('no stylesheet reintroduces the amber badge white text could not clear', () => {
  for (const file of SHEETS) {
    assert.ok(!read(file).includes('.moderate{background:#b88119}'),
      file + ': #b88119 is 3.39:1 under white text');
  }
});

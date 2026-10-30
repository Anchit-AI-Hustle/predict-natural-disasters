'use strict';
/**
 * Launch audit A, the live map and shared page chrome.
 *
 *  A16 The live map said "Events reported by official agencies" over a list
 *      and map that include our own forecasts; its H2 "Live map" repeated the
 *      H1 "Live disaster map".
 *  A26 The layer menu opened expanded over the map at 820 px, and "NASA
 *      today (28 Oct)" was two days old.
 *  A11 The header is filled in by script, so the page jumped when it arrived.
 *  A25 The 404 page repeated its H1 in a small heading and left a stray "Done".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.after(closeAllWindows);

test('A16: the live map says it shows our forecasts too, marks them, and does not repeat its title', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#cards .event-card').length > 0 });
  const d = r.document, w = r.window;
  assert.match(d.querySelector('.hero p').textContent, /plus our own forecasts, marked .Our forecast./);
  const h2s = [...d.querySelectorAll('main h2')].map(h => h.textContent);
  assert.ok(!h2s.includes('Live map'), 'the H2 repeats the H1: ' + h2s.join(' | '));
  const map = w.__pndMaps[0];
  const marks = [];
  map.eachLayer(l => { if (l.options && l.options.pndLevel) marks.push(l); });
  assert.ok(marks.some(m => m.options.pndForecast), 'no mark is flagged as our forecast');
  assert.ok(marks.some(m => !m.options.pndForecast));
  const cards = [...d.querySelectorAll('#cards .event-card')];
  assert.ok(cards.some(c => /Our forecast/.test(c.textContent)), 'no card says it is our forecast');
  r.close();
});

test('A26: the layer menu opens collapsed unless the map is wide, and NASA’s photo is dated as the latest', () => {
  const src = read('map-setup.js');
  assert.match(src, /var roomy = !!\(size && size\.x >= 1000\);/);
  assert.match(src, /extras\['NASA \(latest: ' \+ latest\.label \+ '\)'\] = daily;/);
});

test('A26: the tab bar’s targets are at least 44 px tall', () => {
  assert.match(read('portal.css'), /\.top nav a\{flex:1 1 0;min-width:0;min-height:44px;/);
});

test('A11: the header’s space is held before the script fills it, at every width', () => {
  const css = read('portal.css');
  /* Measured in Chromium on the built header, whose rows are now fixed per
     width: 68.8 px on one row from 1100 px, 119.6 px with the menu on its own
     row from 761 to 1099 px, 103.4 px with the logo on its own row on a phone.
     It used to wrap wherever the text ran out (103, 60, 112 and 69 px across
     those widths) under a reservation of 61 or 69 px. */
  assert.match(css, /#nav\{min-height:69px\}/);
  assert.match(css, /@media\(min-width:761px\) and \(max-width:1099px\)\{\.top nav\{order:3;flex:1 1 100%\}#nav\{min-height:120px\}\}/);
  assert.match(css, /@media\(max-width:760px\)\{\.top \.logo\{flex:1 1 100%\}#nav\{min-height:104px\}\}/);
});

test('A25: the 404 page has one heading for "not found" and no stray "Done"', async () => {
  const r = await renderPage('404.html', { url: '/no-such-page', timeoutMs: 4000,
    waitFor: d => /Page not found/.test(d.getElementById('headline').textContent) });
  const d = r.document;
  assert.ok(!/PAGE NOT FOUND/.test(d.querySelector('.hero').textContent), 'the small heading repeats the H1');
  const state = d.getElementById('state');
  assert.ok(state.hidden || !/Done/.test(state.textContent), 'the "Done" status is still shown');
  r.close();
});

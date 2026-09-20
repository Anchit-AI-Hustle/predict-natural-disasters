'use strict';
/**
 * The 3D globe, on every map in the app.
 *
 * Adapted from bilawalsidhu/gods-eye-view (MIT): its Cesium viewer
 * configuration and its keyless imagery/terrain pair. Wired in at
 * PNDMap.basemap, the one call all sixteen map pages already make, and it
 * mirrors whatever each page drew on its Leaflet map rather than asking any of
 * them to change.
 *
 * The last test here is not about the globe. Extending the Leaflet stub so the
 * globe could be tested at all revealed that /live-map has been dead in
 * production: draw() reassigns a const and throws, load() swallows it, and the
 * page reports "Feed unavailable · retrying automatically" over a feed
 * answering 8/8 sources online. It predates this work — origin/main has it,
 * from 438962b — and the existing "renders with no uncaught error" test could
 * never see it, because the exception is caught. So the rule is behavioural:
 * no page may blame the feed while the feed is healthy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const MAP_PAGES = PAGES.filter(f => /\bL\.map\(/.test(read(f)));

test.after(closeAllWindows);

const mounted = d => d.querySelector('.pnd-globe');

/* ---------- it is on every map ---------- */

test('every page that builds a map loads the globe', () => {
  assert.ok(MAP_PAGES.length >= 16, `only found ${MAP_PAGES.length} map pages`);
  const missing = MAP_PAGES.filter(f => !/<script src="\/globe\.js"><\/script>/.test(read(f)));
  assert.deepEqual(missing, [], 'these pages have a map but no globe');
});

test('the globe loads before the code that attaches it', () => {
  for (const f of MAP_PAGES) {
    const s = read(f);
    assert.ok(s.indexOf('/globe.js') < s.indexOf('/map-setup.js'),
      `${f} loads map-setup.js before globe.js, so PNDGlobe is undefined when it is read`);
  }
});

test('a map page mounts a globe and offers a way back to flat', async () => {
  for (const page of ['live-map.html', 'forecasts.html', 'index.html']) {
    const { window } = await renderPage(page, { timeoutMs: 15000, waitFor: mounted });
    const d = window.document;
    assert.ok(d.querySelector('.pnd-globe'), `${page} mounted no globe`);
    const bar = d.querySelector('.pnd-view-toggle');
    assert.ok(bar, `${page} offers no way back to the flat map`);
    assert.equal(bar.querySelectorAll('button').length, 2);
    assert.equal(bar.getAttribute('aria-label'), 'Map view');
    window.close();
  }
});

/* ---------- it shows what the page drew ---------- */

test('the globe plots exactly the markers the page put on its map', async () => {
  const { window } = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: () => (window.__pndViewers || []).length &&
      window.__pndViewers[0].entities.values.length });
  const map = window.__pndMaps[0];
  const drawn = window.PNDGlobe.readMarkers(map);
  assert.ok(drawn.length > 5, `the page only drew ${drawn.length} markers`);
  const plotted = window.__pndViewers[0].entities.values;
  assert.equal(plotted.length, drawn.length,
    'the globe and the flat map disagree about how many events there are');
  /* And in the right places, with the level the page chose. */
  const byPos = plotted.map(e => `${e.position.lat},${e.position.lon}`).sort();
  const expect = drawn.map(m => `${m.lat},${m.lon}`).sort();
  assert.deepEqual(byPos, expect);
  assert.ok(plotted.every(e => /^#/.test(e.point.color.css)));
  window.close();
});

test('the globe follows the page when its markers change', async () => {
  const { window } = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: () => (window.__pndViewers || []).length &&
      window.__pndViewers[0].entities.values.length });
  const before = window.__pndViewers[0].entities.values.length;
  const box = window.document.getElementById('q');
  box.value = 'zzzzzznotathing';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const after = window.__pndViewers[0].entities.values.length;
  assert.notEqual(after, before, 'the globe kept showing records the page had filtered away');
  assert.equal(after, window.PNDGlobe.readMarkers(window.__pndMaps[0]).length);
  window.close();
});

/* ---------- it never needs an account, and it credits its sources ---------- */

test('no ion token is set, anywhere', () => {
  for (const f of ['globe.js', 'map-setup.js']) {
    assert.doesNotMatch(read(f), /Ion\.defaultAccessToken|ion\.cesium\.com|accessToken/,
      `${f} reaches for a Cesium ion account`);
  }
  const g = read('globe.js');
  assert.match(g, /baseLayer: false/, 'the viewer would fetch ion imagery by default');
});

test('the imagery and terrain it uses are credited', () => {
  const g = read('globe.js');
  assert.match(g, /Powered by Esri/);
  assert.match(g, /CC BY 4\.0/, 'Re:Earth terrain is CC BY 4.0 and must be credited');
  assert.match(g, /gods-eye-view \(MIT/, 'the MIT source it is adapted from is not credited');
});

/* ---------- it never costs anyone their map ---------- */

test('with no WebGL there is no globe, and no error', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000, cesium: false });
  assert.equal(mounted(r.document), null, 'a globe was mounted with no WebGL to draw it');
  assert.deepEqual(r.errors.map(e => String(e && e.message)), [],
    'losing the globe broke the page');
  /* The flat map is still there and still has the page's markers. */
  const map = r.window.__pndMaps[0];
  assert.ok(r.window.PNDGlobe.readMarkers(map).length > 0,
    'the flat map lost its markers too');
  r.window.close();
});

test('choosing flat never downloads Cesium', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    storage: { pnd_map_view: 'flat' } });
  const d = r.document;
  assert.equal(mounted(d), null, 'the globe mounted for a reader who chose flat');
  const bar = d.querySelector('.pnd-view-toggle');
  assert.ok(bar, 'the toggle is missing, so there is no way back to the globe');
  assert.equal(bar.querySelectorAll('button')[1].getAttribute('aria-pressed'), 'true');
  r.window.close();
});

test('the preference is remembered rather than re-asked', () => {
  const g = read('globe.js');
  assert.match(g, /localStorage/);
  assert.match(g, /pnd_map_view/);
  /* And a private window, where storage throws, must not take the map down. */
  assert.match(g, /catch \(e\) \{ return 'globe'; \}/);
});

/* ---------- the bug the harness work uncovered ---------- */

/* textContent includes the source of every inline <script>, so reading it
   raw reported ten pages as broken because their code contains the string it
   was looking for. Only what a reader can actually see counts. */
function visibleText(doc) {
  const body = doc.body.cloneNode(true);
  body.querySelectorAll('script,style,template,noscript').forEach(n => n.remove());
  return body.textContent;
}

const BLAME = [
  'Feed unavailable', 'Live feed unavailable', 'Upstream feed unavailable',
  'Live forecast feed unavailable', 'Verification data unavailable',
  'Evidence feed unavailable'
];

test('no page blames the feed while the feed is healthy', async () => {
  /* /live-map showed "Feed unavailable · retrying automatically" over a feed
     answering 8/8 sources online, because draw() threw inside load()'s try and
     the catch reported the wrong cause. An uncaught-error test cannot see
     this; only what the reader is told can. */
  const offenders = [];
  for (const page of MAP_PAGES) {
    const r = await renderPage(page, { timeoutMs: 15000,
      waitFor: d => !/Loading\u2026|Refreshing/.test(visibleText(d)) });
    const text = visibleText(r.document);
    for (const phrase of BLAME) {
      if (text.includes(phrase)) offenders.push(`${page}: "${phrase}"`);
    }
    r.window.close();
  }
  assert.deepEqual(offenders, [],
    'these pages tell the reader the feed is down while it is up');
});

test('and it does say so when the feed really is down', async () => {
  /* So the test above cannot pass by the pages simply never saying anything. */
  const r = await renderPage('live-map.html', { timeoutMs: 12000, feedDown: true,
    waitFor: d => /unavailable/i.test(d.body.textContent) });
  const text = visibleText(r.document);
  assert.ok(BLAME.some(p => text.includes(p)),
    'with the feed down the page says nothing at all, so the check above proves nothing');
  r.window.close();
});

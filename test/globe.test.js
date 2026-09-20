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

/* globe.js run on its own, with no page around it, so the marker rules can be
   exercised against layers this suite constructs rather than whatever a page
   happened to draw. */
function loadGlobe() {
  const vm = require('node:vm');
  /* Just enough of a browser for the module to define itself: it returns
     early without a window and a document, and everything under test here is
     pure. */
  const el = () => ({ style: { cssText: '' }, className: '', appendChild() {},
    setAttribute() {}, remove() {}, addEventListener() {} });
  const ctx = vm.createContext({
    window: {},
    document: { createElement: el, head: el(), documentElement: el() },
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ position: 'relative' }),
    Promise, setTimeout, clearTimeout
  });
  vm.runInContext(read('globe.js'), ctx);
  assert.ok(ctx.window.PNDGlobe, 'globe.js defined nothing');
  return { PNDGlobe: ctx.window.PNDGlobe };
}
function pt(lat, lng, options) {
  return { getLatLng: () => ({ lat, lng }), options: options || {} };
}
function fakeMap(layers) {
  return { eachLayer: fn => layers.forEach(fn) };
}


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

test('the basemap country labels are not plotted as hazards', () => {
  /* political() draws every country's name as a marker, and a marker has a
     position like any other. Mirrored blindly they became default green
     points, so the globe showed events in the middle of Canada and Brazil
     that do not exist. They are declared non-interactive and live in their
     own pane; a page's event markers are neither. */
  const { PNDGlobe } = loadGlobe();
  const label = pt(56, -106, { interactive: false, pane: 'pndLabels' });
  const hazard = pt(27.7, 85.3, { radius: 9, color: '#ef2639' });
  const got = PNDGlobe.readMarkers(fakeMap([label, hazard]));
  assert.equal(got.length, 1, 'a basemap label was mirrored as an event');
  assert.equal(got[0].lat, 27.7);
});

test('a label in the default pane is still excluded by being non-interactive', () => {
  const { PNDGlobe } = loadGlobe();
  const got = PNDGlobe.readMarkers(fakeMap([pt(10, 10, { interactive: false })]));
  /* Length, not deepEqual: the array comes from a vm realm, so its Array is
     not this realm's and a strict deep comparison fails on the constructor. */
  assert.equal(got.length, 0);
});

test('an ordinary event marker is not excluded by accident', () => {
  const { PNDGlobe } = loadGlobe();
  const got = PNDGlobe.readMarkers(fakeMap([
    pt(1, 2, { radius: 5, color: '#25e29c' }),
    pt(3, 4, {})
  ]));
  assert.equal(got.length, 2);
});

/* ---------- the flat map stays visible until there is a globe ---------- */

test('the globe host is hidden until the viewer exists', () => {
  const g = read('globe.js');
  assert.match(g, /display:none/,
    'the host is appended visible, covering the flat map for the whole download');
  assert.match(g, /reveal: function/);
  const m = read('map-setup.js');
  assert.match(m, /handle\.reveal\(\)/, 'nothing ever reveals it');
});

test('a mounted globe reveals itself only once ready', async () => {
  const { window } = await renderPage('live-map.html', { timeoutMs: 15000, waitFor: mounted });
  const host = window.document.querySelector('.pnd-globe');
  assert.ok(host);
  /* By the time the viewer exists it must be visible; before that, hidden. */
  await new Promise(r => setTimeout(r, 300));
  assert.notEqual(host.style.display, 'none',
    'the globe never became visible even though its viewer was created');
  window.close();
});

/* ---------- the globe must actually be on top ---------- */

test('the globe covers every Leaflet pane, and the toggle covers the globe', () => {
  /* Leaflet stacks its panes tile 200, overlay 400, shadow 500, marker 600,
     tooltip 650, popup 700, control 800. The host was at 400 — the overlay
     level — so the flat map's markers and controls stayed above the Cesium
     canvas. Rotating the globe then left those markers fixed on screen while
     the mirrored points moved underneath, showing every hazard in two places
     and neither of them right. */
  const LEAFLET_TOP = 800;
  const globeZ = Number((read('globe.js').match(/z-index:(\d+);background:#04120e/) || [])[1]);
  assert.ok(Number.isFinite(globeZ), 'the globe host sets no z-index');
  assert.ok(globeZ > LEAFLET_TOP,
    `the globe sits at ${globeZ}, under Leaflet's controls at ${LEAFLET_TOP}`);
  const toggleZ = Number((read('map-setup.js')
    .match(/\.pnd-view-toggle\{[^']*z-index:(\d+)/) || [])[1]);
  assert.ok(Number.isFinite(toggleZ), 'the toggle sets no z-index');
  assert.ok(toggleZ > globeZ,
    `the toggle at ${toggleZ} is under the globe at ${globeZ}, so it cannot be pressed`);
});

/* ---------- a hazard on the globe can be read ---------- */

test('clicking a hazard can show what it is', async () => {
  const { window } = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: () => (window.__pndViewers || []).length &&
      window.__pndViewers[0].entities.values.length });
  const v = window.__pndViewers[0];
  /* The description is carried... */
  const withText = v.entities.values.filter(e => e.description && /<b>/.test(e.description));
  assert.ok(withText.length > 0, 'entities carry no description at all');
  /* ...and something is configured that can display it. Carrying a popup the
     viewer cannot render left every hazard on the globe unreadable. */
  assert.equal(v.__opts.infoBox, true,
    'infoBox is off, so nothing can display the description each entity carries');
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

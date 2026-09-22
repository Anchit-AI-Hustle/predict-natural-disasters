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
/* Leaflet's own defaults, which the first version of these fixtures omitted.
   A real Marker carries pane 'markerPane' and a CircleMarker 'overlayPane',
   both set by Leaflet whether or not the caller asks — so a bare {} fixture
   tested a shape that never reaches this code, and a guard that rejected
   every layer with a pane passed here while emptying the globe in production. */
function pt(lat, lng, options, pane) {
  return {
    getLatLng: () => ({ lat, lng }),
    options: Object.assign({ interactive: true, pane: pane || 'markerPane' },
      options || {})
  };
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
  const label = pt(56, -106, { interactive: false, pane: 'pndLabels' }, 'pndLabels');
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
  /* With Leaflet's real defaults. Every hazard on every map page is a marker
     or circleMarker in markerPane or overlayPane, and a guard that rejected
     any layer with a pane threw all of them away. */
  const { PNDGlobe } = loadGlobe();
  const got = PNDGlobe.readMarkers(fakeMap([
    pt(1, 2, { radius: 5, color: '#25e29c' }, 'overlayPane'),
    pt(3, 4, {}, 'markerPane'),
    pt(5, 6, {})
  ]));
  assert.equal(got.length, 3,
    'real event markers were rejected for carrying the pane Leaflet gives them');
});

test('a marker survives every pane Leaflet puts one in', () => {
  const { PNDGlobe } = loadGlobe();
  for (const pane of ['markerPane', 'overlayPane', 'shadowPane', 'tooltipPane']) {
    const got = PNDGlobe.readMarkers(fakeMap([pt(1, 2, {}, pane)]));
    assert.equal(got.length, 1, `a marker in ${pane} was thrown away`);
  }
});

test('the pane the globe excludes is the pane the basemap uses', () => {
  /* Named in two files; a test rather than a shared import, because globe.js
     loads before map-setup.js and cannot read the constant at parse time. */
  assert.match(read('map-setup.js'), /var LABEL_PANE = 'pndLabels';/);
  assert.match(read('globe.js'), /\|\| 'pndLabels'/);
  assert.match(read('map-setup.js'), /LABEL_PANE: LABEL_PANE/,
    'map-setup does not publish the pane name the globe reads');
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

test('the globe covers everything Leaflet draws, toggle included', () => {
  /* Leaflet 1.9.4's stylesheet, read rather than remembered: the panes run
     tile 200 … control 800, but .leaflet-top and .leaflet-bottom — the
     containers the zoom and layers controls live in — are at 1000.
     The first version of this test asserted only "above 800", so a globe at
     900 passed while a real browser screenshot showed the zoom and layers
     controls sitting on top of the globe. The pane list is not the whole
     stacking order. */
  const LEAFLET_TOP = 1000;
  const globeZ = Number((read('globe.js').match(/z-index:(\d+);background:#04120e/) || [])[1]);
  assert.ok(Number.isFinite(globeZ), 'the globe host sets no z-index');
  assert.ok(globeZ > LEAFLET_TOP,
    `the globe sits at ${globeZ}, under Leaflet's control containers at ${LEAFLET_TOP}`);
  const toggleZ = Number((read('map-setup.js')
    .match(/\.pnd-view-toggle\{[^']*z-index:(\d+)/) || [])[1]);
  assert.ok(Number.isFinite(toggleZ), 'the toggle sets no z-index');
  assert.ok(toggleZ > globeZ,
    `the toggle at ${toggleZ} is under the globe at ${globeZ}, so it cannot be pressed`);
});

test('the flat map controls are hidden while the globe is showing', () => {
  /* Raising the globe above them is not enough on its own: they drive the
     Leaflet map underneath, so a zoom button left visible would be one that
     visibly does nothing. They go with the map they control. */
  const g = read('globe.js');
  assert.match(g, /leaflet-control-container/,
    'nothing hides the flat map controls when the globe takes over');
  assert.match(g, /reveal: function[\s\S]{0,240}setControls\('none'\)/);
  assert.match(g, /hide: function[\s\S]{0,120}setControls\(''\)/,
    'the controls never come back when the reader presses Flat');
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
test('every hazard on the globe is named, and named what the map calls it', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length &&
      w.__pndViewers[0].entities.values.length });
  const ents = r.window.__pndViewers[0].entities.values;
  assert.ok(ents.length > 0, 'the globe plotted nothing to name');
  /* Cesium heads its info box with the entity's own generated id when an
     entity has no name, so a reader who clicked a flood in Nepal got a panel
     titled 2d209c77-12a8-4d55-ba59-414a34cd6853. */
  const unnamed = ents.filter(e => !e.name);
  assert.equal(unnamed.length, 0, unnamed.length + ' hazards would be headed by a generated id');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
  assert.ok(!ents.some(e => uuid.test(String(e.name))), 'a hazard is named with a generated id');
  /* And the name is the one the flat map's own popup leads with, not some
     second title invented for the globe. */
  ents.forEach(e => {
    const bold = /<b[^>]*>([\s\S]*?)<\/b>/i.exec(String(e.description));
    if (!bold) return;
    const want = bold[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(String(e.name).replace(/…$/, ''), want.slice(0, String(e.name).replace(/…$/, '').length),
      'the globe renamed a hazard the map calls "' + want + '"');
  });
  r.window.close();
});

/* ---------- every Cesium symbol it calls actually exists ---------- */

test('globe.js only calls Cesium symbols that exist in the pinned version', () => {
  /* globe.js was written against Cesium from memory and loads it from a CDN,
     so nothing here could tell whether the symbols it calls are real: a
     misremembered class or option would fail only in a reader's browser while
     the stubbed tests stayed green. The manifest is extracted from the
     published type definitions of the exact version globe.js loads — see
     tools/cesium-manifest.js — so the check is against Cesium rather than
     against my memory of it. */
  const api = JSON.parse(read(path.join('test', 'cesium-api.json')));
  const src = read('globe.js');

  /* The version it loads must be the version that was checked. */
  const loaded = (src.match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(loaded, api.version,
    `globe.js loads Cesium ${loaded} but the manifest describes ${api.version}`);

  const unknown = [];
  /* Uppercase only: Cesium exports classes and namespaces in PascalCase, and
     the file also contains the CDN path 'Cesium.js', which is a filename
     rather than a symbol. */
  for (const m of src.matchAll(/\bCesium\.([A-Z][\w$]*)/g)) {
    if (!api.exports.includes(m[1])) unknown.push('Cesium.' + m[1]);
  }
  assert.ok(unknown.length > 0 || /Cesium\.[A-Z]/.test(src),
    'no Cesium symbols were found at all, so this test proves nothing');
  assert.deepEqual([...new Set(unknown)], [],
    'these are not exported by the Cesium version globe.js loads');
});

test('the Viewer options and point graphics it passes are real options', () => {
  const api = JSON.parse(read(path.join('test', 'cesium-api.json')));
  const src = read('globe.js');

  /* Top-level keys of an object literal, found by tracking depth rather than
     by line. The first version of this matched one key per line, and globe.js
     puts several on a line — so ten of the fourteen Viewer options were never
     checked, and a deliberately misspelled one sailed through the control. */
  function topLevelKeys(source, openAt) {
    const start = source.indexOf('{', openAt);
    let depth = 0, i = start, keys = [];
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      else if (depth === 1) {
        const rest = source.slice(i);
        const m = rest.match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (m && !/[\w$]/.test(source[i - 1] || '')) { keys.push(m[1]); i += m[0].length - 1; }
      }
    }
    return keys;
  }

  /* Comments stripped first. Prose inside the options object matched the key
     pattern — "no way to read it: clicking a hazard…" produced Viewer.it —
     which is the third time on this branch that a comment of mine has
     defeated a test of mine. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const viewerKeys = topLevelKeys(code, code.indexOf('new Cesium.Viewer('));
  const pointKeys = topLevelKeys(code, code.indexOf('point: {'));
  /* The extraction must be finding things, or the assertions below are empty. */
  assert.ok(viewerKeys.length >= 12,
    `only found ${viewerKeys.length} Viewer options: ${viewerKeys.join(', ')}`);
  assert.ok(pointKeys.length >= 5,
    `only found ${pointKeys.length} point options: ${pointKeys.join(', ')}`);

  const bad = [];
  for (const k of viewerKeys) if (!api.members.Viewer.includes(k)) bad.push('Viewer.' + k);
  for (const k of pointKeys) if (!api.members.PointGraphics.includes(k)) bad.push('PointGraphics.' + k);
  assert.deepEqual([...new Set(bad)], [],
    'these option names do not exist on the types globe.js passes them to');
});

test('the manifest describes the version, and was not hand-written', () => {
  const api = JSON.parse(read(path.join('test', 'cesium-api.json')));
  assert.match(api.note, /Generated by tools\/cesium-manifest\.js/);
  assert.ok(api.exports.length > 400, `only ${api.exports.length} exports recorded`);
  /* Sanity: the manifest is of Cesium, not of something else. */
  for (const core of ['Viewer', 'Cartesian3', 'Color', 'Entity']) {
    assert.ok(api.exports.includes(core), `${core} missing from the manifest`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'cesium-manifest.js')),
    'the generator is not committed, so the manifest cannot be regenerated');
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

test('the basemap it draws is the flat map\'s, and is credited', async () => {
  const g = read('globe.js');
  assert.match(g, /gods-eye-view \(MIT/, 'the MIT source it is adapted from is not credited');
  assert.match(g, /CC BY 4\.0/, 'Re:Earth terrain is CC BY 4.0 and must be credited');
  /* This used to assert the opposite - that the globe must NOT credit Esri,
     because it had stopped fetching Esri imagery. The reason it stopped was a
     browser check finding that its provider asked a MapServer for metadata
     and never requested a tile. That check ran on a machine where
     server.arcgisonline.com is unreachable, where a blocked host and a broken
     provider look exactly alike, and the globe lost its imagery to a
     firewall. Re-measured against a stand-in MapServer on localhost serving
     real metadata and real tiles, the tiled provider issued 128 tile requests
     and 0 metadata requests. So Esri is fetched again, and credited because
     it is fetched. */
  assert.match(g, /ESRI_CREDIT/,
    'the globe fetches Esri imagery and must carry its credit');

  const r = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length &&
      w.__pndViewers[0].imageryLayers.length });
  const layers = r.window.__pndViewers[0].imageryLayers;
  /* Three, in this order: the painted world underneath so an unreachable tile
     host costs detail rather than the globe, then the satellite imagery, then
     the reference layer that names what you are looking at. */
  assert.equal(layers.length, 3,
    'the globe carries ' + layers.length + ' imagery layers, not the painted world + satellite + places');
  const added = layers.__all || [];
  assert.match(String(added[0] && added[0].opts && added[0].opts.credit),
    /Natural Earth/, 'the outlines the globe draws are not credited to Natural Earth');
  assert.equal(added[0] && added[0].tileWidth, 2048,
    'the painted world is not the bottom layer');
  assert.ok(added[1] && added[1].url && /arcgisonline/.test(String(added[1].url)),
    'the satellite layer is not the Esri imagery the flat map uses');
  assert.equal(added[1] && added[1].maximumLevel, 18,
    'the satellite layer stops short of the zoom the flat map offers');
  r.window.close();
});

test('the globe paints the flat map\'s own countries, not a blank sphere', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length &&
      w.__pndViewers[0].imageryLayers.length });
  /* Every fill the world texture made, recorded by the canvas stub. The ocean
     goes down first and then one fill per landmass, each in a palette colour
     the flat map itself uses — so a globe painted from some other palette, or
     from nothing, is not mistaken for this. */
  const ops = (r.window.__pndPaints || [])
    .slice().sort((a, b) => b.fills.length - a.fills.length)[0];
  assert.ok(ops, 'the globe painted no canvas at all');
  const palette = r.window.PNDMap.PALETTE;
  assert.ok(ops.fills.some(f => f.startsWith('rect:') && f.endsWith(r.window.PNDMap.OCEAN)),
    'the ocean was never laid down');
  const land = ops.fills.filter(f => f.startsWith('evenodd:'));
  assert.ok(land.length > 100,
    'only ' + land.length + ' landmasses were painted; the world file has 177 countries');
  assert.ok(land.every(f => palette.indexOf(f.split(':')[1]) >= 0),
    'a country was painted in a colour the flat map does not use');
  r.window.close();
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

'use strict';
/**
 * Map interaction.
 *
 * Leaflet turns scroll-wheel zoom on by default, so a reader scrolling down a
 * page with a tall map stops dead over it and starts zooming instead. The wheel
 * must engage only once they have actually reached for the map, while drag,
 * pinch, double-click and the +/- control stay available throughout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

// jsdom windows keep interval timers alive; without this the runner never exits.
test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MAP_PAGES = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && /L\.map\(/.test(read(f)));

test('every page that builds a map loads the shared setup, after Leaflet', () => {
  assert.ok(MAP_PAGES.length >= 10, 'expected the map pages to be found');
  const missing = [], misordered = [];
  for (const page of MAP_PAGES) {
    const src = read(page);
    if (!src.includes('/map-setup.js')) { missing.push(page); continue; }
    // It wraps L.map, so it is useless before Leaflet defines it.
    if (src.indexOf('/map-setup.js') < src.indexOf('leaflet@1.9.4/dist/leaflet.js')) misordered.push(page);
    // ...and useless after the page has already built its map.
    if (src.indexOf('/map-setup.js') > src.indexOf('L.map(')) misordered.push(page);
  }
  assert.deepEqual(missing, [], 'map pages without the guard: ' + missing.join(', '));
  assert.deepEqual(misordered, [], 'guard loaded at the wrong point in: ' + misordered.join(', '));
});

/** The maps a page built, as recorded by the harness's Leaflet stub. */
const mapsOf = r => r.window.__pndMaps || [];

test('a map does not capture the wheel until the reader engages with it', async () => {
  for (const page of ['index.html', 'live-map.html', 'event-detail.html']) {
    const r = await renderPage(page, {
      search: page === 'event-detail.html' ? '?id=ND-001' : '',
      timeoutMs: 3000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
    });
    const maps = mapsOf(r);
    assert.ok(maps.length, page + ' built no map');
    for (const map of maps) {
      assert.equal(map.scrollWheelZoom.enabled(), false, page + ': wheel captured on load');
      map.fire('click');
      assert.equal(map.scrollWheelZoom.enabled(), true, page + ': wheel still inert after a click');
      map.fire('blur');
      assert.equal(map.scrollWheelZoom.enabled(), false, page + ': wheel stays captured after leaving');
    }
    r.close();
  }
});

test('the guard leaves dragging, pinch and the zoom control alone', () => {
  const src = read('map-setup.js');
  for (const option of ['dragging', 'touchZoom', 'doubleClickZoom', 'zoomControl', 'boxZoom', 'keyboard']) {
    assert.ok(!new RegExp(option + '\\s*[:=]').test(src),
      'the guard should not touch ' + option + ' — Leaflet already enables it');
  }
  assert.match(src, /scrollWheelZoom/, 'the guard does not touch the wheel at all');
});

test('the map is reachable by keyboard, so the wheel can be engaged without a mouse', async () => {
  const r = await renderPage('live-map.html', {
    timeoutMs: 3000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
  });
  for (const map of mapsOf(r)) {
    const node = map.getContainer();
    if (node) assert.ok(node.hasAttribute('tabindex'), 'map container is not focusable');
  }
  r.close();
});

test('a page that deliberately asks for wheel zoom keeps it', async () => {
  // The guard must not override an explicit choice.
  const r = await renderPage('live-map.html', {
    timeoutMs: 2000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
  });
  const { window } = r;
  const explicit = window.L.map(window.document.createElement('div'), { scrollWheelZoom: true });
  assert.equal(explicit.scrollWheelZoom.enabled(), true, 'an explicit opt-in was overridden');
  r.close();
});

/* ------------------------------------------------- the whole world is shown */

test('no page hard-codes the zoom at which the world supposedly fits', () => {
  // Every page opened with setView([20,10], 2), which puts a 1024px-tall world
  // in a ~460px panel: the map opened showing 70N to 52S, cutting a third of
  // the southern hemisphere. The zoom depends on the container, so it is
  // measured at runtime rather than written into each page.
  const offenders = [];
  for (const page of MAP_PAGES) {
    const src = read(page);
    for (const m of src.matchAll(/L\.map\((?:[^()]|\([^()]*\))*\)\.setView\([^)]*\)/g)) offenders.push(page + ': ' + m[0]);
    for (const m of src.matchAll(/minZoom:\s*\d/g)) offenders.push(page + ': ' + m[0]);
  }
  assert.deepEqual(offenders, [], 'hard-coded world view:\n' + offenders.join('\n'));
});

test('a map opens on the whole world and cannot be zoomed out past it', async () => {
  const r = await renderPage('forecasts.html', {
    timeoutMs: 3000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
  });
  const map = mapsOf(r)[0];
  assert.ok(map, 'no map was built');

  const h = map.getSize().y;
  // The Mercator world is square, so it covers a container of height h exactly
  // at this zoom. Below it empty space shows; above it the poles are cut off.
  const expected = Math.log(h / 256) / Math.LN2;
  assert.ok(Math.abs(map.__view.zoom - expected) < 1e-9,
    'opened at zoom ' + map.__view.zoom + ', expected ' + expected);
  // The page builds this array inside the jsdom realm, so compare by value.
  assert.deepEqual(Array.from(map.__view.center), [0, 0],
    'the world view should be centred on the equator');
  assert.ok(Math.abs(map.__minZoom - expected) < 1e-9,
    'the zoom floor does not match the world-fits-the-panel zoom');

  // Fractional zoom is the only way to land on that value exactly.
  assert.equal(map.options.zoomSnap, 0, 'whole-number zoom cannot fit the world to the panel');
  assert.ok(map.__maxBounds, 'nothing stops the reader dragging off the edge of the world');
  r.close();
});

test('the world-fit zoom is derived from the panel, not a constant', () => {
  const src = read('map-setup.js');
  const m = src.match(/function worldZoom\(map\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'worldZoom is missing');
  assert.match(m[0], /getSize\(\)/, 'the zoom must come from the measured container');
  assert.match(m[0], /Math\.log|log2/, 'the zoom must be computed, not looked up');
  // A stale panel size would silently stop tiles being drawn for the new area.
  assert.match(src, /ResizeObserver/, 'nothing re-measures the map when its panel changes size');
  assert.match(src, /invalidateSize/, 'Leaflet is never told to re-measure');
});

test('every map names the places on it', () => {
  // Plain OpenStreetMap raster carries almost no labels at world zoom, so the
  // map was a shape with no names on it.
  const unlabelled = [];
  for (const page of MAP_PAGES) {
    const src = read(page);
    if (/tile\.openstreetmap\.org/.test(src)) { unlabelled.push(page + ': unlabelled street tiles'); continue; }
    const shared = /PNDMap\.basemap\(/.test(src);
    const reference = /World_Boundaries_and_Places|World_Dark_Gray_Reference/.test(src);
    if (!shared && !reference) unlabelled.push(page + ': no label layer');
  }
  assert.deepEqual(unlabelled, [], 'maps with no place names:\n' + unlabelled.join('\n'));
});

test('the shared basemap adds a label layer over its canvas', () => {
  const src = read('map-setup.js');
  assert.match(src, /World_Dark_Gray_Base/, 'no basemap');
  assert.match(src, /World_Dark_Gray_Reference/, 'the canvas has no place-name layer over it');
  assert.match(src, /attribution/, 'tiles are used without crediting the provider');
});

/* --------------------------------------------- one map, used the same way */

test('every map on the site is built the same way', () => {
  // The site had three different maps: plain street tiles on most pages,
  // satellite imagery with labels on two detail pages, and satellite with no
  // labels at all on the homepage. A map should mean the same thing on every
  // page it appears, so they all go through one place.
  const odd = [];
  for (const page of MAP_PAGES) {
    const src = read(page);
    if (!/PNDMap\.basemap\(/.test(src)) odd.push(page + ': does not use the shared basemap');
    // A page reaching for its own tiles is how the three-way split started.
    for (const m of src.matchAll(/L\.tileLayer\('https:[^']*'/g)) odd.push(page + ': builds its own ' + m[0].slice(0, 60));
  }
  assert.deepEqual(odd, [], 'maps that differ from the rest:\n' + odd.join('\n'));
});

test('both views carry place names, and satellite stays available', () => {
  const src = read('map-setup.js');
  assert.match(src, /'Map':/, 'no plain map view offered');
  assert.match(src, /'Satellite':/, 'the satellite view was dropped');
  assert.match(src, /L\.control\.layers/, 'nothing lets the reader switch view');

  // Each base view must be paired with its own label layer: the reference
  // designed for the dark canvas is not the one that reads over imagery.
  const plain = src.match(/var plain = L\.layerGroup\(\[[\s\S]*?\]\)/);
  const sat = src.match(/var satellite = L\.layerGroup\(\[[\s\S]*?\]\)/);
  assert.ok(plain && sat, 'the two views are not both assembled as layer groups');
  assert.match(plain[0], /CANVAS_REF/, 'the map view has no place-name layer');
  assert.match(sat[0], /PLACES/, 'the satellite view has no place-name layer');
  assert.match(sat[0], /IMAGERY/, 'the satellite view has no imagery');
});

test('the label layer sits in its own pane, above the map and below the markers', () => {
  // shadowPane is positioned for marker shadows, not tiles: a tile layer put
  // there draws offset from the map it is labelling.
  const src = read('map-setup.js');
  assert.ok(!/pane:\s*'shadowPane'/.test(src), 'labels are back in shadowPane');
  assert.match(src, /createPane\(LABEL_PANE\)/, 'labels have no pane of their own');
  const zIndex = src.match(/pane\.style\.zIndex = (\d+)/);
  assert.ok(zIndex, 'the label pane has no stacking order');
  const z = Number(zIndex[1]);
  assert.ok(z > 200 && z < 600, 'labels at z-index ' + z + ' are not between the tiles and the markers');
  assert.match(src, /pointerEvents = 'none'/, 'the label layer would swallow marker clicks');
});

test('the view switcher is styled wherever it appears', () => {
  // index.html and dashboard.html carry their own CSS and load neither shared
  // stylesheet, so a rule kept in those sheets left the switcher white on
  // exactly those two pages. It ships with the code that builds the control.
  const src = read('map-setup.js');
  assert.match(src, /\.leaflet-control-layers\{[^}]*background:#/,
    'the switcher keeps Leaflet\'s white default on a dark page');
  assert.match(src, /document\.createElement\('style'\)/, 'the rules are never applied');
  assert.match(src, /getElementById\(STYLE_ID\)/, 'the rules would be injected once per map');

  for (const sheet of ['portal.css', 'app-pages.css']) {
    assert.ok(!/\.leaflet-control-layers\{/.test(read(sheet)),
      sheet + ' still carries a second copy of the switcher styling');
  }
});

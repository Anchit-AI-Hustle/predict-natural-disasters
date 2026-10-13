'use strict';
/**
 * Map interaction.
 *
 * Scroll, pinch, drag, double-click and the +/- control all work on the map;
 * how the wheel and pinch behave is tested in zoom.test.js.
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
    if (src.indexOf('/map-setup.js') < src.indexOf('/vendor/leaflet/leaflet.js')) misordered.push(page);
    // ...and useless after the page has already built its map.
    if (src.indexOf('/map-setup.js') > src.indexOf('L.map(')) misordered.push(page);
  }
  assert.deepEqual(missing, [], 'map pages without the guard: ' + missing.join(', '));
  assert.deepEqual(misordered, [], 'guard loaded at the wrong point in: ' + misordered.join(', '));
});

/** The maps a page built, as recorded by the harness's Leaflet stub. */
const mapsOf = r => r.window.__pndMaps || [];

test('the clear map opens; satellite and political stay one click away', () => {
  /* Satellite opened for a while, and a reader could not make out the map at
     all: the day's picture is mostly cloud, the gaps between the satellite's
     passes are black stripes, and green and orange markers sat on green and
     orange ground. The map now opens on the view that shows the events, and
     keeps the reader's own choice after that. */
  const src = read('map-setup.js');
  assert.match(src, /var start = views\[preferredView\(\)\] \|\| clear;\s*\n\s*start\.addTo\(map\)/,
    'the map does not open on the clear map');
  assert.match(src, /localStorage\.getItem\(VIEW_PREF\) \|\| 'Map'/, 'with no choice made, the clear map is not the default');
  assert.match(src, /map\.on\('baselayerchange', function \(e\) \{ if \(e && e\.name\) rememberView\(e\.name\); \}\)/,
    'the reader’s choice of view is not kept');
  assert.match(src, /var choices = \{ 'Map': clear \};/, 'the clear map is not offered in the control');
  assert.match(src, /choices\['Satellite'\] = views\['Satellite'\];/, 'the satellite view is no longer offered');
  assert.match(src, /choices\['Political'\] = plain;/, 'the political world is no longer offered');
  /* Open where there is room, so the other views can be found at all. */
  assert.match(src, /L\.control\.layers\(choices, daily \? extras : null, \{ position: 'topright', collapsed: !roomy \}\)/);
  /* The satellite view keeps its drawn floor for tiles a network refuses. */
  assert.match(src, /political\(map, false\)/,
    'the imagery has no drawn world underneath it to fall back to');
  assert.match(src, /imagery\.on\('tileerror'[^)]*\)/,
    'nothing notices when the imagery does not arrive');
  assert.match(src, /under\.showNames\(\)/,
    'the fallback world stays unlabelled when the imagery fails');
});

test('the clear map leaves colour to the markers, and every marker stands off it', () => {
  const src = read('map-setup.js');
  const clear = src.match(/var CLEAR = \{ ocean: '(#[0-9a-f]{6})', land: function \(\) \{ return '(#[0-9a-f]{6})'; \},\s*border: '(#[0-9a-f]{6})'/);
  assert.ok(clear, 'the clear map’s colours are not where this test reads them');
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const [ocean, land, border] = clear.slice(1);
  /* Near-neutral: no hue the risk scale could be mistaken for. */
  for (const c of [ocean, land, border]) {
    const v = rgb(c);
    assert.ok(Math.max(...v) - Math.min(...v) <= 40, c + ' is coloured enough to compete with the markers');
  }
  assert.ok(ratio(land, ocean) >= 1.15, 'land and sea are not told apart');
  assert.ok(ratio(border, land) >= 2, 'borders vanish into the land');
  /* WCAG 1.4.11: a mark needs 3:1 against what is next to it. Severe and
     Extreme are dark, so it is the halo round every mark that must clear it. */
  const css = read('risk.css');
  assert.match(css, /\.risk-mk,\.pnd-key-mark\{filter:drop-shadow\(0 0 1px rgba\(255,255,255,\.95\)\)/,
    'markers have no light halo, so the darkest levels sink into the dark map');
  for (const ground of [land, ocean]) {
    assert.ok(ratio('#ffffff', ground) >= 3, 'the halo does not stand off ' + ground);
  }
  /* And the names are readable on it. */
  assert.match(src, /\.pnd-country\.pnd-country-clear\{color:(#[0-9a-f]{6})/);
  const name = src.match(/\.pnd-country\.pnd-country-clear\{color:(#[0-9a-f]{6})/)[1];
  assert.ok(ratio(name, land) >= 4.5 && ratio(name, ocean) >= 4.5, 'country names are too faint on the clear map');
});

test('the map carries a key to its marks, counted from what is drawn', async () => {
  const r = await renderPage('live-map.html', {
    waitFor: d => d.querySelectorAll('.pnd-key li').length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const key = r.document.querySelector('#map .pnd-key');
  assert.ok(key, 'the live map has no key');
  assert.equal(key.hidden, false, 'the key is hidden on a map full of events');
  const rows = [...key.querySelectorAll('li')].map(li => ({
    name: li.querySelector('.pnd-key-name').textContent,
    n: Number(li.querySelector('.pnd-key-n').textContent),
    shape: li.querySelector('.pnd-key-mark').className }));
  /* Counted from the markers on the map, level by level. */
  const drawn = {};
  r.window.__pndMaps[0].eachLayer(l => { if (l.options && l.options.pndLevel) drawn[l.options.pndLevel] = (drawn[l.options.pndLevel] || 0) + 1; });
  const R = r.window.PNDRisk;
  const byLabel = Object.fromEntries(R.LEVELS.concat([R.UNKNOWN]).map(l => [l.label, l.key]));
  for (const row of rows) {
    assert.equal(row.n, drawn[byLabel[row.name]], row.name + ' is counted differently from what is drawn');
    assert.match(row.shape, new RegExp('risk-' + byLabel[row.name].toLowerCase()), row.name + ' is shown in another level’s shape');
  }
  assert.equal(rows.length, Object.keys(drawn).length, 'the key lists levels that are not on the map, or misses some that are');
  /* Most serious first. */
  const ranks = rows.map(row => (R.BY_KEY[byLabel[row.name]] || { rank: 0 }).rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a), 'the key is not ordered from the most serious level');
  /* It says what a mark is, not only what the colours are. */
  assert.match(key.textContent, /Each mark is one reported event/);
  /* A toggle a keyboard can reach, that says whether it is open. */
  const btn = key.querySelector('button.pnd-key-toggle');
  assert.ok(btn && /^(true|false)$/.test(btn.getAttribute('aria-expanded')), 'the key cannot be opened and closed');
  /* Its swatches are not markers: nothing that counts markers may count them. */
  assert.equal(key.querySelectorAll('.risk-mk').length, 0, 'the key’s swatches carry the marker class');
  r.close();
});

test('the more serious event is drawn on top', () => {
  /* Leaflet stacks markers by latitude, so a cluster of low-level records to
     the south buried the one that mattered. */
  const src = read('map-setup.js');
  assert.match(src, /zIndexOffset: \(R\.level\(value\)\.rank \|\| 0\) \* 1000,/, 'markers are stacked by latitude, not by risk');
  assert.match(src, /pndLevel: icon\.level,/, 'the marker does not carry the level the key counts');
});

test('the view toggle does not sit on the zoom control', () => {
  /* Measured at 1280x900 before this: the toggle was at (27,357) 109x31 with
     z-index 1300 and the zoom-in button at (29,359) 30x30, so elementFromPoint
     over BOTH zoom buttons returned the toggle - the zoom control was
     unclickable on every map in the site. jsdom cannot see that, so what is
     held here is the rule that produced it; tools/map-controls-check.js does
     the measuring. */
  const src = read('map-setup.js');
  const rule = (src.match(/'\.pnd-view-toggle\{position:absolute;top:(\d+)px;left:(\d+)px;/) || []);
  assert.ok(rule[1], 'the view toggle no longer states where it sits');
  const top = Number(rule[1]);
  /* Leaflet's zoom control is two 30px buttons with a border, at top:10px. */
  assert.ok(top >= 10 + 62, 'the view toggle is back on top of the zoom control (top:' + top + 'px)');
});

test('the guard leaves dragging, pinch and the zoom control alone', () => {
  const src = read('map-setup.js');
  for (const option of ['dragging', 'touchZoom', 'doubleClickZoom', 'zoomControl', 'boxZoom', 'keyboard']) {
    assert.ok(!new RegExp(option + '\\s*[:=]').test(src),
      'the guard should not touch ' + option + ' — Leaflet already enables it');
  }
  assert.match(src, /scrollWheelZoom/, 'the guard does not touch the wheel at all');
});

test('the map is reachable by keyboard, so it can be zoomed without a mouse', async () => {
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

  const w = map.getSize().x;
  // One world spans a container of width w exactly at this zoom. Fitting the
  // height instead left the world a quarter of the width in a wide panel, so
  // it tiled sideways and the page showed three Americas.
  const expected = Math.log(w / 256) / Math.LN2;
  assert.ok(Math.abs(map.__view.zoom - expected) < 1e-9,
    'opened at zoom ' + map.__view.zoom + ', expected ' + expected);
  // The page builds this array inside the jsdom realm, so compare by value.
  // Land sits north of the equator, so the frame is centred there rather than
  // spending half its height on empty Southern Ocean.
  assert.deepEqual(Array.from(map.__view.center), [20, 0],
    'the world view is not framed where the land is');
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

test('the country outlines are present, coloured and credited', () => {
  const src = read('map-setup.js');
  assert.match(src, /Natural Earth/, 'the outline source is not credited');
  assert.match(src, /attribution/, 'tiles are used without crediting the provider');

  const geo = JSON.parse(read('world-countries.json'));
  assert.equal(geo.type, 'FeatureCollection');
  assert.ok(geo.features.length > 150, 'only ' + geo.features.length + ' countries');
  assert.ok(geo.features.every(f => f.properties && f.properties.n && Number.isInteger(f.properties.c)),
    'a country is missing its name or its colour');

  // A ring that crosses the date line and is drawn as-is sweeps the long way
  // round the globe and paints a band across the map. Antarctica genuinely
  // spans every longitude; nothing else may.
  const wide = [];
  for (const f of geo.features) {
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        const xs = ring.map(p => p[0]);
        if (Math.max(...xs) - Math.min(...xs) > 180) wide.push(f.properties.n);
      }
    }
  }
  assert.deepEqual([...new Set(wide)], ['Antarctica'],
    'rings cross the date line unsplit: ' + [...new Set(wide)].join(', '));
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
  assert.match(src, /'Political'/, 'no political world map offered');
  assert.match(src, /'Satellite'/, 'the satellite view was dropped');
  assert.match(src, /L\.control\.layers/, 'nothing lets the reader switch view');

  // No raster provider renders a political map, so the default view is drawn
  // from outlines the app serves itself -- which also cannot arrive blank the
  // way a tile layer can.
  assert.match(src, /world-countries\.json/, 'the political layer has no country outlines');
  assert.match(src, /PALETTE/, 'countries are not coloured');
  assert.match(src, /pnd-country/, 'countries are not named');
  assert.ok(!/World_Dark_Gray_Reference/.test(src),
    'the map is back on the label layer that is blank at world zoom');

  // Satellite is imagery plus its own place names; it must never be bare.
  const sat = src.match(/views\['Satellite'\] = L\.layerGroup\(\[[\s\S]*?\]\)/);
  assert.ok(sat, 'the satellite view is not assembled as a layer group');
  assert.match(sat[0], /\bimagery\b/, 'the satellite view has no imagery');
  assert.match(sat[0], /PLACES/, 'the satellite view has no place-name layer');
  /* The imagery layer is built just above the group so a tileerror on it can
     bring the fallback world's names back; it still has to be the imagery. */
  assert.match(src, /imagery = L\.tileLayer\(IMAGERY,/,
    'the satellite view is no longer built from the world imagery tiles');
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
  // Country polygons draw in the overlay pane at 400, so labels must clear
  // that too, not just the tile pane at 200.
  assert.ok(z > 400 && z < 600,
    'labels at z-index ' + z + ' are not above the country polygons and below the markers');
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

test('one world across the frame, not a repeating strip of them', () => {
  // Fitting the world's height in a panel four times wider than tall left it a
  // quarter of the width, so it tiled sideways: the live homepage showed three
  // Americas. Tiles do not wrap and the frame is sized like a map.
  const src = read('map-setup.js');
  assert.match(src, /noWrap: true/, 'tiles still repeat sideways');
  assert.match(src, /opts\.worldCopyJump = false/, 'copies of the world are still jumped to');
  assert.match(src, /size\.x/, 'the fit is not derived from the width');
  assert.ok(!/size\.y/.test(src.match(/function worldZoom[\s\S]*?\n  \}/)[0]),
    'the fit still measures the height');

  const sized = [];
  for (const page of MAP_PAGES) {
    const html = read(page);
    const rules = [...html.matchAll(/(?:#(?:map|leafletMap)|\.map|\.mapTall)\{[^}]*\}/g)].map(m => m[0]);
    for (const r of rules) {
      if (/height:\s*\d+px/.test(r) && !/min-height|max-height/.test(r)) sized.push(page + ': ' + r);
    }
    const inline = html.match(/id="(?:map|leafletMap)"[^>]*style="([^"]*)"/);
    if (inline && /height:\s*\d+px/.test(inline[1]) && !/aspect-ratio/.test(inline[1])) sized.push(page + ': inline ' + inline[1]);
  }
  assert.deepEqual(sized, [], 'maps still pinned to a fixed height:\n' + sized.join('\n'));
});

test('the reader can still drag and zoom', () => {
  // Leaflet enables dragging, the zoom control, double-click and pinch by
  // default; the shared setup must not quietly take any of them away.
  const src = read('map-setup.js');
  for (const option of ['dragging', 'doubleClickZoom', 'zoomControl', 'touchZoom', 'boxZoom', 'keyboard']) {
    assert.ok(!new RegExp('\\b' + option + '\\s*[:=]').test(src),
      option + ' is being overridden — Leaflet already enables it');
  }
  // Rigid bounds make a drag feel like the map has seized up at the edge.
  const v = src.match(/maxBoundsViscosity = ([\d.]+)/);
  assert.ok(v && Number(v[1]) < 1, 'the world edge is rigid rather than springy');
});

test('the political layer draws countries, not an empty ocean', async () => {
  // The previous basemap passed every structural check -- the layer existed,
  // tiles arrived, panes lined up -- and still rendered nothing, because the
  // tiles themselves were blank at world zoom. That is only catchable by
  // asking what actually got drawn, so this test does.
  const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return {}; } })();
  if (!chromium) { console.log('# playwright-core unavailable; skipping render check'); return; }

  const geo = JSON.parse(read('world-countries.json'));
  const palette = read('map-setup.js').match(/var PALETTE = \[([^\]]+)\]/)[1]
    .split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(palette.length >= 5, 'the palette is too small to separate neighbours');

  // Every country must get a colour the stylesheet can actually produce.
  const used = new Set(geo.features.map(f => f.properties.c % palette.length));
  assert.ok(used.size >= 4, 'only ' + used.size + ' colours in use across the world');

  // And no two countries sharing a border may share one. Adjacency is derived
  // the same way the build derives it: a shared boundary vertex.
  const owners = new Map();
  geo.features.forEach((f, i) => {
    for (const poly of f.geometry.coordinates) for (const ring of poly) for (const p of ring) {
      const k = p[0] + ',' + p[1];
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(i);
    }
  });
  let clashes = 0;
  for (const set of owners.values()) {
    if (set.size < 2) continue;
    const ids = [...set];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      if (geo.features[ids[a]].properties.c === geo.features[ids[b]].properties.c) clashes++;
    }
  }
  assert.equal(clashes, 0, clashes + ' bordering country pairs share a colour');
});

/* ------------------------------------ the picture is today's, and says so */

test('the satellite view is one seamless mosaic, and NASA’s photo of the day is one switch away', async () => {
  /* NASA's daily photo used to fill every zoom up to 9 with Esri's mosaic
     after it, and a slow or refused NASA tile let the drawn map show through:
     the view read as a patchwork of squares, and not at all like the
     god's-eye-view globe it is adapted from, which opens on the mosaic. */
  const r = await renderPage('live-map.html', { timeoutMs: 4000 });
  const M = r.window.PNDMap;
  assert.equal(typeof M.dailyImagery, 'function', 'the daily picture is not defined');

  /* The latest UTC day that ended at least DAILY_SETTLE_HOURS ago. Today's
     picture is still being assembled and its unimaged half comes back opaque
     black. */
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).day, '2026-09-22');
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T02:00:00Z')).day, '2026-09-21',
    'before NASA has processed the last passes, the day before is not yet complete');
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).label, '22 Sep 2026');
  const u = M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).url;
  assert.equal(u, 'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/' +
    'VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-09-22/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg');
  assert.match(u, /VIIRS/, 'the daily picture is back on an instrument whose swaths do not close a day');
  assert.equal(M.DAILY_MAX_ZOOM, 9, 'the daily picture is asked for past the zoom it exists at');
  assert.equal(typeof M.dailyWanted, 'function', 'the reader’s choice of NASA’s photo is not shared with the globe');
  r.close();

  const src = read('map-setup.js');
  const sat = src.match(/views\['Satellite'\] = L\.layerGroup\(\[[\s\S]*?\]\)/);
  assert.doesNotMatch(sat[0], /\bdaily\b/, 'the daily photo is back inside the satellite view, patching it');
  assert.match(src, /imagery = L\.tileLayer\(IMAGERY, \{ attribution: ESRI_CREDIT, maxZoom: 18, noWrap: true \}\)/,
    'the mosaic no longer covers every zoom');
  assert.match(src, /maxZoom: DAILY_MAX_ZOOM,\s*\n?\s*maxNativeZoom: DAILY_MAX_ZOOM/,
    'the daily layer is not capped at the zoom it exists at');
  assert.match(src, /extras\['NASA today \(' \+ latest\.label \+ '\)'\] = daily;/, 'NASA’s photo is not offered as its own layer');
  assert.match(src, /var DAILY_PREF = 'pnd_nasa_today';/, 'the choice is not remembered');
});

test('the caption never lets an old picture pass for the scene now', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 4000 });
  const M = r.window.PNDMap;
  const latest = M.dailyImagery(Date.parse('2026-09-23T10:30:00Z'));
  assert.match(M.imageryText('mosaic', latest), /not a live picture of today/,
    'the mosaic can read as the scene now');
  assert.match(M.imageryText('daily', latest), /NASA’s photo of 22 Sep 2026/);
  assert.match(M.imageryText('daily', latest), /Clouds are part of the picture/,
    'the daily caption does not warn that a satellite photographs cloud tops');
  assert.match(M.imageryText('fallback', latest), /did not load/);
  assert.match(M.imageryText('fallback', latest), /NASA’s photo of 22 Sep 2026/);
  /* Both hosts refused: what is left is the drawn world, and the caption must
     not describe a photograph that is not there. */
  assert.match(M.imageryText('drawn', latest), /drawn map/);
  assert.doesNotMatch(M.imageryText('drawn', latest), /mosaic|NASA/);
  for (const s of ['mosaic', 'daily', 'fallback', 'drawn']) {
    assert.doesNotMatch(M.imageryText(s, latest), /Black stripes/, 'the caption still describes stripes');
  }
  r.close();

  const src = read('map-setup.js');
  assert.match(src, /imageryNote\(map, views\['Satellite'\]/, 'nothing puts the caption on the map');
  assert.match(src, /if \(state\.failed\) return dayShown \? 'fallback' : 'drawn';/,
    'a double failure is still captioned as a photograph');
  /* Built last, in its own try: a caption fault must not take the map with it. */
  assert.match(src, /try \{ imageryNote\(map, views\['Satellite'\], daily, latest, under, imagery\); \} catch \(e\)/);
});

test('the globe - the view readers open on - carries the same two pictures', () => {
  const src = read('globe.js');
  assert.match(src, /var DAILY_ABOVE_M = 250000;/, 'the globe has no height at which the pictures swap');
  /* The mosaic's provider goes in too: it is watched for failure like NASA's,
     so a globe with neither photograph says the painted map is showing. */
  assert.match(src, /function todaysEarth\(Cesium, satLayer, satProvider\)/, 'the globe does not drape the daily picture');
  assert.match(src, /todaysEarth\(Cesium, satLayer, sat\)/, 'the mosaic is named without being watched');
  assert.match(src, /dayLayer\.show = useDay;[\s\S]{0,80}satLayer\.show = !useDay;/,
    'the two pictures are drawn together rather than swapped, fetching both');
  assert.match(src, /'pnd-imagery'/, 'the globe does not report which picture it is showing');
});

test('the drawn world under the imagery is drawn under it', () => {
  /* It was drawn over it. The floor is vector shapes - an opaque ocean and an
     opaque polygon per country - and Leaflet puts vector shapes in its overlay
     pane at z-index 400, above every tile at 200. From the day Satellite
     became the default, the flat map's Satellite view showed the political
     map; the imagery was requested and never seen. Every check asked which
     tiles were requested, and none asked what reached the screen -
     tools/imagery-check.js now does, by colour. */
  const src = read('map-setup.js');
  const z = src.match(/pane\.style\.zIndex = (\d+);\s*\/\/ below the tile pane \(200\)/);
  assert.ok(z, 'the floor has no pane of its own');
  assert.ok(Number(z[1]) < 200, 'the floor pane is not below the tiles: ' + z[1]);
  assert.match(src, /var floor = withNames \? undefined : underPane\(map\);/,
    'the floor under the imagery is not put in that pane');
  assert.match(src, /L\.rectangle\(WORLD, Object\.assign\(\{[^}]*\}, *\n?\s*floor \? \{ pane: floor \} : \{\}\)\)/,
    'the ocean is still drawn in the overlay pane, over the imagery');
  assert.match(src, /\}, floor \? \{ pane: floor \} : \{\}\)\)\.addTo\(group\);/,
    'the countries are still drawn in the overlay pane, over the imagery');
});

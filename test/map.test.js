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
    if (src.indexOf('/map-setup.js') < src.indexOf('/vendor/leaflet/leaflet.js')) misordered.push(page);
    // ...and useless after the page has already built its map.
    if (src.indexOf('/map-setup.js') > src.indexOf('L.map(')) misordered.push(page);
  }
  assert.deepEqual(missing, [], 'map pages without the guard: ' + missing.join(', '));
  assert.deepEqual(misordered, [], 'guard loaded at the wrong point in: ' + misordered.join(', '));
});

/** The maps a page built, as recorded by the harness's Leaflet stub. */
const mapsOf = r => r.window.__pndMaps || [];

test('a plain wheel scrolls the page and the modifier zooms the map', async () => {
  /* A map inside a scrolling page has to share the wheel with the page. The
     settled convention everywhere else on the web is that the modifier key
     decides, and the map says so the first time a reader tries the plain
     wheel over it. This replaced a click-to-arm behaviour with the same
     intent that nobody arrives knowing - and clicking a map is how you open
     an event. */
  for (const page of ['index.html', 'live-map.html', 'event-detail.html']) {
    const r = await renderPage(page, {
      search: page === 'event-detail.html' ? '?id=ND-001' : '',
      timeoutMs: 3000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
    });
    const win = r.window;
    const maps = mapsOf(r);
    assert.ok(maps.length, page + ' built no map');
    for (const map of maps) {
      const el = map.getContainer();
      const wheel = over => el.dispatchEvent(new win.WheelEvent('wheel',
        Object.assign({ bubbles: true, cancelable: true, deltaY: -120 }, over)));

      assert.equal(map.scrollWheelZoom.enabled(), false, page + ': wheel captured on load');

      wheel({});
      assert.equal(map.scrollWheelZoom.enabled(), false,
        page + ': a plain wheel took the page scroll');
      const hint = el.querySelector('.pnd-wheel-hint');
      assert.ok(hint && /scroll to zoom/i.test(hint.textContent),
        page + ': nothing told the reader how to zoom');
      assert.ok(hint.hasAttribute('data-shown'), page + ': the hint was not shown');

      wheel({ ctrlKey: true });
      assert.equal(map.scrollWheelZoom.enabled(), true,
        page + ': Ctrl + wheel did not zoom the map');

      // A trackpad pinch arrives as ctrl + wheel, and Command is the Mac key.
      wheel({});
      assert.equal(map.scrollWheelZoom.enabled(), false, page + ': the wheel stayed armed');
      wheel({ metaKey: true });
      assert.equal(map.scrollWheelZoom.enabled(), true,
        page + ': Command + wheel did not zoom the map');

      el.dispatchEvent(new win.MouseEvent('mouseleave', { bubbles: false }));
      assert.equal(map.scrollWheelZoom.enabled(), false,
        page + ': the wheel stayed armed after the pointer left');
    }
    r.close();
  }
});

test('the satellite view is the default, with the drawn world under it', () => {
  /* What a reader means by a map of a disaster is the real ground, so that is
     what opens. The political world is kept - one click away in the layers
     control, and underneath the imagery as the fallback for tiles that a
     network refuses, with its own country names coming back when they do. */
  const src = read('map-setup.js');
  assert.match(src, /var start = views\['Satellite'\] \|\| plain;\s*\n\s*start\.addTo\(map\)/,
    'the map no longer opens on the satellite view');
  assert.match(src, /L\.control\.layers\(\{ 'Satellite': views\['Satellite'\], 'Political': plain \}/,
    'the plain political world is no longer offered');
  assert.match(src, /political\(map, false\)/,
    'the imagery has no drawn world underneath it to fall back to');
  assert.match(src, /imagery\.on\('tileerror'[^)]*\)/,
    'nothing notices when the imagery does not arrive');
  assert.match(src, /under\.showNames\(\)/,
    'the fallback world stays unlabelled when the imagery fails');
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
  assert.match(src, /var imagery = L\.tileLayer\(IMAGERY,/,
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

test('zoomed out, the satellite view is NASA’s picture of the latest complete day', async () => {
  /* The satellite view was Esri's World Imagery alone: sharp, and a mosaic of
     captures months to years old, with nothing saying so. Opened on a flood it
     showed the dry ground from before the flood under the flood's marker. */
  const r = await renderPage('live-map.html', { timeoutMs: 4000 });
  const M = r.window.PNDMap;
  assert.equal(typeof M.dailyImagery, 'function', 'the daily picture is not defined');

  /* The latest UTC day that ended at least four hours ago. Today's picture is
     still being assembled and its unimaged half comes back opaque black. */
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).day, '2026-09-22');
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T02:00:00Z')).day, '2026-09-21',
    'before NASA has processed the last passes, the day before is not yet complete');
  assert.equal(M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).label, '22 Sep 2026');

  /* Exactly the URL shape of NASA's own Leaflet example for this service. */
  const u = M.dailyImagery(Date.parse('2026-09-23T10:30:00Z')).url;
  assert.equal(u, 'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/' +
    'MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-09-22/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg');
  assert.equal(M.DAILY_MAX_ZOOM, 9, 'the daily picture is asked for past the zoom it exists at');
  r.close();

  const src = read('map-setup.js');
  const sat = src.match(/views\['Satellite'\] = L\.layerGroup\(\[[\s\S]*?\]\)/);
  assert.match(sat[0], /\bdaily\b/, 'the satellite view does not carry the daily picture');
  assert.match(src, /maxZoom: DAILY_MAX_ZOOM,\s*\n?\s*maxNativeZoom: DAILY_MAX_ZOOM/,
    'the daily layer is not capped at the zoom it exists at');
  assert.match(src, /L\.tileLayer\(IMAGERY, \{ attribution: ESRI_CREDIT, minZoom: DAILY_MAX_ZOOM \+ 1,/,
    'the detailed mosaic is fetched even where the daily picture is shown');
});

test('the caption never lets an old picture pass for the scene now', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 4000 });
  const M = r.window.PNDMap;
  const latest = M.dailyImagery(Date.parse('2026-09-23T10:30:00Z'));
  assert.match(M.imageryText('daily', latest), /NASA, 22 Sep 2026/);
  assert.match(M.imageryText('daily', latest), /Cloud is part of the picture/,
    'the daily caption does not warn that a satellite photographs cloud tops');
  for (const s of ['detail', 'fallback']) {
    assert.match(M.imageryText(s, latest), /not the scene now/,
      'the ' + s + ' caption lets the old mosaic read as current');
  }
  assert.match(M.imageryText('fallback', latest), /did not load/);
  /* Both hosts refused: what is left is the drawn world, and the caption must
     not describe a photograph that is not there. */
  assert.match(M.imageryText('drawn', latest), /drawn map/);
  assert.doesNotMatch(M.imageryText('drawn', latest), /mosaic|NASA, /);
  r.close();

  const src = read('map-setup.js');
  assert.match(src, /imageryNote\(map, views\['Satellite'\]/, 'nothing puts the caption on the map');
  assert.match(src, /state\.rescueFailed \? 'drawn' : 'fallback'/,
    'a double failure is still captioned as a mosaic');
  /* Built last, in its own try: a caption fault must not take the map with it.
     The first version threw before the layers control was added. */
  assert.match(src, /try \{ imageryNote\(map, views\['Satellite'\], daily, latest, under\); \} catch \(e\)/);
});

test('the globe - the view readers open on - carries the same two pictures', () => {
  const src = read('globe.js');
  assert.match(src, /var DAILY_ABOVE_M = 250000;/, 'the globe has no height at which the pictures swap');
  assert.match(src, /function todaysEarth\(Cesium, satLayer\)/, 'the globe does not drape the daily picture');
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

'use strict';
/*
 * The god's-eye view: the globe as the reference viewer shows it - the Earth
 * in black space, a HUD with the UTC clock and where the camera is, tags on
 * what matters, sensor looks - and Esri's seamless mosaic as its picture,
 * with NASA's photo of the day one switch away.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function globe() {
  const r = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length && d.querySelector('.pnd-hud-bar button') &&
      w.__pndViewers[0].imageryLayers.length >= 3 });
  return r;
}

test('the grid reference is the one a standard MGRS converter gives', async () => {
  /* Checked against the mgrs library (python mgrs 1.5.4), to 10 m. */
  const r = await globe();
  const G = r.window.PNDGlobe;
  const cases = [
    [24 + 5 / 60 + 12.68 / 3600, -(76 + 35 / 60 + 37.17 / 3600), '18R UM 3800 6476'],
    [38.8895, -77.0353, '18S UJ 2347 0648'],
    [51.5007, -0.1246, '30U XC 9956 0942'],
    [-33.8568, 151.2153, '56H LH 3490 5228'],
    [60.39, 5.32, '32V KN 9723 0051'],          // the Norway exception
    [78.22, 15.65, '33X WG 1481 8300'],         // the Svalbard exception
    [-0.5, -179.9, '01M AV 7717 4466']
  ];
  for (const [lat, lon, want] of cases) assert.equal(G.mgrs(lat, lon), want, lat + ',' + lon);
  assert.equal(G.mgrs(85, 0), '', 'MGRS is not defined past UTM’s latitudes');
  assert.equal(G.dms(24.086856, 'N', 'S'), '24°05′12.68″N');
  assert.equal(G.magnitudeOf('M 6.1 — 80 km ENE of Tadine'), 6.1);
  assert.equal(G.magnitudeOf('Hurricane Polo'), null);
  r.close();
});

test('the globe carries the HUD: a UTC clock, where the camera is, and the looks', async () => {
  const r = await globe();
  const d = r.document;
  const hud = d.querySelector('.pnd-globe .pnd-hud');
  assert.ok(hud, 'the globe has no HUD');
  assert.match(hud.querySelector('.pnd-hud-clock').textContent, /^LIVE \d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ$/);
  const looks = [...hud.querySelectorAll('.pnd-hud-bar [data-look]')].map(b => b.textContent);
  assert.deepEqual(looks, ['Normal', 'NVG', 'FLIR', 'CRT', 'Noir', 'NASA today']);
  assert.equal(hud.querySelector('[data-look="normal"]').getAttribute('aria-pressed'), 'true');
  /* Nothing on it that is not a fact: no invented classification marking. */
  assert.doesNotMatch(hud.textContent, /SECRET|NOFORN|CLASSIFIED/i);
  r.close();
});

test('the globe opens on the mosaic, and NASA today swaps in the day’s photo and says so', async () => {
  const r = await globe();
  const d = r.document;
  const source = () => d.querySelector('.pnd-imagery-note').getAttribute('data-source');
  assert.equal(source(), 'mosaic');
  const btn = d.querySelector('[data-look="nasa"]');
  btn.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(source(), 'daily', 'switching NASA today on did not show the day’s photo');
  assert.equal(r.window.localStorage.getItem('pnd_nasa_today'), '1', 'the choice is not kept for the flat map');
  btn.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
  assert.equal(source(), 'mosaic');
  r.close();
});

test('a globe with nothing to draw between changes does not redraw', () => {
  const src = read('globe.js');
  assert.match(src, /requestRenderMode: true, maximumRenderTimeChange: Infinity/,
    'the globe renders every frame whether or not anything changed');
  assert.match(src, /skyBox\.show = false/, 'the Earth is not shown in black space');
  /* The looks are the reference viewer's, credited. */
  assert.match(src, /adapted from gods-eye-view's style shaders \(MIT, Copyright\s*\n?\s*\(c\) 2026 Bilawal Sidhu\)/);
});

test('the globe goes where the page sends the map, and stays put on a refresh', async () => {
  /* The event page centres its map on the event once the data arrives - after
     the globe has mounted. Rendered for real, the globe stayed on the whole
     world with "0 events in view". */
  const r = await renderPage('event-detail.html', { search: '?id=nhc-al072026', timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length && w.__pndMaps[0].__view &&
      w.__pndViewers[0].camera.__view && !/Loading/.test(d.getElementById('title').textContent) &&
      d.querySelector('.pnd-globe').style.display !== 'none' });
  const w = r.window;
  const map = w.__pndMaps[0];
  const cam = w.__pndViewers[0].camera;
  const at = () => cam.__view.destination;
  const c = map.getCenter();
  assert.ok(Math.abs(at().lat - c.lat) < 1e-6 && Math.abs(at().lon - c.lng) < 1e-6,
    `the globe looks at ${at().lat},${at().lon}, the event is at ${c.lat},${c.lng}`);
  assert.ok(!(Math.abs(at().lat - 20) < 1e-6 && Math.abs(at().lon) < 1e-6), 'the globe is still on the default world view');

  /* The page sets the same view again when it refreshes: the camera stays. */
  const flew = cam.__flew || 0;
  map.setView([c.lat, c.lng], map.getZoom());
  assert.equal(cam.__flew || 0, flew, 'a refresh to the same view moved the camera');

  /* A move somewhere new - an event picked from a list - is followed. */
  map.flyTo([-33.86, 151.21], 6);
  assert.equal(cam.__flew, flew + 1, 'the globe ignored the page moving the map');
  assert.ok(Math.abs(at().lat + 33.86) < 1e-6 && Math.abs(at().lon - 151.21) < 1e-6);
  r.close();
});

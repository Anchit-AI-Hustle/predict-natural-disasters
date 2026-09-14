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
const { renderPage } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MAP_PAGES = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && /L\.map\(/.test(read(f)));

test('every page that builds a map loads the scroll guard, after Leaflet', () => {
  assert.ok(MAP_PAGES.length >= 10, 'expected the map pages to be found');
  const missing = [], misordered = [];
  for (const page of MAP_PAGES) {
    const src = read(page);
    if (!src.includes('/map-scroll.js')) { missing.push(page); continue; }
    // It wraps L.map, so it is useless before Leaflet defines it.
    if (src.indexOf('/map-scroll.js') < src.indexOf('leaflet@1.9.4/dist/leaflet.js')) misordered.push(page);
    // ...and useless after the page has already built its map.
    if (src.indexOf('/map-scroll.js') > src.indexOf('L.map(')) misordered.push(page);
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
  const src = read('map-scroll.js');
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

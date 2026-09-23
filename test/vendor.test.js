'use strict';
/*
 * Nothing this site needs to render comes from somewhere else.
 *
 * Every map page loaded the map library from unpkg.com, and every one of
 * those pages begins `const map = L.map('map')`. Measured in Chromium with
 * that origin unreachable, /alerts rendered 5 of its 25 records and sat on
 * "Loading…" for ever: the first statement threw, so the feed request, the
 * list and the filters never ran. A page about the hazard nearest to you went
 * blank because a third party was down.
 *
 * The library is served from this origin now, and a library that still fails
 * to arrive is survivable rather than fatal. These tests hold both.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('no page fetches a script or stylesheet from another origin', () => {
  const offenders = [];
  for (const f of pages) {
    const html = read(f);
    for (const m of html.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]+"/g)) offenders.push(f + ': ' + m[0]);
    for (const m of html.matchAll(/<link[^>]+href="(https?:)?\/\/[^"]+"[^>]*>/g)) {
      if (/rel="(stylesheet|preload|modulepreload)"/.test(m[0])) offenders.push(f + ': ' + m[0]);
    }
  }
  assert.deepEqual(offenders, [],
    'a page depends on another origin to render:\n  ' + offenders.join('\n  '));
});

test('every page that uses the map library serves it from here', () => {
  for (const f of pages) {
    const html = read(f);
    if (!/\bL\.map\(/.test(html)) continue;
    assert.match(html, /<script src="\/vendor\/leaflet\/leaflet\.js"><\/script>/,
      f + ' uses the map library without serving it from this origin');
    assert.match(html, /href="\/vendor\/leaflet\/leaflet\.css"/,
      f + ' loads the map library without its stylesheet');
    /* Order matters twice over: the library first, then map-setup.js, which
       stands in for it when it did not arrive, and only then the page's own
       script, which calls L.map on its first line. */
    const lib = html.indexOf('/vendor/leaflet/leaflet.js');
    const setup = html.indexOf('/map-setup.js');
    const use = html.indexOf('L.map(');
    assert.ok(setup > lib, f + ' loads map-setup.js before the map library');
    assert.ok(use > setup, f + ' calls L.map before map-setup.js has had a chance to stand in');
  }
});

test('the vendored library is the file its own README says it is', () => {
  const dir = path.join(ROOT, 'vendor', 'leaflet');
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const claimed = [...readme.matchAll(/^sha256\s+([0-9a-f]{64})\s+(\S+)$/gm)]
    .map(m => ({ hash: m[1], file: m[2] }));
  assert.ok(claimed.length >= 2, 'the vendored library records no checksums to check against');
  for (const c of claimed) {
    const p = path.join(dir, c.file);
    assert.ok(fs.existsSync(p), 'the README lists a file that is not here: ' + c.file);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.equal(actual, c.hash,
      c.file + ' does not match the checksum recorded for it; the vendored copy has been changed');
  }
  /* The upstream licence requires the notice to survive, and the version has
     to be checkable against what the README claims. */
  const js = fs.readFileSync(path.join(dir, 'leaflet.js'), 'utf8').slice(0, 400);
  assert.match(js, /Leaflet 1\.9\.4/, 'the vendored library is not the version recorded');
  assert.match(js, /@preserve|\(c\) 2010-2023/, 'the upstream copyright notice has been stripped');
  assert.ok(fs.existsSync(path.join(dir, 'LICENSE')), 'the upstream licence is not kept');
  assert.match(readme, /registry\.npmjs\.org\/leaflet/, 'the README does not say where the files came from');
});

test('a map library that never arrives is survivable, and says so', () => {
  /* The stand-in has to answer every call these pages make, including the
     two-level ones, and hand itself back down a chain. Anything it drops
     throws, and a thrown error here is the whole page again. */
  const marked = [];
  const el = () => ({ _attrs: {}, style: {},
    setAttribute(k, v) { this._attrs[k] = v; if (k === 'data-map-unavailable') marked.push(this); },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    textContent: '' });
  const container = el();
  const w = { document: { getElementById: () => container } };
  global.window = w; global.document = w.document;
  delete require.cache[require.resolve('../map-setup.js')];
  require('../map-setup.js');
  const L = w.L;
  assert.ok(L && L.__pndStandIn, 'nothing stood in for the missing map library');

  const map = L.map('map');
  const layer = L.layerGroup().addTo(map);
  layer.clearLayers();
  L.circleMarker([1, 2], { radius: 3 }).addTo(layer).bindPopup('x').on('click', () => {});
  L.rectangle([[0, 0], [1, 1]]).addTo(layer);
  L.geoJSON(null, {}).addTo(map);
  L.marker([0, 0], { icon: L.divIcon({ className: 'x' }) }).addTo(layer);
  L.tileLayer('u', {}).addTo(map);
  L.control.layers({}, {}).addTo(map);
  map.setView([0, 0], 2);
  map.flyTo([1, 1], 4);
  map.fitBounds(L.featureGroup([]).getBounds());
  map.invalidateSize({ animate: false });
  map.eachLayer(() => {});
  map.scrollWheelZoom.enable();
  map.scrollWheelZoom.disable();

  /* And the few answers a page actually reads are answers, not stand-ins. */
  assert.deepEqual(layer.getLayers(), [], 'getLayers must return something a page can count');
  assert.equal(layer.getLayers().length, 0);
  assert.equal(typeof map.getZoom(), 'number');
  assert.equal(map.getSize().x, 0);

  assert.equal(marked.length, 1, 'the map panel was not marked as unavailable');
  assert.match(container.textContent, /could not be loaded/i,
    'the map panel is left empty, which reads as "nothing is happening near you"');
  assert.equal(container.getAttribute('role'), 'note');
  assert.equal(w.PNDMap.mapUnavailable, true, 'the page cannot tell that the map is missing');

  delete global.window; delete global.document;
  delete require.cache[require.resolve('../map-setup.js')];
});

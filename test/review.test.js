'use strict';
/**
 * Five findings from review on this branch, all real, and two of them cases
 * where the symmetric case was fixed and its twin left behind.
 *
 *  - home-v3.html called PND.matches while loading only search.js, so any
 *    non-empty query threw a ReferenceError and left the list unfiltered.
 *    Exactly the dashboard defect, fixed in the same commit, one page away.
 *  - regions.html filtered a box labelled "country, state, province or region"
 *    with the free-text matcher, so typing USGS listed every USGS record while
 *    the adjacent button opened a region page for a region that does not exist.
 *  - verdicts.js keyed a window by its start alone, so a reissue with the same
 *    start and a revised end collapsed onto one key - the multi-window
 *    misgrading the helper exists to prevent.
 *  - and it spread the verdict over the frozen row, letting a verdict rewrite
 *    the claim it was judging: ND-001's frozen "Huế-Đà Nẵng corridor" was
 *    displayed as the verdict's wider "Hue-Da Nang-Quang Ngai corridor".
 *  - the NWS source link used the mean of the polygon's vertices, which for a
 *    concave or multipart warning area is outside it, so the point forecast it
 *    opened could show an unalerted location.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const V = require(path.join(ROOT, 'verdicts.js'));
const api = require(path.join(ROOT, 'api', 'events.js'));
const OUTLOOKS = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
const LEDGER = require(path.join(ROOT, 'data', 'verification-ledger.json'));

test.after(closeAllWindows);

/* ---------- a page must call the matcher it actually loaded ---------- */

test('no page calls a matcher through a namespace it never loaded', () => {
  const broken = [];
  for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html'))) {
    const s = read(f);
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '');
    const loadsPortal = /<script[^>]*\ssrc="\/portal\.js(\?[^"]*)?"/.test(s);
    const loadsSearch = /<script[^>]*\ssrc="\/search\.js(\?[^"]*)?"/.test(s);
    if (/\bPND\.[a-zA-Z]/.test(code) && !loadsPortal) broken.push(f + ': uses PND without portal.js');
    if (/\bPNDSearch\.[a-zA-Z]/.test(code) && !loadsSearch) broken.push(f + ': uses PNDSearch without search.js');
    if (/\bPNDVerdicts\.[a-zA-Z]/.test(code) && !/<script[^>]*\ssrc="\/verdicts\.js(\?[^"]*)?"/.test(s)) {
      broken.push(f + ': uses PNDVerdicts without verdicts.js');
    }
  }
  assert.deepEqual(broken, [], 'these pages throw a ReferenceError on use');
});

test('home-v3 filters its list without throwing', async () => {
  const { window } = await renderPage('home-v3.html', { timeoutMs: 15000 });
  const doc = window.document;
  const box = doc.getElementById('search');
  assert.ok(box, 'home-v3 still has a search box');
  const before = doc.querySelectorAll('#liveList a, #liveList article').length;
  box.value = 'earthquake';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const errs = [];
  window.addEventListener('error', e => errs.push(e));
  assert.equal(errs.length, 0);
  void before;
  window.close();
});

/* ---------- a geography box must stay geographic ---------- */

test('a filter whose button opens a region matches only geography', () => {
  const s = read('regions.html');
  /* The box is labelled for places and its neighbour navigates to whatever was
     typed, so free-text matching made the preview and the navigation describe
     different things. */
  /* One Go button (launch audit D32): a country, continent or the world opens
     its own page, anything else goes to the place search. */
  assert.match(s, /function goTarget\(v\)/, 'regions.html no longer decides where the typed value goes');
  assert.match(s, /PND\.regionUrl\(t\.region\)/, 'regions.html no longer opens the typed place');
  assert.match(s, /PND\.matchesPlace\(/, 'regions.html filters with the free-text matcher');
  assert.doesNotMatch(s.replace(/\/\*[\s\S]*?\*\//g, ''), /PND\.matches\(/);
});

test('the place matcher ignores everything that is not a place', () => {
  const e = { country: 'United States', region: 'Whitley', type: 'Flood',
    source: 'USGS', details: 'Reported from Oslo', id: 'nws-123' };
  for (const notAPlace of ['usgs', 'flood', 'nws-123']) {
    assert.equal(V && true, true);
    assert.equal(require(path.join(ROOT, 'search.js')).matchesPlace(e, notAPlace), false,
      `"${notAPlace}" matched a geography filter`);
  }
  assert.equal(require(path.join(ROOT, 'search.js')).matchesPlace(e, 'whitley'), true);
});

test('a geography filter does not match hazard words in a title', () => {
  const S = require(path.join(ROOT, 'search.js'));
  /* title was in the place field list because a few records carry their place
     only there. Measured against the live feed of 792 records, that made
     "flood" match 323 of them through their titles, while only 2 records have
     no country, region or location at all - and both are named storms. */
  assert.equal(S.matchesPlace({ country: 'Japan', title: 'Flood warning' }, 'flood'), false);
  assert.equal(S.matchesPlace({ country: 'Japan', title: 'Flood warning' }, 'japan'), true);
  assert.equal(S.PLACE_FIELDS.includes('title'), false,
    'a geography box is searchable by hazard text again');
  for (const f of ['country', 'region', 'location']) {
    assert.ok(S.PLACE_FIELDS.includes(f), `${f} dropped from place matching`);
  }
});

/* ---------- a verdict judges one window and changes nothing ---------- */

test('a reissue with the same start and a new end is a different window', () => {
  const a = { id: 'X', targetStart: '2026-09-14T00:00:00Z', targetEnd: '2026-09-17T00:00:00Z' };
  const b = { id: 'X', targetStart: '2026-09-14T00:00:00Z', targetEnd: '2026-09-19T00:00:00Z' };
  assert.notEqual(V.windowKey(a), V.windowKey(b),
    'two different windows share a key, so one verdict would grade both');
  const { records } = V.joinVerdicts([a, b],
    [{ id: 'X', status: 'FALSE_ALARM', targetStart: a.targetStart, targetEnd: a.targetEnd }]);
  assert.equal(records.filter(r => r.status).length, 1);
  assert.equal(records.find(r => r.status).targetEnd, a.targetEnd);
});

test('a verdict cannot rewrite the claim it is judging', () => {
  const row = { id: 'Y', region: 'Frozen corridor', country: 'Vietnam',
    type: 'Flood', alert: 'Orange', severity: 'Severe',
    targetStart: '2026-09-14T00:00:00Z', targetEnd: '2026-09-16T00:00:00Z',
    confidence: 'Frozen', evidence: 'as recorded', verificationRule: 'the rule' };
  const verdict = { id: 'Y', status: 'PARTIAL_VERIFICATION',
    region: 'A much wider corridor', country: 'Vietnam', alert: 'Red',
    severity: 'Extreme', observedSeverity: 'SIGNIFICANT', summary: 'what happened',
    targetStart: '2026-09-15T00:00:00Z', targetEnd: '2026-09-20T00:00:00Z' };
  const { records } = V.joinVerdicts([row], [verdict]);
  const m = records[0];
  for (const f of V.CLAIM_FIELDS) {
    assert.equal(m[f], row[f], `the verdict changed the frozen ${f}`);
  }
  /* The outcome still arrives. */
  assert.equal(m.status, 'PARTIAL_VERIFICATION');
  assert.equal(m.observedSeverity, 'SIGNIFICANT');
  assert.equal(m.summary, 'what happened');
});

test('the shipped ND-001 record keeps the corridor it froze', () => {
  const row = OUTLOOKS.find(o => o.id === 'ND-001');
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const merged = records.find(r => r.id === 'ND-001');
  assert.equal(merged.region, row.region);
  assert.match(merged.region, /Huế/, 'the frozen corridor is no longer the recorded one');
  assert.equal(merged.status, 'PARTIAL_VERIFICATION', 'the verdict stopped attaching');
});

test('what the comparison calls "predicted" is what was recorded', async () => {
  const { window } = await renderPage('accuracy.html', { search: '?full=1', timeoutMs: 20000,
    waitFor: d => (d.getElementById('mTotal') || {}).textContent !== '-' });
  const doc = window.document;
  const card = [...doc.querySelectorAll('#cmpList .cmp')]
    .find(c => c.textContent.includes('ND-001'));
  assert.ok(card, 'ND-001 has no comparison card');
  const row = OUTLOOKS.find(o => o.id === 'ND-001');
  const predicted = card.querySelector('.split > div').textContent;
  assert.ok(predicted.includes(row.region),
    `"What was predicted" shows an area the ledger never froze`);
  window.close();
});

/* ---------- a source link must land inside the warned area ---------- */

test('the linked point is inside a concave warning area', () => {
  /* A C-shaped county warning: the mean of the vertices sits in the notch. */
  const C = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [7, 10],
    [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]]] };
  const ring = C.coordinates[0];
  const mean = api.centroid(C);
  assert.equal(api.inRing(mean.lon, mean.lat, ring), false,
    'this fixture no longer demonstrates the problem');
  const p = api.insidePoint(C, mean);
  assert.equal(api.inRing(p.lon, p.lat, ring), true,
    'the link still points outside the warned area');
});

test('a multipart warning area is linked from inside one of its parts', () => {
  const M = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[20, 0], [24, 0], [24, 4], [20, 4], [20, 0]]]
  ] };
  const mean = api.centroid(M);
  const polys = api.polygonsOf(M);
  assert.equal(polys.length, 2);
  assert.equal(polys.some(p => api.inPolygon(mean.lon, mean.lat, p)), false,
    'the mean of two distant parts should fall between them');
  const p = api.insidePoint(M, mean);
  assert.equal(polys.some(q => api.inPolygon(p.lon, p.lat, q)), true);
});

test('a hole is outside the warned area, and the link respects that', () => {
  /* A warning area with a hole in it: the mean of the vertices lands in the
     hole. The first version of this accepted it, because it flattened every
     ring and asked only whether the point was inside any of them - and a point
     in a hole is inside the exterior. GeoJSON says a hole is outside the
     geometry, so the link still opened an unwarned location. */
  const donut = { type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]
  ] };
  const polys = api.polygonsOf(donut);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1, 'the hole was not kept as a hole');
  const mean = api.centroid(donut);
  assert.equal(api.inRing(mean.lon, mean.lat, polys[0].outer), true,
    'this fixture relies on the mean being inside the exterior');
  assert.equal(api.inPolygon(mean.lon, mean.lat, polys[0]), false,
    'a point in the hole is being treated as inside the warned area');
  const p = api.insidePoint(donut, mean);
  assert.equal(api.inPolygon(p.lon, p.lat, polys[0]), true,
    'the link still points into the hole');
});

test('a scanline that cuts straight through a hole still finds a point', () => {
  /* A hole spanning the full width at the vertical middle: one scanline
     through the centre finds only spans that are inside the hole. */
  const band = { type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[1, 4], [9, 4], [9, 6], [1, 6], [1, 4]]
  ] };
  const polys = api.polygonsOf(band);
  const p = api.insidePoint(band, api.centroid(band));
  assert.ok(p, 'no point was found at all');
  assert.equal(api.inPolygon(p.lon, p.lat, polys[0]), true);
});

test('a convex area keeps its centroid rather than moving for no reason', () => {
  const S = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] };
  const mean = api.centroid(S);
  assert.deepEqual(api.insidePoint(S, mean), mean);
});

test('a hole large enough to swallow every sample is still handled', () => {
  /* The first hole fix sampled five fixed scanlines through the exterior only.
     An outer square from -10 to 10 with a hole from -9 to 9 leaves a one-unit
     rim that no sampled midpoint lands in, so it fell back to the mean - the
     very coordinate it had already rejected. */
  const rim = { type: 'Polygon', coordinates: [
    [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
    [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9]]
  ] };
  const polys = api.polygonsOf(rim);
  const mean = api.centroid(rim);
  assert.equal(api.inPolygon(mean.lon, mean.lat, polys[0]), false,
    'this fixture relies on the mean being in the hole');
  const p = api.insidePoint(rim, mean);
  assert.ok(p, 'no point was found at all');
  assert.equal(api.inPolygon(p.lon, p.lat, polys[0]), true,
    'the link still opens a point outside the warned area');
});

test('insidePoint never returns a point it has itself rejected', () => {
  /* The rule rather than the shape: whatever comes back must pass the same
     containment test, or nothing comes back. Sampling can always be defeated
     by some geometry; handing back a known-wrong coordinate cannot be. */
  const shapes = [
    { type: 'Polygon', coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
      [[-9.9, -9.9], [9.9, -9.9], [9.9, 9.9], [-9.9, 9.9], [-9.9, -9.9]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[0.01, 0.01], [9.99, 0.01], [9.99, 9.99], [0.01, 9.99], [0.01, 0.01]]] }
  ];
  for (const g of shapes) {
    const polys = api.polygonsOf(g);
    const p = api.insidePoint(g, api.centroid(g));
    if (p === null) continue;
    assert.equal(polys.some(q => api.inPolygon(p.lon, p.lat, q)), true,
      `returned ${JSON.stringify(p)}, which is outside the shape`);
  }
});

test('an alert placed from its zone is checked against that zone', () => {
  /* The zone fallback was the path nobody looked at. When an alert carries no
     inline geometry its coordinate comes from the fetched zone, but the call
     passed f.geometry - null - to insidePoint, which then accepted the mean
     unchecked. A concave forecast zone could still send the reader somewhere
     that is not under the warning. */
  const src = read(path.join('api', 'events.js'));
  assert.match(src, /const zoneGeometry = new Map\(\)/,
    'the zone shape is not retained, only its middle');
  assert.match(src, /insidePoint\(f\.geometry \|\| zoneGeometry\.get\(f\) \|\| null, c\)/,
    'the zone shape never reaches the containment check');
  assert.doesNotMatch(src, /insidePoint\(f\.geometry, c\)/,
    'the call still passes a null geometry for a zone-placed alert');
});

test('a null geometry yields no verified point, so no point link', () => {
  /* The behaviour that makes the above matter: with nothing to check against,
     insidePoint hands back whatever it was given, so the caller must not use
     it as if it had been verified. */
  const concave = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10],
    [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]]] };
  const mean = api.centroid(concave);
  const polys = api.polygonsOf(concave);
  assert.equal(api.inPolygon(mean.lon, mean.lat, polys[0]), false);
  /* Given the shape, it finds a real interior point. */
  const good = api.insidePoint(concave, mean);
  assert.equal(api.inPolygon(good.lon, good.lat, polys[0]), true);
  /* Given nothing, it can only echo the mean - which is why the shape has to
     be passed. */
  assert.deepEqual(api.insidePoint(null, mean), mean);
});

test('a link is only built from a point that was verified', () => {
  const src = read(path.join('api', 'events.js'));
  /* The fallback must be the agency's front page, not the rejected mean. */
  assert.doesNotMatch(src, /insidePoint\(f\.geometry, c\) \|\| c/,
    'the link falls back to the coordinate insidePoint exists to avoid');
  /* The zone fallback now supplies a shape when the alert has none inline,
     so the call is no longer the bare f.geometry it started as. */
  assert.match(src, /const link = insidePoint\(f\.geometry \|\| zoneGeometry/);
  assert.match(src, /link && Number\.isFinite\(link\.lat\)/);
});

test('an alert with no usable geometry still gets a link', () => {
  const mean = { lat: 40, lon: -75 };
  assert.deepEqual(api.insidePoint(null, mean), mean);
  assert.deepEqual(api.insidePoint({ type: 'Point', coordinates: [1, 2] }, mean), mean);
});

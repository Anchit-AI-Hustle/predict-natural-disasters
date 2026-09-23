'use strict';
/*
 * What a coordinate is allowed to say about a place.
 *
 * The Personal Risk page carried the sentence "Only incident-level coordinates
 * qualify as nearby risks; country/regional centroids and forecasts are
 * excluded" above a filter that read a `precision` field the API set in
 * exactly one branch. Every other record - GDACS, USGS, EONET, NHC, NWS, EMSC
 * - arrived with no precision at all and sailed through the test, so a drought
 * spanning the Horn of Africa, a wildfire covering Attica and a county-wide
 * flash-flood warning were each reported as a hazard a handful of kilometres
 * from someone's home, and the page said so in bold.
 *
 * These tests are written as rules over the whole served feed rather than as
 * assertions about particular fixtures, because the defect was never in one
 * record: it was that nothing checked the class of any of them. Several carry
 * their own negative control, showing what the shipped rule produced for the
 * same input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../hazard-model.js');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const feed = async (mock) => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', mock)).json();

const PRECISIONS = ['incident', 'polygon', 'admin2', 'admin1', 'regional', 'country', 'unknown'];
/* Finest first. An outlook may be coarser than the signal it came from and
   must never be finer. */
const FINENESS = PRECISIONS.reduce((m, k, i) => { m[k] = i; return m; }, {});

const placed = ev => ev.filter(e => Number.isFinite(+e.lat) && Number.isFinite(+e.lon));
/* A saved place a few kilometres from the record's own coordinate: the best
   case for the record, and the case the old rule got wrong. */
const beside = e => ({ id: 'probe', name: 'Probe', lat: +e.lat + 0.05, lon: +e.lon });

/* ------------------------------------------------ every record is classified */

test('every served record says what its coordinate means', async () => {
  const { events } = await feed();
  assert.ok(events.length > 10, 'feed should have records to classify');
  const bad = events.filter(e => !PRECISIONS.includes(e.locationPrecision));
  assert.deepEqual(bad.map(e => e.title + ' -> ' + e.locationPrecision), [],
    'these records carry no recognised location precision');
  const noReason = events.filter(e => !e.proximityReason);
  assert.deepEqual(noReason.map(e => e.title), [], 'these records explain nothing about their coordinate');
});

test('only an incident coordinate is eligible to carry a distance', async () => {
  const { events } = await feed();
  // Without this the test passes on a feed that has no such field at all,
  // which is the state it was written against.
  assert.ok(events.some(e => e.proximityEligible === true), 'nothing in the feed is proximity-eligible');
  assert.ok(events.some(e => e.proximityEligible === false), 'everything in the feed is proximity-eligible');
  const wrong = events.filter(e => e.proximityEligible && e.locationPrecision !== 'incident');
  assert.deepEqual(wrong.map(e => e.title + ' (' + e.locationPrecision + ')'), [],
    'a record that is not at an incident was marked proximity-eligible');
  const missed = events.filter(e => !e.proximityEligible && e.locationPrecision === 'incident');
  assert.deepEqual(missed.map(e => e.title), [], 'an incident record was refused a distance');
});

test('the published counts describe the records actually served', async () => {
  const { events, meta } = await feed();
  const rollup = events.reduce((m, e) => { m[e.locationPrecision] = (m[e.locationPrecision] || 0) + 1; return m; }, {});
  assert.deepEqual(meta.locationPrecision, rollup, 'meta counts a different set than it serves');
  assert.equal(meta.proximityEligible, events.filter(e => e.proximityEligible).length);
  assert.equal(Object.values(meta.locationPrecision).reduce((a, b) => a + b, 0), events.length,
    'the precision rollup does not add up to the feed');
});

/* --------------------------------- no area record may ever state a distance */

test('no record placed at an area centre can state a distance to a saved place', async () => {
  const { events } = await feed();
  const offenders = [];
  const controls = [];
  for (const e of placed(events)) {
    const row = H.riskRow(e, beside(e));
    if (row && row.claimDistance && e.locationPrecision !== 'incident') {
      offenders.push(e.title + ' (' + e.locationPrecision + ')');
    }
    // What shipped: precision was set only by the ReliefWeb branch, so every
    // other record passed the page's "incident-level only" test.
    const asShipped = /reliefweb/i.test(String(e.source || '')) ? 'country' : undefined;
    const oldPrecise = asShipped !== 'country' && asShipped !== 'regional' && !e.forecast;
    if (oldPrecise && e.locationPrecision !== 'incident') controls.push(e.title);
  }
  assert.deepEqual(offenders, [], 'these records would be reported as a distance from a home');
  assert.ok(controls.length > 0,
    'negative control is inert: the fixture no longer contains a record the shipped rule mislocalised');
});

test('a country-level humanitarian record near a city is context, not a nearby hazard', () => {
  /* The shape a ReliefWeb record arrives in: one country, one centroid, no
     incident anywhere in it. A saved place in Noida is a few hundred km from
     the centroid of India and is not thereby a few hundred km from a flood. */
  const record = {
    id: 'rw-test', title: 'India: Floods - Sep 2026', type: 'Flood',
    source: 'ReliefWeb (UN OCHA)', sourceType: 'official',
    lat: 22.0, lon: 79.0,
    locationPrecision: 'country', precision: 'country',
    evidenceState: 'observed', proximityEligible: false,
    proximityReason: 'Placed at a country centroid, not at an incident.'
  };
  const noidaish = { id: 'home', name: 'Home', lat: 24.5, lon: 79.0 };   // ~278 km north

  const row = H.riskRow(record, noidaish);
  assert.ok(row, 'the record should still be shown as regional context');
  assert.equal(row.band, 'D', 'a country centroid is not a nearby incident');
  assert.equal(row.claimDistance, false, 'a country centroid was given a distance');
  assert.match(row.applicability, /has not been established/,
    'the row must say that containment was not established');

  // Negative control: the rule this replaces.
  const shipped = record.precision !== 'country' && record.precision !== 'regional' && !record.forecast;
  const d = H.distanceKm(noidaish.lat, noidaish.lon, record.lat, record.lon);
  assert.ok(d > 150 && d < 500, 'control distance should be inside the old 500 km window');
  assert.equal(shipped, false,
    'this record is the one case the shipped rule did catch - the sweep above covers the rest');
});

/* --------------------------------------- a derived outlook inherits nothing */

test('an outlook is never more precisely located than the signal it came from', async () => {
  const { events } = await feed();
  const byId = new Map(events.map(e => [e.id, e]));
  const derived = events.filter(e => e.forecast && e.forecastOf && byId.has(e.forecastOf));
  assert.ok(derived.length > 0, 'fixture should contain derived outlooks');
  // undefined < undefined is false, so an unclassified feed would sail through.
  for (const o of derived) {
    assert.ok(PRECISIONS.includes(o.locationPrecision), 'unclassified outlook: ' + o.title);
    assert.ok(PRECISIONS.includes(byId.get(o.forecastOf).locationPrecision),
      'unclassified signal behind: ' + o.title);
  }
  const finer = derived.filter(o =>
    FINENESS[o.locationPrecision] < FINENESS[byId.get(o.forecastOf).locationPrecision]);
  assert.deepEqual(finer.map(o => o.title), [], 'an outlook claims a finer location than its own signal');
});

test('an outlook issued for a country is located at a country', async () => {
  const { events } = await feed();
  const countryWide = events.filter(e => e.forecast && e.forecastScope === 'country');
  assert.ok(countryWide.length > 0, 'fixture should contain a country-scope outlook');
  const wrong = countryWide.filter(e => e.proximityEligible);
  assert.deepEqual(wrong.map(e => e.title), [],
    'a country-wide outlook was reported as an incident location');
});

/* ------------------------------------- containment is answered by the shape */

test('a place at the centre of a concave warning zone is not inside it', () => {
  // A U-shaped forecast zone. Its centre point sits in the gap between the
  // arms, so distance-to-centroid calls it the most exposed place on the map
  // while the agency has not warned it at all.
  const u = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [8, 10], [8, 2], [2, 2], [2, 10], [0, 10], [0, 0]]] };
  assert.equal(H.geometryContains(u, 5, 5), false, 'the gap in the U was reported as warned');
  assert.equal(H.geometryContains(u, 5, 1), true, 'the left arm of the U was reported as unwarned');
  assert.equal(H.distanceKm(5, 5, 5, 5), 0, 'control: the unwarned point is 0 km from the centroid');
});

test('a hole in a warning area is not inside it', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const g = { type: 'Polygon', coordinates: [ring, hole] };
  assert.equal(H.geometryContains(g, 5, 5), false, 'a point in the hole was reported as covered');
  assert.equal(H.geometryContains(g, 1, 1), true, 'a point in the ring was reported as uncovered');
});

test('one undecidable part makes a multipart shape undecidable', () => {
  /* Also Codex, on the same round. A MultiPolygon with one ordinary part and
     one antimeridian-wrapping part returned false: the decidable part said
     "not in me", and that was reported as "outside the warning". Being unable
     to decide a part is not evidence the point is not in it. */
  const sq = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  const wrap = [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]];
  const mixed = { type: 'MultiPolygon', coordinates: [sq(0, 0, 2, 2), wrap] };
  assert.equal(H.geometryContains(mixed, 10, 10), null,
    'an undecidable part was rounded down to "outside"');
  assert.equal(H.geometryContains(mixed, 1, 1), true,
    'a point inside a decidable part is still inside');
  // Control: when every part is decidable, "outside" is a real answer.
  const decidable = { type: 'MultiPolygon', coordinates: [sq(0, 0, 2, 2), sq(20, 20, 22, 22)] };
  assert.equal(H.geometryContains(decidable, 10, 10), false);

  const gc = { type: 'GeometryCollection', geometries: [
    { type: 'Polygon', coordinates: sq(0, 0, 2, 2) },
    { type: 'Polygon', coordinates: wrap }] };
  assert.equal(H.geometryContains(gc, 10, 10), null,
    'a collection with an undecidable member was reported as outside');
  assert.equal(H.geometryContains({ type: 'GeometryCollection',
    geometries: [{ type: 'Polygon', coordinates: sq(0, 0, 2, 2) }] }, 10, 10), false);
});

test('an undecidable shape is undecidable, never "outside"', () => {
  const wrapped = { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]] };
  assert.equal(H.geometryContains(wrapped, 1, 179.5), null, 'an antimeridian ring was ray-cast anyway');
  assert.equal(H.geometryContains(null, 1, 1), null);
  assert.equal(H.geometryContains({ type: 'Point', coordinates: [1, 1] }, 1, 1), null);
  assert.equal(H.geometryContains({ type: 'Polygon', coordinates: [ [[0,0],[1,1]] ] }, 0.5, 0.5), null,
    'a degenerate ring was treated as a decision');
});

test('a warning with an area is decided by the area, not by the distance', async () => {
  const { events } = await feed();
  const withArea = events.filter(e => e.geometry && e.evidenceState === 'official-warning');
  assert.ok(withArea.length > 0, 'fixture should contain a warning that published its area');
  for (const e of withArea) {
    const row = H.riskRow(e, beside(e));
    assert.ok(row, e.title + ' produced no row at all');
    assert.equal(row.claimDistance, false, e.title + ' stated a distance from a warning-zone centre');
    assert.ok(['B', 'D'].includes(row.band), e.title + ' landed in band ' + row.band);
  }
});

test('a warning with no published area says its applicability is unestablished', () => {
  const row = H.riskRow(
    { evidenceState: 'official-warning', lat: 0.5, lon: 0.5, type: 'Flood' },
    { id: 'h', name: 'Home', lat: 1.5, lon: 0.5 });
  assert.equal(row.band, 'B');
  assert.equal(row.claimDistance, false);
  assert.match(row.applicability, /has not been established/);
});

/* --------------------------- a warning covers every zone it was issued for */

test('a warning issued for several zones covers all of them', async () => {
  /* Found by Codex on the first round of this change. A warning with no
     inline geometry routinely names several forecast zones; only the first
     was resolved, and it was then published as the complete affected area.
     A saved place in the second zone was tested against the first, found
     outside, and told it was outside the warning area - a false negative on
     the one question a warning exists to answer. */
  const { events } = await feed();
  const zoned = events.find(e => e.geometry && e.geometry.type === 'MultiPolygon' &&
    /Weather Service/.test(String(e.source)));
  assert.ok(zoned, 'the fixture no longer contains a warning resolved from several zones');
  assert.ok(zoned.geometry.coordinates.length >= 2,
    'only one zone of a multi-zone warning was published');

  // A place in the first zone and a place in the second are both covered.
  const inFirst = H.geometryContains(zoned.geometry, 33.4, -112.1);
  const inSecond = H.geometryContains(zoned.geometry, 32.2, -110.9);
  assert.equal(inFirst, true, 'a place in the first zone is not covered');
  assert.equal(inSecond, true, 'a place in a later zone is reported as outside the warning');

  // And the band follows: inside the area, not merely near it.
  const row = H.riskRow(zoned, { id: 'p', name: 'Home', lat: 32.2, lon: -110.9 });
  assert.ok(row, 'a place inside the warned area produced no row at all');
  assert.equal(row.band, 'B');
  assert.equal(row.containment, true,
    'a place inside a later zone of the warning was not treated as inside it');
});

test('a partial area is never published as the whole area', async () => {
  /* When one zone of a multi-zone warning cannot be resolved, publishing what
     did resolve would assert a boundary the agency did not draw. The record
     keeps its zone centre and says applicability is not established. */
  const { events, meta } = await feed({ nwsZonesDown: ['AZZ554'] });
  const alert = events.find(e => /Excessive Heat Warning/.test(String(e.title)));
  assert.ok(alert, 'the fixture should still contain the multi-zone warning');
  assert.ok(!alert.geometry,
    'a partial affected area was published as the whole one: ' + JSON.stringify(alert.geometry));
  assert.equal(alert.locationPrecision, 'admin2',
    'without a complete area the record should fall back to its zone centre');
  assert.ok(Number.isFinite(+alert.lat),
    'the alert was dropped from the map entirely rather than falling back');
  assert.equal(meta.sources.nws.areaWithheldIncompleteZones, 1,
    'withholding an incomplete area is not reported in source health');

  // And the interface says so rather than claiming the place is outside.
  const row = H.riskRow(alert, { id: 'p', name: 'Home', lat: 32.2, lon: -110.9 });
  if (row) {
    assert.notEqual(row.applicability, H.APPLICABILITY.outsideWarning,
      'a place was told it is outside a warning whose area could not be established');
  }
});

/* ------------------------------------------------------ what the page shows */

test('the page no longer claims a filter it does not implement', () => {
  const page = read('personal-risk.html');
  assert.equal(/Only incident-level coordinates qualify/.test(page), false,
    'the page still carries the claim the code did not implement');
  assert.equal(/e\.precision!==/.test(page), false,
    'the page still filters on the field that was almost never set');
});

test('the page renders every evidence band, including the one with no data', async () => {
  const anchor = { id: 'p1', kind: 'Home', name: 'Probe place', lat: 27.75, lon: 85.3 };
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([anchor]) },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  const text = r.text();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  for (const b of H.RISK_BANDS) {
    assert.ok(text.includes(b.key + ' · ' + b.title), 'band ' + b.key + ' is missing from the page');
  }
  assert.ok(/No per-location event history is published/.test(text),
    'the historical band should say plainly that it has no data rather than look empty');
  r.close();
});

test('a place inside a regional hazard is shown without a distance to it', async () => {
  const { events } = await feed();
  // Kathmandu sits inside the GDACS flood record for Bagmati Province, whose
  // coordinate is the middle of the province. The shipped page read that as a
  // hazard 0 km away.
  const regional = events.find(e => e.locationPrecision === 'regional' && Number.isFinite(+e.lat));
  assert.ok(regional, 'fixture should contain a region-wide record');
  const place = { id: 'p1', kind: 'Home', name: 'Probe place', lat: +regional.lat, lon: +regional.lon };

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  const cards = [...r.document.querySelectorAll('#risks .card')].map(c => c.textContent);
  const row = cards.find(t => t.includes(regional.title));
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.ok(row, 'the regional record should still be listed as context');
  assert.equal(/\d+\s*km from Probe place/.test(row), false,
    'the regional record was reported as a distance from the saved place: ' + row);

  // And the place's own summary must not be banded off it either.
  const savedCard = r.document.querySelector('#saved .card');
  assert.equal(/nearest incident/.test(savedCard.textContent), false,
    'a region-wide record was counted as the nearest incident: ' + savedCard.textContent);
  r.close();
});

test('a multi-country drought is not a hazard at the door', async () => {
  /* Deliberately written without naming anything this change introduced, so it
     runs against the page as it shipped as well as against the page now. The
     record is a GDACS drought alert covering the Horn of Africa; its
     coordinate is the middle of that area. Saving a home on that exact point
     made the shipped page print "0 km from Home" and band the place HIGH. */
  const { events } = await feed();
  const drought = events.find(e => /Drought in Horn of Africa/.test(String(e.title)));
  assert.ok(drought, 'fixture should contain the multi-country drought');
  const place = { id: 'p1', kind: 'Home', name: 'Probe place', lat: +drought.lat, lon: +drought.lon };

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  const page = r.text();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(/\d+\s*km from Probe place/.test(page), false,
    'the page states a distance to a hazard that spans several countries');
  assert.equal(/HIGH · nearest/.test(page), false,
    'the place was banded HIGH off the middle of a multi-country drought');
  assert.ok(page.includes(drought.title), 'the drought should still be listed as context');
  r.close();
});

/* --------------------------------------------------------- what it notifies */

test('a browser notification never fires off an area centroid', async () => {
  const { events } = await feed();
  const regional = events.find(e => e.locationPrecision === 'regional' && Number.isFinite(+e.lat));
  assert.ok(regional, 'fixture should contain a region-wide record');
  const place = { id: 'p1', kind: 'Home', name: 'Probe place', lat: +regional.lat, lon: +regional.lon };
  const fired = [];

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    beforeParse(w) {
      function N(title, opts) { fired.push(title + ' :: ' + ((opts || {}).body || '')); }
      N.permission = 'granted';
      N.requestPermission = async () => 'granted';
      w.Notification = N;
    },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const fromCentroid = fired.filter(t => /\d+ km away/.test(t));
  assert.deepEqual(fromCentroid, [],
    'a notification stated a distance derived from the middle of a hazard area');
  r.close();
});

test('a browser notification does fire for an incident next door', async () => {
  const { events } = await feed();
  const incident = events.find(e => e.proximityEligible && !e.forecast &&
    /red|orange/i.test(String(e.alert || '')) && Number.isFinite(+e.lat));
  assert.ok(incident, 'fixture should contain a red or orange incident');
  const place = { id: 'p1', kind: 'Home', name: 'Probe place', lat: +incident.lat + 0.05, lon: +incident.lon };
  const fired = [];

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    beforeParse(w) {
      function N(title, opts) { fired.push(title + ' :: ' + ((opts || {}).body || '')); }
      N.permission = 'granted';
      N.requestPermission = async () => 'granted';
      w.Notification = N;
    },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.ok(fired.some(t => /km away/.test(t)),
    'gating the notifications silenced the case they exist for: ' + JSON.stringify(fired));
  r.close();
});

test('a country-wide outlook applies to the country, not to a radius', async () => {
  /* A United States outlook anchored in Florida was dropped for a home in
     California — 3,500 km away and squarely inside the area the outlook
     names — because a forecast with no geometry was matched on distance to
     whichever point it happened to be anchored at. */
  const outlook = { id: 'OUT-us', forecast: true, forecastScope: 'country',
    country: 'United States', type: 'Wildfire', lat: 27.9, lon: -81.7 };
  const california = { id: 'p', name: 'Home', lat: 36.7, lon: -119.4, country: 'United States' };
  const nepal = { id: 'p2', name: 'Home', lat: 27.7, lon: 85.3, country: 'Nepal' };

  const row = H.riskRow(outlook, california);
  assert.ok(row, 'a country-wide outlook was withheld from a place inside the country it names');
  assert.equal(row.band, 'C');
  assert.equal(row.claimDistance, false, 'a country-wide outlook must not be reported as a distance');
  assert.match(row.applicability, /whole country/i);

  assert.equal(H.riskRow(outlook, nepal), null,
    'a United States outlook was shown for a home in Nepal');

  /* Where the saved place has no country, neither answer is available, so
     nothing is invented for it beyond the radius it would have had. */
  const unplaced = { id: 'p3', name: 'Home', lat: 36.7, lon: -119.4 };
  assert.equal(H.riskRow(outlook, unplaced), null);
  const near = H.riskRow(outlook, { id: 'p4', name: 'Home', lat: 28.2, lon: -81.9 });
  assert.match(near.applicability, /no country recorded/i,
    'a place with no country is not told why the answer is missing');
});

test('the page says which country-wide outlooks it could not place', async () => {
  const anchor = { id: 'p1', kind: 'Home', name: 'Probe place', lat: 27.75, lon: 85.3 };
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([anchor]) },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const note = (r.document.getElementById('scopeNote') || {}).textContent || '';
  const feedHasCountryOutlooks = /country-wide outlook/.test(note);
  if (feedHasCountryOutlooks) {
    assert.match(note, /no country recorded/i);
    assert.match(note, /search for the place by name/i,
      'the page states the limitation without saying how to fix it');
  }
  /* A place saved with a country is not warned about. */
  const placed = { id: 'p2', kind: 'Home', name: 'Kathmandu', lat: 27.75, lon: 85.3, country: 'Nepal' };
  const r2 = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([placed]) },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  assert.equal((r2.document.getElementById('scopeNote') || {}).textContent, '',
    'a place with a country recorded was still reported as unplaceable');
  r.close(); r2.close();
});

test('a country-wide outlook is not lost to the language the place was saved in', () => {
  /* Nominatim answers in the browser's language, so a home saved in a German
     browser records "Deutschland" while every record in the feed says
     "Germany". Exact name equality then failed and the page did the quiet
     thing - it dropped every Germany-wide outlook for that reader rather than
     being wrong out loud. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const outlook = { forecast: true, forecastScope: 'country', country: 'Germany',
    type: 'Severe Storm', title: '2-day Severe Storm risk outlook \u2014 Germany',
    lat: 50.1, lon: 8.7 };
  const berlin = { lat: 52.52, lon: 13.40 };

  const localized = H.riskRow(outlook, Object.assign({ country: 'Deutschland', countryCode: 'DE' }, berlin));
  assert.ok(localized, 'a Germany-wide outlook was dropped for a home in Berlin saved in German');
  assert.equal(localized.band, 'C');
  assert.match(localized.applicability, /whole country/i);

  // The English name alone still matches, as it always did.
  assert.ok(H.riskRow(outlook, Object.assign({ country: 'Germany' }, berlin)));
  // And a spelling that differs only in punctuation is the same country.
  assert.equal(H.countryMatches({ country: 'Viet Nam' }, 'Vietnam'), true);

  /* A genuinely different country is still a different country - the fix must
     not turn every country-wide outlook into a match. */
  assert.equal(H.riskRow(outlook, { lat: 48.86, lon: 2.35, country: 'France', countryCode: 'FR' }), null,
    'a German outlook was shown for a home in Paris');
  assert.equal(H.riskRow(outlook, { lat: 48.86, lon: 2.35, country: 'France' }), null,
    'an English country name that does not match is still a mismatch');

  /* A place saved before the code was recorded, under a name this page cannot
     place: that cannot be told apart from the same country in another
     language, so it is reported as unestablished rather than dropped. */
  const legacy = H.riskRow(outlook, Object.assign({ country: 'Deutschland' }, berlin));
  assert.ok(legacy, 'an unrecognised country name silently dropped the outlook');
  assert.match(legacy.applicability, /not one this page can recognise/i);
  assert.equal(H.countryComparable({ country: 'Deutschland' }), false);
  assert.equal(H.countryComparable({ country: 'France' }), true);
  assert.equal(H.countryComparable({ country: 'Deutschland', countryCode: 'DE' }), true);
});

test('a place with no coordinates is not measured from Null Island', () => {
  /* Number(null) is 0, and 0,0 is a real position in the Gulf of Guinea. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const quake = { type: 'Earthquake', lat: 0.1, lon: 0.1, proximityEligible: true };
  assert.equal(H.riskRow(quake, { name: 'Unlocated', lat: null, lon: null }), null,
    'a place with no coordinates was placed at 0,0 and given a distance');
  assert.equal(H.riskRow(quake, { name: 'Unlocated', lat: '', lon: '' }), null);
  const unlocatedEvent = { type: 'Flood', lat: null, lon: null, country: 'Ghana' };
  const row = H.riskRow(unlocatedEvent, { name: 'Accra', lat: 5.6, lon: -0.2 });
  assert.ok(!row || row.distanceKm === null,
    'a record with no coordinates was reported at a distance from a real home');
});

test('the country a place was found in is forgotten when the place changes', async () => {
  /* The geocoded country survived any later edit, so searching Paris and then
     pasting Tokyo's coordinates saved Tokyo as being in France — and a
     country-wide French outlook would then be shown for it while every
     Japanese one was withheld. */
  const r = await renderPage('personal-risk.html', { waitFor: d => !!d.getElementById('placeName') });
  const d = r.document, w = r.window;
  let asked = '';
  w.fetch = async (u) => String(u).includes('nominatim')
    ? (asked = String(u), { ok: true, json: async () => [{ lat: '48.85', lon: '2.35',
        display_name: 'Paris, France', address: { country: 'France', country_code: 'fr' } }] })
    : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ events: [], meta: {} }) };

  d.getElementById('placeName').value = 'Paris';
  d.getElementById('findPlace').click();
  await new Promise(res => setTimeout(res, 200));
  assert.equal(d.getElementById('lat').value, '48.850000', 'the search did not fill the coordinates');

  const save = () => {
    d.getElementById('f').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const all = JSON.parse(w.localStorage.getItem('pnd_saved_locations') || '[]');
    return all[all.length - 1];
  };

  /* The coordinates are replaced by hand before saving, which is the case
     that went wrong: the country from the search was still attached. */
  d.getElementById('placeName').value = 'Tokyo';
  const lat = d.getElementById('lat');
  lat.value = '35.68';
  lat.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('lon').value = '139.69';
  const moved = save();
  assert.equal(moved.lat, 35.68);
  assert.equal(moved.country, '',
    'a place moved to Tokyo was saved as being in France');
  assert.match(d.getElementById('placeResult').textContent, /no longer known/i,
    'nothing told the reader the country had been dropped');

  /* And saved straight from the search, the country is still recorded. */
  d.getElementById('placeName').value = 'Paris';
  d.getElementById('findPlace').click();
  await new Promise(res => setTimeout(res, 200));
  const found = save();
  assert.equal(found.country, 'France',
    'a place saved exactly as it was found lost the country it was found in');
  /* The name comes back in the browser's language, so the request asks for
     English and the place also keeps the code, which no language changes. */
  assert.match(asked, /accept-language=en/,
    'the place search does not ask for a canonical language');
  assert.equal(found.countryCode, 'FR',
    'the saved place carries no country code, so a localised name cannot be resolved');
  r.close();
});

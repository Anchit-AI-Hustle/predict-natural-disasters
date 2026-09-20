'use strict';
/**
 * What each hazard has to say about itself.
 *
 * The feed carried the same four fields for every record — deaths, displaced,
 * affected, alert — so an earthquake page never showed a magnitude and a
 * wildfire page never showed how much had burned, even where the upstream
 * record carried the number. GDACS in particular publishes its measurement as
 * a structured object whose unit changes with the hazard, and the API was
 * discarding it.
 *
 * The other half is what the sources do NOT publish. None of the connected
 * providers publishes a missing-or-unaccounted-for count, and an omitted count
 * rendered as blank reads as a zero, which is a claim nobody made. Those
 * fields are shown and marked not reported instead.
 *
 * And the homepage headed its hazard panel "Forecasts by Hazard Type" while
 * counting every tracked record under it — so 370 observed earthquakes read as
 * 370 earthquake forecasts. Nobody forecasts the onset of an earthquake, and
 * the panel now says what it is actually counting.
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
const handler = () => require(path.join(ROOT, 'api', 'events.js'));
const feed = async () => (await callApi(handler(), '/api/events')).json();

const byKey = (facts, k) => facts.find(f => f.key === k);

/* ------------------------------------------- the facts each hazard asks for */

test('an earthquake leads with magnitude, then lives lost, then the missing count', () => {
  const keys = H.keyFacts({ type: 'Earthquake', magnitude: 6.5, depthKm: 22.4, deaths: 21 })
    .map(f => f.key);
  for (const k of ['magnitude', 'deaths', 'missing']) {
    assert.ok(keys.includes(k), 'an earthquake should report ' + k);
  }
  assert.ok(keys.indexOf('magnitude') < keys.indexOf('deaths'),
    'the magnitude is the first thing a reader looks for');
  assert.ok(keys.indexOf('deaths') < keys.indexOf('missing'));
});

test('a wildfire leads with how much has burned, not with a magnitude', () => {
  const keys = H.keyFacts({ type: 'Wildfire', areaHa: 3150 }).map(f => f.key);
  assert.equal(keys[0], 'areaHa', 'the area is what a fire is measured by');
  assert.ok(!keys.includes('magnitude'), 'a fire has no magnitude');
  for (const k of ['deaths', 'missing']) assert.ok(keys.includes(k), 'a fire should report ' + k);
});

test('a cyclone reports its wind and the category that wind puts it in', () => {
  const f = H.keyFacts({ type: 'Tropical Cyclone', windKt: 100 });
  assert.equal(byKey(f, 'windKt').value, '100 kt');
  assert.equal(byKey(f, 'category').value, 'Category 3');
  assert.equal(H.cycloneCategory(137), 'Category 5');
  assert.equal(H.cycloneCategory(64), 'Category 1');
  assert.equal(H.cycloneCategory(40), 'Tropical storm');
  assert.equal(H.cycloneCategory(0), null, 'no wind reported is not a category');
});

test('a measurement is rendered with its unit', () => {
  const eq = H.keyFacts({ type: 'Earthquake', magnitude: 6.5, depthKm: 22.4 });
  assert.equal(byKey(eq, 'magnitude').value, '6.5');
  assert.equal(byKey(eq, 'depthKm').value, '22 km');
  // Hectares are what the fire feeds publish; past a square kilometre the
  // number is easier to hold in square kilometres.
  assert.equal(byKey(H.keyFacts({ type: 'Wildfire', areaHa: 3150 }), 'areaHa').value, '32 km²');
  assert.equal(byKey(H.keyFacts({ type: 'Wildfire', areaHa: 40 }), 'areaHa').value, '40 ha');
});

/* ------------------------------------- a figure nobody published is not zero */

test('a count no source publishes is marked not reported rather than shown as zero', () => {
  const f = H.keyFacts({ type: 'Earthquake', magnitude: 6.5, deaths: 21 });
  const missing = byKey(f, 'missing');
  assert.ok(missing, 'the missing count should still appear');
  assert.equal(missing.reported, false,
    'no connected provider publishes a missing count; claiming one would be inventing it');
  assert.equal(missing.value, null);
  assert.equal(byKey(f, 'deaths').reported, true);
  assert.equal(byKey(f, 'deaths').value, '21');
});

test('a reported zero is a reported figure, not a blank', () => {
  const f = H.keyFacts({ type: 'Flood', deaths: 0, affected: 120000 });
  assert.equal(byKey(f, 'deaths').reported, true, 'nobody died is a finding');
  assert.equal(byKey(f, 'deaths').value, '0');
  assert.equal(byKey(f, 'affected').value, '120,000', 'six figures need separators');
});

test('an earthquake with no USGS impact assessment says so', () => {
  const f = H.keyFacts({ type: 'Earthquake', magnitude: 3.1 });
  const pager = byKey(f, 'pagerAlert');
  assert.equal(pager.reported, false);
  assert.match(pager.note, /USGS/, 'the reason the field is empty belongs on the field');
  // This fixture record carries no tsunami flag either; see the dedicated test
  // below for why that is not the same as "Not raised".
  assert.equal(byKey(f, 'tsunamiFlag').reported, false);
});

/* ------------------------------ the measurement GDACS was publishing unread */

test('the GDACS wildfire measurement becomes a burned area', async () => {
  const { events } = await feed();
  const fire = events.find(e => /Attica/.test(String(e.title)) && e.source === 'GDACS');
  assert.ok(fire, 'fixture should include the GDACS wildfire');
  assert.equal(fire.areaHa, 3150, 'the hectares GDACS published should survive into the record');
  assert.equal(byKey(H.keyFacts(fire), 'areaHa').reported, true);
});

test('the GDACS cyclone measurement is converted into the unit the rest of the feed uses', async () => {
  const { events } = await feed();
  const tc = events.find(e => /RAI-26/.test(String(e.title)) && e.source === 'GDACS');
  assert.ok(tc, 'fixture should include the GDACS cyclone');
  // GDACS publishes 120 km/h; severity thresholds and every other provider
  // here are in knots, so a raw 120 would read as a category 4.
  assert.equal(tc.windKt, 65, '120 km/h is 65 kt');
  assert.equal(byKey(H.keyFacts(tc), 'category').value, 'Category 1');
});

test('a hazard GDACS publishes no measurement for gains no invented one', async () => {
  const { events } = await feed();
  const flood = events.find(e => /Bagmati/.test(String(e.title)));
  assert.ok(flood, 'fixture should include the GDACS flood');
  assert.equal(flood.areaHa, undefined);
  assert.equal(flood.windKt, undefined);
  assert.equal(flood.magnitude, undefined);
});

/* ------------------------------------------------------- and on the pages */

test('the detail page prints the facts for that hazard', async () => {
  const { events } = await feed();
  const eq = events.find(e => /Teluknaga/.test(String(e.title)) && !e.forecast);
  assert.ok(eq, 'fixture should include the Indonesia earthquake');
  const r = await renderPage('event-detail.html', {
    search: '?id=' + encodeURIComponent(eq.id),
    waitFor: d => (d.getElementById('keyFacts') || {}).children &&
      d.getElementById('keyFacts').children.length > 0
  });
  const grid = r.document.getElementById('keyFacts');
  const text = grid ? grid.textContent : '';
  r.close();
  assert.ok(grid && grid.children.length > 0, 'the detail page rendered no key facts');
  assert.match(text, /Magnitude/);
  assert.match(text, /6\.5/);
  assert.match(text, /Lives lost/);
  assert.match(text, /Missing or unaccounted for/);
  assert.match(text, /Not reported/,
    'the figure nobody published should say so on the page');
});

test('an event card carries the headline figures for its own hazard', async () => {
  const r = await renderPage('events.html', {
    url: '/events',
    waitFor: d => d.querySelectorAll('.event-card').length > 0
  });
  const cards = [...r.document.querySelectorAll('.event-card')].map(c => c.textContent);
  r.close();
  assert.ok(cards.length, 'the events page rendered no cards');
  const quake = cards.find(t => /Teluknaga/.test(t));
  assert.ok(quake, 'the Indonesia earthquake should be on the page');
  assert.match(quake, /Magnitude 6\.5/, 'a card for an earthquake should lead with its magnitude');
  const fire = cards.find(t => /Attica/.test(t));
  assert.ok(fire, 'the Greece wildfire should be on the page');
  assert.match(fire, /Area burned/, 'a card for a fire should say how much has burned');
});

/* --------------------------- the panel that claimed to forecast earthquakes */

test('the homepage hazard panel counts what it actually counts', () => {
  for (const page of ['index.html', 'home.html', 'home-v2.html', 'home-v3.html']) {
    const s = read(page);
    assert.ok(!/Forecasts by Hazard Type/.test(s),
      page + ' heads a count of every tracked record as a count of forecasts');
  }
  assert.match(read('index.html'), /Tracked Events by Hazard Type/);
});

test('a hazard nobody forecasts the onset of is labelled observed only', async () => {
  const r = await renderPage('index.html', {
    waitFor: d => (d.getElementById('hazardStrip') || {}).children &&
      d.getElementById('hazardStrip').children.length > 0
  });
  const strip = r.document.getElementById('hazardStrip');
  const quake = [...strip.children].find(el => /Earthquake/.test(el.textContent));
  const text = quake ? quake.textContent : '';
  const cls = quake ? quake.className : '';
  r.close();
  assert.ok(quake, 'the hazard strip should list earthquakes');
  assert.match(text, /observed only/,
    'the site counted earthquakes under a forecast heading while forecasting none');
  assert.match(cls, /hazard-observed/);
  assert.equal(H.HAZARDS.Earthquake.forecastable, false);
});

test('the styles the key-facts grid needs ship with every page that renders it', () => {
  for (const f of ['portal.css', 'app-pages.css']) {
    assert.match(read(f), /\.keyfact\b/, f + ' has no key-facts styling');
    assert.match(read(f), /\.hazard-observed\b/, f + ' cannot mark an observed-only hazard');
  }
});

/* ------------------------------------------ absence is not an authoritative no */

test('a tsunami flag is reported only where the source publishes one', () => {
  // Only the USGS parser supplies it. Thirty-three earthquake records in the
  // live feed come from EMSC, GDACS or a derived outlook and carry no flag at
  // all; "Not raised" on those would be an authoritative negative nobody
  // issued.
  const usgs = byKey(H.keyFacts({ type: 'Earthquake', magnitude: 6.5, tsunamiFlag: 0 }), 'tsunamiFlag');
  assert.equal(usgs.reported, true, 'a published 0 means no tsunami was flagged');
  assert.equal(usgs.value, 'Not raised');

  const raised = byKey(H.keyFacts({ type: 'Earthquake', magnitude: 7.9, tsunamiFlag: 1 }), 'tsunamiFlag');
  assert.equal(raised.value, 'Raised');

  const emsc = byKey(H.keyFacts({ type: 'Earthquake', magnitude: 5.1 }), 'tsunamiFlag');
  assert.equal(emsc.reported, false, 'no flag from this source is not "Not raised"');
  assert.equal(emsc.value, null);
  assert.match(emsc.note, /United States Geological Survey/);
});

test('a source that publishes no casualty count is not given a zero', async () => {
  const { events } = await feed();
  // The GDACS cyclone and wildfire fixtures carry no casualty fields, exactly
  // as the live endpoint does: all 100 GDACS records were arriving with
  // `deaths: 0` manufactured by `+(p.death || 0) || 0`, and the card then read
  // "Lives lost 0".
  const tc = events.find(e => /RAI-26/.test(String(e.title)) && e.source === 'GDACS');
  assert.ok(tc, 'fixture should include the GDACS cyclone');
  assert.equal(tc.deaths, undefined, 'an absent death count should stay absent');
  assert.equal(tc.displaced, undefined);
  assert.equal(tc.affected, undefined);
  assert.equal(byKey(H.keyFacts(tc), 'deaths').reported, false);

  // And a source that does publish them still carries them, zeros included.
  const flood = events.find(e => /Bagmati/.test(String(e.title)));
  assert.equal(flood.deaths, 42);
  assert.equal(flood.affected, 120000);
  assert.equal(byKey(H.keyFacts(flood), 'deaths').value, '42');
});

test('no card or grid prints a zero for a count its source never published', async () => {
  const r = await renderPage('events.html', {
    url: '/events',
    waitFor: d => d.querySelectorAll('.event-card').length > 0
  });
  const cards = [...r.document.querySelectorAll('.event-card')].map(c => c.textContent);
  r.close();
  const claimed = cards.filter(t => /Lives lost 0\b|People displaced 0\b|People affected 0\b/.test(t));
  assert.deepEqual(claimed, [], 'these cards state a zero nobody reported');
});

/* ----------------------------------- one event, two places, two separate rows */

test('an event near two saved places is listed once for each of them', async () => {
  // The rows are (place, event) pairs. Sorting the shared event objects and
  // mapping back by identity returned the first matching row twice, so one
  // place was duplicated and the other silently dropped.
  const { events } = await feed();
  const anchor = events.find(e => !e.forecast && Number.isFinite(+e.lat) && Number.isFinite(+e.lon));
  assert.ok(anchor, 'fixture should include a placed record');
  const places = JSON.stringify([
    { id: 'p1', kind: 'Home', name: 'Nearer place', lat: +anchor.lat + 0.2, lon: +anchor.lon },
    { id: 'p2', kind: 'Family', name: 'Farther place', lat: +anchor.lat + 1.2, lon: +anchor.lon }
  ]);

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: places },
    waitFor: d => d.querySelectorAll('#risks .card').length > 0
  });
  const rows = [...r.document.querySelectorAll('#risks .card')].map(c => c.textContent);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  r.close();

  assert.ok(rows.some(t => /Nearer place/.test(t)), 'the nearer place has no risk row');
  assert.ok(rows.some(t => /Farther place/.test(t)), 'the farther place was dropped from the list');
  // Every row is a distinct pair, so no (place, event) line repeats verbatim.
  assert.equal(new Set(rows).size, rows.length, 'the same row was rendered twice');
});

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
  const area = ha => byKey(H.keyFacts({ type: 'Wildfire', areaHa: ha }), 'areaHa').value;
  assert.equal(area(40), '40 ha');
  assert.equal(area(3150), '31.5 km²');
  // Dividing by 100 and then rounding to a whole number reported a third more
  // ground than burned.
  assert.equal(area(150), '1.5 km²');
  assert.equal(area(250), '2.5 km²');
  // Past a hundred square kilometres the fraction is noise; separators are not.
  assert.equal(area(120000), '1,200 km²');
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
  // The converted value is kept, not rounded: rounding at conversion time
  // decides the category before anything classifies it.
  assert.ok(Math.abs(tc.windKt - 120 / 1.852) < 1e-9, '120 Kph is 64.79 kt, got ' + tc.windKt);
  assert.equal(byKey(H.keyFacts(tc), 'windKt').value, '64.8 kt');
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
  // An explicitly null or empty count is still nothing reported: Number(null)
  // is 0, so this has to be rejected before it is parsed.
  const fire = events.find(e => /Attica/.test(String(e.title)) && e.source === 'GDACS');
  assert.equal(fire.deaths, undefined, 'death: null became a reported zero');
  assert.equal(fire.displaced, undefined, "displaced: '' became a reported zero");
  assert.equal(fire.affected, undefined);

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
  // Band A is the only band that states a distance, so the anchor has to be a
  // record whose coordinate is the incident. Picking any placed record used to
  // work only because every record was treated as one.
  const anchor = events.find(e => e.proximityEligible && !e.forecast &&
    Number.isFinite(+e.lat) && Number.isFinite(+e.lon));
  assert.ok(anchor, 'fixture should include an incident-located record');
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

/* --------------------------- one page, one answer for the same number */

test('a reported zero reads the same in the grid and in the panel below it', async () => {
  const { events } = await feed();
  const flood = events.find(e => /Bagmati/.test(String(e.title)));
  assert.ok(flood, 'fixture should include the GDACS flood');

  const r = await renderPage('event-detail.html', {
    search: '?id=' + encodeURIComponent(flood.id),
    waitFor: d => (d.getElementById('keyFacts') || {}).children &&
      d.getElementById('keyFacts').children.length > 0
  });
  const doc = r.document;
  // The impact panel tested `+v > 0`, so a source that reported zero deaths was
  // shown as having reported nothing — directly under a grid showing the zero.
  const panel = (doc.getElementById('deaths') || {}).textContent;
  const grid = doc.getElementById('keyFacts').textContent;
  r.close();
  assert.equal(panel, '42', 'the panel should carry the reported figure');
  assert.match(grid, /42/);
});

test('the impact panel distinguishes a reported zero from an absent count', async () => {
  const r = await renderPage('event-detail.html', {
    search: '?id=nope-not-a-real-id',
    waitFor: d => !!d.getElementById('deaths')
  });
  // JSON rather than an array: a value built inside jsdom has that realm's
  // Array prototype, which deepStrictEqual rejects on identity alone.
  const n = JSON.parse(r.window.eval(
    "JSON.stringify([n(0), n(undefined), n(null), n(''), n(5)])"));
  r.close();
  assert.deepEqual(n, ['0', 'Not reported', 'Not reported', 'Not reported', '5'],
    'a published zero is a finding; an absent field is not');
});

/* ---------------------- the ledger sorts by the field its rows actually use */

test('the verification ledger ranks observed severity, not an absent alert', () => {
  const s = read('accuracy.html');
  assert.match(s, /OBSERVED_RANK/,
    'the shared comparator reads severityRank/alert, which ledger rows do not carry');
  assert.match(s, /CATASTROPHIC:\s*6/, 'the ledger has its own severity vocabulary');
  assert.ok(!/LEDGER_SORTS=\[[^\]]*'severity'/.test(s),
    "the generic 'severity' key ranks every ledger row 0");
  assert.match(s, /LEDGER_SORTS=\[[^\]]*'observed'/);
});

/* ------------------- a merge must not throw away what only one agency has */

test('merging two agencies keeps the measurements only one of them published', async () => {
  const { events } = await feed();
  const quakes = events.filter(e => /Cianjur|West Java/.test(String(e.title)) && !e.forecast);
  assert.equal(quakes.length, 1, 'the two agency reports should merge into one record');

  const q = quakes[0];
  // GDACS leads because it reports a death toll, and GDACS publishes no depth,
  // no PAGER assessment and no tsunami flag. Before this, leading meant the
  // USGS record was dropped with all three, and the page then read "USGS issued
  // no impact assessment" while naming USGS as corroboration.
  assert.equal(q.source, 'GDACS', 'the record reporting impact should lead');
  assert.ok(q.corroboratedBy.includes('USGS'), 'USGS should be named as corroboration');
  assert.equal(q.depthKm, 11, 'the USGS depth was discarded');
  assert.equal(q.pagerAlert, 'yellow', 'the USGS impact assessment was discarded');
  assert.equal(q.tsunamiFlag, false, 'the USGS tsunami flag was discarded');
  assert.equal(q.deaths, 21, 'the leading record keeps its own impact figures');

  // The alert level is read off the PAGER assessment, so a record that has just
  // inherited one cannot keep the level it carried without it.
  assert.equal(q.alert, 'Orange', 'a yellow PAGER assessment maps to Orange');

  const facts = H.keyFacts(q);
  assert.equal(byKey(facts, 'pagerAlert').reported, true,
    'the page would claim USGS made no assessment while citing USGS');
  assert.equal(byKey(facts, 'depthKm').value, '11 km');
  assert.equal(byKey(facts, 'tsunamiFlag').value, 'Not raised');
});

test('an empty GDACS measurement is not published as a measurement of zero', async () => {
  // severitydata.severity arriving as '' would coerce to 0 and print
  // "Magnitude 0.0" or "0 kt" as though the agency had measured it.
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  const src = fs.readFileSync(path.join(ROOT, 'api', 'events.js'), 'utf8');
  assert.match(src, /raw === undefined \|\| raw === null \|\| raw === ''/,
    'gdacsMeasurement needs the same pre-coercion guard as reportedCounts');
  assert.ok(handler, 'handler should still load');
  const { events } = await feed();
  const bogus = events.filter(e => e.magnitude === 0 || e.windKt === 0 || e.areaHa === 0);
  assert.deepEqual(bogus.map(e => e.title), [], 'a measurement of zero was published');
});

/* ------------------------- the authority's own words, and its own assessment */

test('a volcano quotes the observatory level, not the colour this site maps it to', async () => {
  const { events } = await feed();
  const usgs = events.find(e => e.source === 'USGS Volcano Hazards Program' && !e.forecast);
  assert.ok(usgs, 'fixture should include a USGS volcano notice');
  assert.ok(usgs.alertLevel, 'the observatory level should survive onto the record');
  const f = byKey(H.keyFacts(usgs), 'alertLevel');
  assert.equal(f.reported, true);
  assert.equal(f.value, usgs.alertLevel, 'the panel should quote the level verbatim');
  assert.ok(!/^(Red|Orange|Green)$/.test(f.value),
    'this renames the observatory\'s assessment into a UI colour: ' + f.value);

  // Every EONET volcano carries alert 'Green' because the parser assigns one;
  // EONET publishes no observatory level at all, so a panel headed
  // "Observatory alert level" must not print it.
  const eonet = events.find(e => e.source === 'NASA EONET' && /Volcano/i.test(String(e.type)));
  assert.ok(eonet, 'fixture should include an EONET volcano');
  assert.equal(eonet.alert, 'Green', 'the parser still assigns a colour for the map');
  const g = byKey(H.keyFacts(eonet), 'alertLevel');
  assert.equal(g.reported, false, 'EONET never issued an observatory level');
  assert.match(g.note, /publishes no observatory alert level/);
});

test('an issued cyclone alert is not overridden by a lower wind reading', () => {
  // A weakening or slow-moving cyclone can carry a Red alert well under 64 kt
  // because of surge, rainfall or where it is heading. Returning on the wind
  // alone rated that Minor, discarding the authority's own assessment.
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', alert: 'Red', windKt: 40 }), 'Severe');
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', alert: 'Red' }), 'Severe',
    'the same alert without a wind reading must not rate higher than with one');
  // And the wind still wins where it is the worse of the two.
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', alert: 'Green', windKt: 100 }), 'Severe');
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', windKt: 130 }), 'Extreme');
});

test('the ledger sorts hazards by the field its observed rows actually use', () => {
  const s = read('accuracy.html');
  assert.match(s, /SORT_DEFS\.hazard=/,
    'observed ledger rows store their classification in hazard, not type');
  assert.match(s, /a\.hazard\|\|a\.type/);
  assert.ok(!/LEDGER_SORTS=\[[^\]]*'type'/.test(s),
    "the shared 'type' comparator sorts every observed row as a missing value");
});

/* ------------------------- a merge may raise an assessment, never lower one */

const { mergeSeismicReports } = require(path.join(ROOT, 'api', 'events.js'));
const quake = (o) => Object.assign({
  type: 'Earthquake', startedAt: '2026-09-12T11:30:00Z',
  lat: -6.8, lon: 107.1, magnitude: 5.6, sourceUrl: 'x', country: 'Indonesia'
}, o);

test('a merge never lowers the graver of two agencies’ assessments', () => {
  // Carrying the PAGER assessment onto a non-USGS leader also recomputed its
  // alert from that assessment alone, so a GDACS Red paired with a yellow PAGER
  // was published as Orange — a published authority alert, downgraded.
  const [red] = mergeSeismicReports([
    quake({ id: 'g', source: 'GDACS', alert: 'Red', deaths: 21 }),
    quake({ id: 'u', source: 'USGS', alert: 'Orange', pagerAlert: 'yellow', depthKm: 11 })
  ]);
  assert.equal(red.source, 'GDACS');
  assert.equal(red.alert, 'Red', 'the graver assessment was lowered to match the PAGER level');

  // And it must still be raised where the PAGER assessment is the graver one:
  // a leader that has inherited an assessment cannot keep the Green it carried
  // before it had one.
  const [green] = mergeSeismicReports([
    quake({ id: 'g', source: 'GDACS', alert: 'Green', deaths: 21 }),
    quake({ id: 'u', source: 'USGS', alert: 'Orange', pagerAlert: 'orange', depthKm: 11 })
  ]);
  assert.equal(green.alert, 'Orange');
});

test('a merge keeps an impact figure the leader never reported, zero included', () => {
  // reportRank weighs impact with a truthy test, so an agency reporting an
  // explicit zero gets no credit for it and need not lead — and that reported
  // zero, which is a finding, went with its record.
  const [out] = mergeSeismicReports([
    quake({ id: 'g', source: 'GDACS', alert: 'Green', deaths: 0, affected: 0 }),
    quake({ id: 'u', source: 'USGS', alert: 'Green', depthKm: 11 })
  ]);
  assert.equal(out.source, 'USGS', 'agency priority should still decide the lead');
  assert.equal(out.deaths, 0, 'a reported zero was discarded with the record that reported it');
  assert.equal(out.affected, 0);
  assert.equal(byKey(H.keyFacts(out), 'deaths').reported, true);
  assert.equal(byKey(H.keyFacts(out), 'deaths').value, '0');

  // A leader's own figure is never overwritten by another agency's.
  const [own] = mergeSeismicReports([
    quake({ id: 'g', source: 'GDACS', alert: 'Green', deaths: 3 }),
    quake({ id: 'u', source: 'USGS', alert: 'Green', deaths: 7, depthKm: 11 })
  ]);
  assert.equal(own.deaths, 7, 'the leading agency keeps its own count');
});

/* ------------------------------- adding information must never lower a rating */

test('no assessment added to a record can make it less severe', () => {
  // This class of bug has now appeared three times in this file: the cyclone
  // wind reading, the merged alert, and the PAGER value. Each was a branch that
  // returned on the first assessment it matched, so a record could be made
  // milder by adding a milder assessment to it. The property is the fix; the
  // three instances were symptoms.
  const bases = [
    {}, { alert: 'Red' }, { alert: 'Orange' }, { alert: 'Watch' },
    { type: 'Tropical Cyclone', alert: 'Red' },
    { type: 'Tropical Cyclone', windKt: 130 },
    { type: 'Earthquake', magnitude: 6.9 },
    { type: 'Earthquake', pagerAlert: 'red' },
    { deaths: 12 }, { deaths: 0 }, { affected: 250 }
  ];
  const additions = [
    { pagerAlert: 'yellow' }, { pagerAlert: 'orange' }, { pagerAlert: 'red' },
    { windKt: 30 }, { windKt: 70 }, { windKt: 130 },
    { alert: 'Watch' }, { alert: 'Moderate' }, { alert: 'Orange' }, { alert: 'Red' },
    { magnitude: 3.1 }, { magnitude: 7.8 },
    { deaths: 0 }, { deaths: 3 }, { affected: 10 }
  ];

  const worse = [];
  for (const base of bases) {
    const before = H.severityRank(base);
    for (const extra of additions) {
      // Only ever adds a field the base does not already state.
      const merged = Object.assign({}, extra, base);
      const after = H.severityRank(merged);
      if (after < before) {
        worse.push(JSON.stringify(base) + ' + ' + JSON.stringify(extra) +
          ' : ' + before + ' -> ' + after);
      }
    }
  }
  assert.deepEqual(worse, [],
    'adding an assessment lowered the severity rank:\n' + worse.join('\n'));
});

test('a record published Red keeps a Red-level severity whatever else is on it', () => {
  // A merged earthquake published Red by one agency and assessed yellow by USGS
  // rated Moderate, so its badge and its place in every severity-ordered list
  // disagreed with its own alert label.
  assert.equal(H.severityOf({ alert: 'Red', pagerAlert: 'yellow' }), 'Severe');
  assert.equal(H.severityOf({ alert: 'Red' }), 'Severe');
  // And a graver PAGER assessment still raises it above the alert alone.
  assert.equal(H.severityOf({ alert: 'Red', pagerAlert: 'red' }), 'Extreme');
});

/* ------------------- the grid may not contradict the text beside it */

test('an aftershock outlook states the mainshock magnitude its own text quotes', async () => {
  const { events } = await feed();
  const a = events.find(e => e.forecastKind === 'aftershock-sequence');
  assert.ok(a, 'fixture should produce an aftershock outlook');

  const quoted = /\bM\s?(\d+(?:\.\d+)?)/.exec(String(a.details));
  assert.ok(quoted, 'the outlook narrative should quote the mainshock magnitude');

  const f = byKey(H.keyFacts(a), 'mainshockMagnitude');
  assert.ok(f, 'an aftershock outlook should report the magnitude it follows');
  assert.equal(f.reported, true,
    'the grid read "Not reported" while the text beside it quoted M' + quoted[1]);
  assert.equal(f.value, Number(quoted[1]).toFixed(1));

  // It is the mainshock's magnitude, not the outlook's: an outlook labelled
  // plain "Magnitude" would read as a forecast of a quake that size.
  assert.equal(f.label, 'Mainshock magnitude');
  assert.equal(a.magnitude, undefined, 'an outlook has no magnitude of its own');
});

test('no record reports a figure as absent while its own narrative states it', async () => {
  const { events } = await feed();
  const contradictions = [];
  for (const e of events) {
    if (!/earthquake/i.test(String(e.type))) continue;
    const quoted = /\bM\s?(\d+(?:\.\d+)?)\b/.exec(String(e.details || ''));
    if (!quoted) continue;
    const facts = H.keyFacts(e);
    const mag = facts.find(f => f.key === 'magnitude' || f.key === 'mainshockMagnitude');
    if (!mag) continue;
    if (!mag.reported) {
      contradictions.push(e.id + ': text says M' + quoted[1] + ', grid says "' +
        mag.label + ' — Not reported"');
    }
  }
  assert.deepEqual(contradictions, [],
    'the grid contradicts the narrative beside it:\n' + contradictions.join('\n'));
});

/* ---------------- the facts must appear on the page the router actually opens */

/** The route prefixes PND.eventUrl() can produce, read from portal.js itself. */
function routePrefixes() {
  const src = read('portal.js');
  const fn = /eventUrl\(e\)\{[\s\S]*?\}/.exec(src);
  assert.ok(fn, 'portal.js no longer defines eventUrl');
  return [...new Set([...fn[0].matchAll(/'(\/[a-z]+)\//g)].map(m => m[1] + '/'))];
}

/** Which template each prefix is rewritten to, read from vercel.json. */
function templateFor(prefix) {
  const v = JSON.parse(read('vercel.json'));
  const r = (v.rewrites || []).find(x => x.source.startsWith(prefix) && /:id/.test(x.source));
  assert.ok(r, 'vercel.json has no rewrite for ' + prefix);
  return r.destination.replace(/^\//, '').split('?')[0] + '.html';
}

test('every record shows its hazard facts on the page its own link opens', async () => {
  const { events } = await feed();
  const prefixes = routePrefixes();
  assert.ok(prefixes.length >= 3,
    'eventUrl routes to ' + prefixes.length + ' places; each needs the grid');

  // The rule eventUrl applies, kept beside the assertion it drives.
  const routeOf = e => e.forecast ? '/forecasts/'
    : (e.sourceType === 'official' && ['Red', 'Orange'].includes(e.alert)) ? '/alerts/'
      : '/disasters/';

  const bare = [];
  for (const prefix of prefixes) {
    const sample = events.find(e => routeOf(e) === prefix && H.keyFacts(e).some(f => f.reported));
    assert.ok(sample, 'no record in the fixture routes to ' + prefix);
    const page = templateFor(prefix);

    const r = await renderPage(page, {
      search: '?id=' + encodeURIComponent(sample.id),
      waitFor: d => d.querySelectorAll('#keyFacts .keyfact').length > 0
    });
    const n = r.document.querySelectorAll('#keyFacts .keyfact').length;
    r.close();
    // Red and Orange official records route to /alerts/, so a grid added only to
    // event-detail.html reached everything except the highest-severity records.
    if (!n) bare.push(prefix + ' -> ' + page + ' (' + sample.title + ')');
  }
  assert.deepEqual(bare, [],
    'these pages open without the hazard facts:\n' + bare.join('\n'));
});

test('no detail template treats a reported zero as an absent figure', () => {
  const offenders = fs.readdirSync(ROOT)
    .filter(f => /-detail\.html$/.test(f))
    .filter(f => /Number\.isFinite\(\+v\)\s*&&\s*\+v\s*>\s*0/.test(read(f)));
  assert.deepEqual(offenders, [],
    'a source reporting zero has reported something: ' + offenders.join(', '));
});

/* --------------------------- a unit is recognised, or the measurement is dropped */

test('every spelling of a wind unit converts to knots, and an unknown one is refused', () => {
  const src = read('api/events.js');
  const fns = (/function normaliseUnit[\s\S]*?\n}/.exec(src) || [''])[0] +
    (/function knotsFactor[\s\S]*?\n}/.exec(src) || [''])[0] +
    (/function hectaresFactor[\s\S]*?\n}/.exec(src) || [''])[0];
  assert.ok(/knotsFactor/.test(fns) && /hectaresFactor/.test(fns),
    'api/events.js should enumerate its units rather than test for a substring');
  const { knotsFactor, hectaresFactor } = (0, eval)(fns +
    ';({knotsFactor: knotsFactor, hectaresFactor: hectaresFactor})');

  // 120 units of wind, in each spelling. GDACS is reported to label this Kph,
  // which a test for the substring "km/h" does not match — so the value passed
  // through as 120 knots and a tropical storm was published as a category 4.
  const kt = u => { const f = knotsFactor(u); return f === null ? null : Math.round(120 * f); };
  for (const u of ['Kph', 'kph', 'KPH', 'km/h', 'KM/H', 'kmh', 'kmph', 'km/hr']) {
    assert.equal(kt(u), 65, u + ' was not converted to knots');
  }
  for (const u of ['kt', 'kts', 'kn', 'Knots']) {
    assert.equal(kt(u), 120, u + ' is already knots and must not be converted');
  }
  // An unrecognised unit is not a licence to assume one.
  for (const u of ['', 'furlongs', 'unknown', null, undefined]) {
    assert.equal(knotsFactor(u), null, JSON.stringify(u) + ' should not be guessed at');
  }

  const ha = u => { const f = hectaresFactor(u); return f === null ? null : Math.round(3150 * f); };
  assert.equal(ha('ha'), 3150);
  assert.equal(ha('Hectares'), 3150);
  assert.equal(ha('km2'), 315000);
  assert.equal(ha('km²'), 315000);
  assert.equal(ha('sqkm'), 315000);
  assert.equal(hectaresFactor('blorks'), null);
});

test('a cyclone published in kilometres per hour is not rated a category higher', async () => {
  const { events } = await feed();
  const tc = events.find(e => /RAI-26/.test(String(e.title)) && e.source === 'GDACS');
  assert.ok(tc, 'fixture should include the GDACS cyclone');
  // 120 Kph is 65 kt: a category 1. Read as 120 kt it is a category 4, and the
  // severity scale would call it Extreme.
  assert.ok(Math.abs(tc.windKt - 120 / 1.852) < 1e-9, 'expected 64.79 kt, got ' + tc.windKt);
  assert.equal(H.cycloneCategory(tc.windKt), 'Category 1');
  assert.notEqual(H.severityOf(tc), 'Extreme',
    'a tropical storm was being published as a category 4');
});

test('a measurement whose unit is not recognised is left off the record', async () => {
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  assert.ok(handler);
  const src = read('api/events.js');
  // The measurement is only set when the factor resolves; nothing falls through
  // to "assume the unit we wanted".
  assert.match(src, /if \(f !== null\) out\.windKt/);
  assert.match(src, /if \(f !== null\) out\.areaHa/);
});

/* ----------------- rounding may change how a figure reads, never what it is */

test('converting a wind speed never promotes a cyclone across a category boundary', () => {
  // 118 Kph is 63.7 kt, a tropical storm. Rounded to 64 kt it is a category 1.
  // Rounding at conversion time decided the category before anything classified
  // it, so the sweep checks the whole range rather than that one value.
  const toKt = kph => kph / 1.852;
  const wrong = [];
  for (let kph = 20; kph <= 300; kph++) {
    const exact = toKt(kph);
    if (H.cycloneCategory(Math.round(exact)) !== H.cycloneCategory(exact)) {
      wrong.push(kph + ' Kph: ' + exact.toFixed(2) + ' kt is ' + H.cycloneCategory(exact) +
        ', rounded to ' + Math.round(exact) + ' kt it is ' + H.cycloneCategory(Math.round(exact)));
    }
  }
  assert.ok(wrong.length > 0,
    'if no wind speed rounds across a boundary this test proves nothing');

  // The feed must classify on the converted value, not the rounded one.
  for (const line of wrong) {
    const kph = Number(line.split(' ')[0]);
    const e = { type: 'Tropical Cyclone', windKt: toKt(kph) };
    assert.equal(byKey(H.keyFacts(e), 'category').value, H.cycloneCategory(toKt(kph)),
      'classified on a rounded wind: ' + line);
  }
});

test('the wind a page prints never contradicts the category printed beside it', () => {
  const bad = [];
  for (let kph = 20; kph <= 300; kph++) {
    const e = { type: 'Tropical Cyclone', windKt: kph / 1.852 };
    const facts = H.keyFacts(e);
    const shown = Number(String(byKey(facts, 'windKt').value).replace(/[^\d.]/g, ''));
    const category = byKey(facts, 'category').value;
    // Reading the printed number back must land in the category printed with it.
    if (H.cycloneCategory(shown) !== category) {
      bad.push(kph + ' Kph prints ' + shown + ' kt beside "' + category +
        '", but ' + shown + ' kt is "' + H.cycloneCategory(shown) + '"');
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));

  // A source that publishes whole knots still prints whole knots.
  assert.equal(byKey(H.keyFacts({ type: 'Tropical Cyclone', windKt: 105 }), 'windKt').value, '105 kt');
});

test('summing an empty set is not a reported figure', () => {
  const s = read('verification-detail.html');
  // reduce(..., 0) over records that carry no deaths yields 0, and the
  // presence-based formatter added earlier in this branch then published that
  // synthetic zero as "Lives lost 0".
  assert.match(s, /anyDeaths/,
    'the aggregate needs to know whether any record supplied the field');
  assert.ok(!/const deaths=ev\.reduce\(/.test(s),
    'the sum is published without checking that anything was summed');
});

/* ---------- the gravest assessment survives, whichever agency ends up leading */

test('a merged record keeps the gravest alert any member published', () => {
  // Only one direction was handled before: a GDACS Red that happened to lead
  // kept its Red, but a GDACS Red with no impact count loses the lead to USGS
  // on agency priority, and its Red then vanished from a record that still
  // named GDACS as corroboration. Both directions are the same rule, so the
  // test sweeps every combination rather than the one that was reported.
  const RANK = { Green: 1, Watch: 1, Moderate: 2, Orange: 3, High: 3, Red: 4 };
  const levels = ['Green', 'Moderate', 'Orange', 'Red'];
  const impacts = [undefined, 0, 21];
  const lost = [];

  for (const gAlert of levels) {
    for (const uAlert of levels) {
      for (const deaths of impacts) {
        const members = [
          quake(Object.assign({ id: 'g', source: 'GDACS', alert: gAlert },
            deaths === undefined ? {} : { deaths })),
          quake({ id: 'u', source: 'USGS', alert: uAlert, depthKm: 11 })
        ];
        const [out] = mergeSeismicReports(members);
        const want = Math.max(RANK[gAlert], RANK[uAlert]);
        if ((RANK[out.alert] || 0) < want) {
          lost.push(`GDACS ${gAlert} (deaths ${deaths}) + USGS ${uAlert}` +
            ` -> lead ${out.source}, alert ${out.alert}`);
        }
      }
    }
  }
  assert.deepEqual(lost, [],
    'the graver agency assessment was dropped:\n' + lost.join('\n'));
});

test('an alert raised by the merge is ordered as the alert it became', async () => {
  // The feed is sorted by alert before records are merged, and a leader that
  // inherits a graver assessment changes alert after that — so a newly Red
  // record kept the position it held while it was Green.
  const { events } = await feed();
  const RANK = { Red: 4, Orange: 3, High: 3, Moderate: 2, Watch: 1, Green: 1 };
  const out = [];
  for (let i = 1; i < events.length; i++) {
    const prev = RANK[events[i - 1].alert] || 0;
    const here = RANK[events[i].alert] || 0;
    if (here > prev) out.push(events[i].alert + ' (' + events[i].title + ') sits behind ' +
      events[i - 1].alert + ' (' + events[i - 1].title + ')');
  }
  assert.deepEqual(out, [], 'the feed is not ordered by alert:\n' + out.slice(0, 5).join('\n'));

  const src = read('api/events.js');
  const merged = src.indexOf('mergeSeismicReports(out.events)');
  const sorted = src.lastIndexOf('out.events.sort(byAlertThenTime)');
  assert.ok(merged >= 0, 'the seismic merge must run over the whole feed');
  assert.ok(sorted > merged,
    'the feed must be re-sorted after a merge can change an alert');
});

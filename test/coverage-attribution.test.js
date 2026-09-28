'use strict';
/*
 * Who was in a position to see it, and when.
 *
 * Five findings from Codex on the first round of the verification engine, all
 * of them the same kind of mistake: a check that looked like it was verifying
 * something and could not fail, or an absence read as evidence when nothing
 * had been watching.
 *
 *   - covers() was handed a classifier that returned the event's own hazard,
 *     so the hazard comparison was unfalsifiable and an earthquake prediction
 *     could be credited with predicting a flood.
 *   - a provider was credited with covering a disaster on its hazard list
 *     alone, so NWS "covered" a flood in Nepal and the engine blamed the
 *     forecaster for a gap in the sources.
 *   - observation coverage came from the observed ledger's updatedAt, which
 *     advances on every run including ones where a hazard's providers were
 *     down.
 *   - a returning disaster was recognised by a generated id built from
 *     coordinates and onset, both of which move when better evidence arrives.
 *   - the ledger writer dropped forecastScope, so a country-wide outlook was
 *     later graded as though it had named a point.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const V = require('../verification-model.js');
const OBS = require('../observed-model.js');
const { callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async (mock) => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', mock)).json();

const flood = over => Object.assign({
  canonicalEventId: 'OBS-flood-NEP-1', hazard: 'flood', significant: true,
  onset: '2026-09-03T00:00:00Z',
  geography: { country: 'Nepal', lat: 27.7, lon: 85.3 }
}, over || {});

const quakePrediction = over => Object.assign({
  id: 'OUT-q1', type: 'Earthquake', title: 'Earthquake outlook — Nepal',
  country: 'Nepal', region: null, lat: 27.7, lon: 85.3,
  forecastClass: 'independent-prospective', freezeTimestamp: '2026-09-01T00:00:00Z',
  targetStart: '2026-09-02T00:00:00Z', targetEnd: '2026-09-05T00:00:00Z'
}, over || {});

/* The scan runs an hour BEFORE the disaster: only a scan at or before onset
   shows anyone was in a position to forecast it, so a fixture that scans
   afterwards tests the opposite of what these cases are about. */
const ledgerWith = providers => ({
  providers: providers,
  retention: { detailFrom: '2026-09-01T00:00:00Z' },
  scans: [{ scanTimestamp: '2026-09-02T23:00:00Z',
    providers: Object.keys(providers).map(k => ({ provider: k, status: 'SCANNED' })) }]
});

/* ------------------------------- a prediction's own hazard is compared */

test('an earthquake prediction cannot have predicted a flood', () => {
  const led = ledgerWith({ gdacs: { hazards: ['Flood', 'Earthquake'], scope: { kind: 'global' } } });
  const a = V.assessCoverage(flood(), [quakePrediction()], led, { hazardFamilyOf: OBS.familyOf });
  assert.equal(a.falseNegative, true,
    'an earthquake prediction was credited with predicting a flood in the same place and window');
  assert.deepEqual(a.matched, []);

  // Control: the same prediction, for the hazard that actually happened.
  const fc = quakePrediction({ id: 'OUT-f1', type: 'Flood', title: 'Flood outlook — Nepal' });
  const b = V.assessCoverage(flood(), [fc], led, { hazardFamilyOf: OBS.familyOf });
  assert.equal(b.falseNegative, false, 'a matching flood prediction was not credited');
  assert.equal(b.matched[0].result, 'HIT');
});

test('without a way to classify the prediction nothing is credited', () => {
  const led = ledgerWith({ gdacs: { hazards: ['Flood'], scope: { kind: 'global' } } });
  const fc = quakePrediction({ id: 'OUT-f1', type: 'Flood' });
  const a = V.assessCoverage(flood(), [fc], led);   // no classifier supplied
  assert.equal(a.falseNegative, true,
    'a prediction was credited although its hazard could not be compared');
});

/* ------------------------------- a provider has to reach the place too */

test('a provider is not credited with watching a place it does not cover', () => {
  const usOnly = ledgerWith({ nws: { hazards: ['Flood'], scope: { kind: 'countries', countries: ['United States'] } } });
  const a = V.assessCoverage(flood(), [], usOnly, { hazardFamilyOf: OBS.familyOf });
  assert.notEqual(a.status, 'FORECAST_FAILURE',
    'a flood in Nepal was blamed on the forecaster when only a US-only provider was up');
  assert.equal(a.status, 'COVERAGE_FAILURE');

  // The same disaster, with a genuinely global flood provider up - and one
  // that states what is expected rather than what has happened, since a
  // catalogue of floods already under way puts nobody in a position to
  // forecast one - is the forecaster's to answer for.
  const global = ledgerWith({ gdacs: { hazards: ['Flood'], scope: { kind: 'global' },
    inputKind: 'forecast' } });
  assert.equal(V.assessCoverage(flood(), [], global, { hazardFamilyOf: OBS.familyOf }).status,
    'FORECAST_FAILURE');
});

test('a catalogue of what has happened cannot have forecast anything', () => {
  /* The not-forecastable exception only covers hazards nobody forecasts at
     all. For a forecastable one - a flood, a wildfire, a drought - any
     completed scan counted as the engine having had its chance, whatever was
     scanned. But EONET, GDACS and ReliefWeb report events that already
     exist, and the only outlook this project derives from such a record is
     that the hazard continues, so scanning them before onset put nobody in a
     position to forecast an onset. Every such disaster was being labelled a
     forecasting failure. */
  const catalogue = ledgerWith({ eonet: { label: 'NASA EONET', hazards: ['Flood'],
    scope: { kind: 'global' }, inputKind: 'observation' } });
  const a = V.assessCoverage(flood(), [], catalogue, { hazardFamilyOf: OBS.familyOf });
  assert.equal(a.status, 'NO_PROSPECTIVE_INPUT',
    'a flood nothing could have forecast was blamed on the forecaster');
  assert.equal(a.falseNegative, true,
    'it still happened and nothing predicted it: that is still a false negative');
  assert.match(a.reason, /already happened/i);
  assert.match(a.reason, /not as a failure of our forecasts/i);

  /* A source that says what is expected is a different thing, and with one of
     those up the same disaster is the forecaster's to answer for. */
  const forecasting = ledgerWith({ gdacs: { label: 'GDACS', hazards: ['Flood'],
    scope: { kind: 'global' }, inputKind: 'forecast' } });
  const b = V.assessCoverage(flood(), [], forecasting, { hazardFamilyOf: OBS.familyOf });
  assert.equal(b.status, 'FORECAST_FAILURE');
  assert.match(b.reason, /GDACS/, 'the verdict does not name what was in a position to forecast it');

  /* Both up: one forecasting source is enough. */
  const both = ledgerWith({
    eonet: { label: 'NASA EONET', hazards: ['Flood'], scope: { kind: 'global' }, inputKind: 'observation' },
    gdacs: { label: 'GDACS', hazards: ['Flood'], scope: { kind: 'global' }, inputKind: 'forecast' } });
  assert.equal(V.assessCoverage(flood(), [], both, { hazardFamilyOf: OBS.familyOf }).status,
    'FORECAST_FAILURE');

  /* A source that records nothing about which it is cannot support the claim
     either: absence of the statement is not a forecast product. */
  const silent = ledgerWith({ mystery: { label: 'Unstated', hazards: ['Flood'], scope: { kind: 'global' } } });
  assert.equal(V.assessCoverage(flood(), [], silent, { hazardFamilyOf: OBS.familyOf }).status,
    'NO_PROSPECTIVE_INPUT');
  assert.equal(V.providerIsProspective({ inputKind: 'forecast' }), true);
  assert.equal(V.providerIsProspective({ inputKind: 'observation' }), false);
  assert.equal(V.providerIsProspective({}), false);
});

test('every source this site reads says which kind of input it is', async () => {
  /* The rule above is only as good as the table behind it, and an unmarked
     provider quietly stops being able to explain a missed disaster. */
  const { meta } = await feed();
  const ps = (meta.scan && meta.scan.providers) || [];
  assert.ok(ps.length >= 6, 'the feed reports too few providers to check');
  for (const p of ps) {
    assert.ok(['forecast', 'observation'].includes(p.inputKind),
      p.provider + ' does not say whether it can support a forecast');
    assert.ok(String(p.inputBasis || '').length > 25,
      p.provider + ' states its input kind with no reason anyone can check');
  }
  /* And at least one of each, or the distinction is not doing any work. */
  assert.ok(ps.some(p => p.inputKind === 'forecast'), 'nothing here could forecast anything');
  assert.ok(ps.some(p => p.inputKind === 'observation'), 'every source is claimed to be prospective');
});

test('a cyclone outside the published basins is not the hurricane centre\'s to have seen', () => {
  const nhc = { hazards: ['Tropical Cyclone'], scope: { kind: 'boxes', boxes: [
    { name: 'Atlantic', minLat: -5, maxLat: 60, minLon: -100, maxLon: 0 }] } };
  const westPacific = { hazard: 'tropical-cyclone', geography: { country: 'Philippines', lat: 11, lon: 125 } };
  const atlantic = { hazard: 'tropical-cyclone', geography: { country: 'Bahamas', lat: 24, lon: -75 } };
  assert.equal(V.providerCovers(nhc, westPacific), false,
    'the hurricane centre was credited with a western-Pacific storm');
  assert.equal(V.providerCovers(nhc, atlantic), true, 'control: an Atlantic storm is in reach');
});

test('a record with no coordinates is not at Null Island', () => {
  /* Number(null) and Number('') are both 0, and 0,0 sits inside the Atlantic
     basin, so an unlocated cyclone tested as covered by the hurricane centre
     — whose basins are nowhere near the western Pacific. That provider's
     silence could then establish an absence nobody was in a position to
     observe, and a disaster nothing forecast would be blamed on forecasting
     rather than reported as coverage that cannot be established. */
  const nhc = { hazards: ['Tropical Cyclone'], completeness: 'exhaustive', recordsObservations: true,
    scope: { kind: 'boxes', boxes: [
      { name: 'Atlantic', minLat: -5, maxLat: 60, minLon: -100, maxLon: 0 }] } };
  const unlocated = { hazard: 'tropical-cyclone',
    geography: { country: 'Philippines', lat: null, lon: null } };
  assert.equal(V.providerCoversPlace(nhc, unlocated), null,
    'an unlocated cyclone was placed at 0,0 and read as covered');
  assert.equal(V.providerCovers(nhc, unlocated), false,
    'a provider that cannot be shown to reach this record was counted as having looked');
  // Control: the same provider, and a storm that really is in the basin.
  assert.equal(V.providerCovers(nhc, { hazard: 'tropical-cyclone',
    geography: { country: 'Bahamas', lat: 24, lon: -75 } }), true);

  /* And the claim side, which is where the nulls come from: a frozen claim
     with no position must carry none, not a position off the coast of
     Ghana. */
  const empty = V.frozenClaim({ type: 'Flood', title: 'Flood outlook',
    country: 'Nepal', lat: '', lon: '' }, OBS.familyOf);
  assert.equal(empty.geography.lat, null, 'an empty coordinate became a real place');
  assert.equal(empty.geography.lon, null);
  const missing = V.frozenClaim({ type: 'Flood', title: 'Flood outlook', country: 'Nepal' }, OBS.familyOf);
  assert.equal(missing.geography.lat, null);
});

test('an undecidable scope is never read as coverage', () => {
  const vague = { hazards: ['Flood'] };                     // no scope recorded
  assert.equal(V.providerCoversPlace(vague, flood()), null);
  assert.equal(V.providerCovers(vague, flood()), false,
    'a provider with no recorded reach was counted as having looked');
  const noCountry = { hazards: ['Flood'], scope: { kind: 'countries', countries: ['United States'] } };
  assert.equal(V.providerCoversPlace(noCountry, { hazard: 'flood', geography: {} }), null);
});

/* ------------------------- coverage is per hazard, not one window for all */

test('a run where a hazard\'s providers were down extends no coverage for it', () => {
  /* Codex's case exactly: only USGS online. Earthquakes were watched; tropical
     cyclones were not, and an absence of them that day is not evidence.
     Both providers are exhaustive within their own bounds, so the only thing
     separating the two hazards here is whether anyone actually scanned. */
  const led = {
    providers: {
      usgs: { hazards: ['Earthquake'], scope: { kind: 'global' }, completeness: 'exhaustive', recordsObservations: true },
      nhc: { hazards: ['Tropical Cyclone'], completeness: 'exhaustive', recordsObservations: true,
        scope: { kind: 'boxes', boxes: [{ name: 'Atlantic', minLat: -5, maxLat: 60, minLon: -100, maxLon: 0 }] } }
    },
    /* The real cadence, because coverage is now a run of scans rather than
       the span between the first and the last: hourly-ish from before the
       window to after it, with the cyclone provider down throughout. */
    scans: Array.from({ length: 12 }, (_, i) => ({
      scanTimestamp: new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3 * 3600e3).toISOString(),
      providers: [
        { provider: 'usgs', status: 'SCANNED' },
        { provider: 'nhc', status: 'DATA_UNAVAILABLE' }]
    }))
  };
  const where = { country: 'Bahamas', lat: 24, lon: -75 };
  const quake = V.observedCoverageFor(led, 'earthquake', where);
  const cyclone = V.observedCoverageFor(led, 'tropical-cyclone', where);
  assert.equal(quake.scans, 12, 'the earthquake scans were not counted');
  assert.equal(quake.intervals.length, 1, 'an unbroken run of scans was split');
  assert.equal(cyclone.scans, 0, 'a cycle with no cyclone source was counted as cyclone coverage');
  assert.equal(cyclone.from, null);

  // And a forecast over that period stays ungradeable rather than failing.
  const cycloneOutlook = { id: 'o', type: 'Tropical Cyclone', country: 'Bahamas', lat: 24, lon: -75,
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-01T00:00:00Z',
    targetStart: '2026-09-01T12:00:00Z', targetEnd: '2026-09-02T12:00:00Z' };
  const v = V.verify(cycloneOutlook, [], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf,
    observedCoverage: claim => V.observedCoverageFor(led, claim.hazard, claim.geography) });
  assert.equal(v.classification, 'PENDING',
    'a cyclone outlook was failed for an absence on a day no cyclone source answered');
  assert.equal(v.gradeable, false);

  // Control: the earthquake equivalent, which genuinely was watched, grades.
  const quakeOutlook = Object.assign({}, cycloneOutlook, { id: 'q', type: 'Earthquake' });
  const vq = V.verify(quakeOutlook, [], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf,
    observedCoverage: claim => V.observedCoverageFor(led, claim.hazard, claim.geography) });
  assert.equal(vq.classification, 'MISS_FALSE_POSITIVE',
    'a hazard that was watched should still be gradeable');
});

/* --------------------- and looking is not the same as being able to see all */

test('a selective feed\'s silence is not evidence that nothing happened', () => {
  /* A scan of GDACS was being read as proof that no flood occurred. GDACS
     carries only what it raises to an alert level, so its silence is
     consistent with a flood it never rated — and a matured flood outlook was
     being scored a false positive on the strength of it. Watching and being
     able to establish an absence are two different questions, and only the
     first one a selective feed answers. */
  const gdacs = { hazards: ['Flood', 'Earthquake'], scope: { kind: 'global' },
    completeness: 'selective', recordsObservations: true };
  const usgs = { hazards: ['Earthquake'], scope: { kind: 'global' }, completeness: 'exhaustive', recordsObservations: true };
  const nepalFlood = flood();

  assert.equal(V.providerCovers(gdacs, nepalFlood), true,
    'control: GDACS does publish floods worldwide, so it was watching');
  assert.equal(V.providerCanEstablishAbsence(gdacs, nepalFlood), false,
    'a selective feed\'s silence was accepted as proof that no flood happened');
  assert.equal(V.providerCanEstablishAbsence(usgs, { hazard: 'earthquake', geography: nepalFlood.geography }), true,
    'control: an exhaustive catalogue can support an absence');
  // Exhaustive is not enough on its own: it still has to reach the place.
  assert.equal(V.providerCanEstablishAbsence(usgs, nepalFlood), false,
    'an exhaustive earthquake catalogue was credited with establishing that no flood happened');

  const led = { providers: { gdacs: gdacs, usgs: usgs },
    scans: [{ scanTimestamp: '2026-09-02T00:00:00Z', providers: [
      { provider: 'gdacs', status: 'SCANNED' }, { provider: 'usgs', status: 'SCANNED' }] },
      { scanTimestamp: '2026-09-06T00:00:00Z', providers: [
        { provider: 'gdacs', status: 'SCANNED' }, { provider: 'usgs', status: 'SCANNED' }] }] };
  assert.equal(V.observedCoverageFor(led, 'flood', nepalFlood.geography).scans, 0,
    'successful scans of a selective feed were counted as flood coverage');
  assert.equal(V.observedCoverageFor(led, 'earthquake', nepalFlood.geography).scans, 2,
    'control: the exhaustive catalogue\'s scans were not counted');

  const outlook = { id: 'o', type: 'Flood', country: 'Nepal', lat: 27.7, lon: 85.3,
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-02T12:00:00Z',
    targetStart: '2026-09-03T00:00:00Z', targetEnd: '2026-09-05T00:00:00Z' };
  const graded = V.verify(outlook, [], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf,
    observedCoverage: claim => V.observedCoverageFor(led, claim.hazard, claim.geography) });
  assert.equal(graded.classification, 'PENDING',
    'a flood outlook was failed for an absence only a selective feed could speak to');
  assert.equal(graded.gradeable, false);
});

test('a warning source can never establish that nothing happened', () => {
  /* NWS is exhaustive for active warnings, which is not the same claim: a
     warning is not an observation, warning records never enter the observed
     ledger, and a ledger that would not have recorded the disaster cannot
     show that none occurred. */
  const nws = { hazards: ['Flood', 'Extreme Heat', 'Severe Weather'],
    scope: { kind: 'countries', countries: ['United States'] } };
  const usFlood = flood({ geography: { country: 'United States', lat: 29.7, lon: -95.4 } });
  assert.equal(V.providerCovers(Object.assign({}, nws, { completeness: 'selective' }), usFlood), true,
    'control: NWS does publish US flood warnings');
  assert.equal(V.providerCanEstablishAbsence(Object.assign({}, nws, { completeness: 'selective' }), usFlood), false,
    'a warning feed was accepted as proof that no flood happened');
});

test('the served feed says, for every provider, whether its silence is evidence', async () => {
  const { meta } = await feed();
  const kinds = {};
  for (const p of meta.scan.providers) {
    assert.ok(['exhaustive', 'selective'].includes(p.completeness),
      p.provider + ' does not say whether it is exhaustive: ' + p.completeness);
    assert.ok(String(p.completenessBasis || '').length > 40,
      p.provider + ' states a completeness with no basis for it');
    kinds[p.completeness] = (kinds[p.completeness] || 0) + 1;
  }
  assert.ok(kinds.exhaustive > 0 && kinds.selective > 0,
    'every provider carries the same completeness, so the field distinguishes nothing');
  const byName = Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));
  assert.equal(byName.usgs.completeness, 'exhaustive');
  assert.equal(byName.gdacs.completeness, 'selective',
    'GDACS publishes only what it rates, and is recorded as exhaustive');
  assert.equal(byName.nws.completeness, 'selective',
    'a warning feed is recorded as able to establish an absence');
});

/* ------------------------------- one disaster keeps one identity */

test('better evidence renames nothing and duplicates nothing', async () => {
  const { events } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-reid-'));
  const led = path.join(dir, 'observed.json');
  fs.writeFileSync(led, JSON.stringify({ schemaVersion: 1, events: [] }));
  const run = file => require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), file, led], { stdio: 'pipe' }).toString();

  const a = path.join(dir, 'a.json');
  fs.writeFileSync(a, JSON.stringify({ events }));
  run(a);
  const first = JSON.parse(fs.readFileSync(led, 'utf8'));
  const before = first.events.length;
  const target = first.events.find(e => e.hazard === 'flood');
  assert.ok(target, 'fixture should record a flood');

  /* The same disaster, reported again with a better position and an earlier
     onset — both inputs to the generated id. */
  const moved = JSON.parse(JSON.stringify({ events }));
  const ids = new Set(target.evidence.map(ev => ev.id));
  const shiftedOnset = new Date(Date.parse(target.onset) - 3 * 3600e3).toISOString();
  for (const e of moved.events) {
    /* Enough to change both inputs to the generated id — the rounded degree
       and the minute — and not enough to change which records group. */
    if (ids.has(e.id)) { e.lat = Number(e.lat) + 1.0; e.startedAt = shiftedOnset; }
  }
  const b = path.join(dir, 'b.json');
  fs.writeFileSync(b, JSON.stringify(moved));
  run(b);

  const second = JSON.parse(fs.readFileSync(led, 'utf8'));
  const active = second.events.filter(e => !e.supersededBy);
  /* The invariant that matters: this disaster's provider records belong to
     exactly one active row. A second row carrying them is the permanent
     double-count in the recall denominator. */
  const carrying = active.filter(e => (e.evidence || []).some(ev => ids.has(ev.id)));
  assert.equal(carrying.length, 1,
    'this disaster is carried by ' + carrying.length + ' rows after its generated id changed');
  assert.equal(active.length, before,
    'the active count moved: ' + before + ' -> ' + active.length);
  const kept = second.events.find(e => e.canonicalEventId === target.canonicalEventId);
  assert.ok(kept, 'the original identity was discarded');
  assert.ok((kept.derivedIdHistory || []).length > 0,
    'the id change was applied or lost rather than recorded');
  assert.notEqual(kept.derivedIdHistory[0].derivedId, kept.canonicalEventId);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------- a country-wide claim is recorded as one */

/* A country-level report from today: the only kind that makes a country-wide
   outlook, now that an outlook is no wider than the report it follows. */
const freshCountryReport = () => ({ feeds: {
  reliefweb: '<?xml version="1.0"?><rss version="2.0"><channel>' +
    '<item><title>Madagascar: Drought - Sep 2026</title><link>https://reliefweb.int/disaster/dr-2026-000150-mdg</link>' +
    '<pubDate>' + new Date(Date.now() - 2 * 3600e3).toUTCString() + '</pubDate><description>Drought.</description></item>' +
    '</channel></rss>',
  geocode: { results: [{ name: 'Madagascar', latitude: -19.4, longitude: 46.7, country_code: 'MG' }] } } });

test('the ledger records the scope a forecast was issued for', async () => {
  const { events } = await feed(freshCountryReport());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-scope-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'ledger.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify([]));
  require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-outlooks.js'), eventsPath, ledgerPath], { stdio: 'pipe' });

  const rows = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const country = rows.filter(r => r.forecastScope === 'country');
  assert.ok(country.length > 0,
    'no recorded outlook carries the country scope it was issued for, so it will be graded as a point');
  // The scope survives into the frozen claim the verifier compares against.
  const claim = V.frozenClaim(country[0], OBS.familyOf);
  assert.equal(claim.geography.scope, 'country');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a country-wide outlook is a full hit anywhere in the country', () => {
  const wide = { id: 'w', type: 'Flood', country: 'Nepal', region: 'Bagmati Province',
    lat: 27.7, lon: 85.3, forecastScope: 'country',
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-01T00:00:00Z',
    targetStart: '2026-09-02T00:00:00Z', targetEnd: '2026-09-05T00:00:00Z' };
  /* Far west Nepal: inside the country the outlook named, far outside any
     point tolerance. */
  const far = flood({ geography: { country: 'Nepal', lat: 29.3, lon: 80.6 } });
  const graded = V.verify(wide, [far], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf, observedCoverage: { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' } });
  assert.equal(graded.classification, 'HIT',
    'a country-wide outlook was only partly credited for an event inside the country it named');

  // Without the recorded scope the same row is graded on distance, which is
  // the narrower reading and deliberately not backfilled.
  const noScope = Object.assign({}, wide); delete noScope.forecastScope;
  const narrow = V.verify(noScope, [far], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf, observedCoverage: { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' } });
  assert.equal(narrow.classification, 'PARTIAL_HIT');
});

test('the served feed states each provider\'s reach in a form that can be tested', async () => {
  const { meta } = await feed();
  for (const p of meta.scan.providers) {
    assert.ok(p.scope && p.scope.kind, p.provider + ' has no machine-readable scope');
    assert.ok(['global', 'countries', 'boxes'].includes(p.scope.kind), p.provider + ': ' + p.scope.kind);
  }
  const by = Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));
  assert.deepEqual(by.nws.scope, { kind: 'countries', countries: ['United States'] });
  assert.equal(by.gdacs.scope.kind, 'global');
  assert.equal(by.nhc.scope.kind, 'boxes');
});

/* ------------------------------ a span is not the same as being watched */

test('a gap between successful scans is not coverage', () => {
  /* Coverage was the earliest successful scan through the latest, which is
     not a period at all: a provider that answered on Monday and again on
     Friday, and was unavailable in between, produced a week of "coverage"
     from two instants — and a Tuesday outlook could be failed for an absence
     nobody was there to observe. */
  const usgs = { hazards: ['Earthquake'], scope: { kind: 'global' }, completeness: 'exhaustive', recordsObservations: true };
  const at = (t, ok) => ({ scanTimestamp: t, providers: [{ provider: 'usgs', status: ok ? 'SCANNED' : 'DATA_UNAVAILABLE' }] });
  const led = { providers: { usgs: usgs }, scans: [
    at('2026-09-07T00:00:00Z', true),
    at('2026-09-08T00:00:00Z', false),
    at('2026-09-11T00:00:00Z', true),
    at('2026-09-11T04:00:00Z', true)
  ] };
  const cov = V.observedCoverageFor(led, 'earthquake', { country: 'Nepal' });
  assert.equal(cov.scans, 3);
  assert.equal(cov.intervals.length, 2,
    'four days of outage were joined into one period of coverage');
  assert.equal(cov.intervals[1].from, '2026-09-11T00:00:00.000Z');
  assert.equal(cov.intervals[1].to, '2026-09-11T04:00:00.000Z');
  assert.ok(cov.maxGapHours > 0, 'the rule for joining scans is not published on the answer');

  const window = (a, b) => ({ id: 'o', type: 'Earthquake', country: 'Nepal', lat: 27.7, lon: 85.3,
    forecastClass: 'independent-prospective', freezeTimestamp: '2026-09-06T00:00:00Z',
    targetStart: a, targetEnd: b });
  const graded = w => V.verify(w, [], { now: Date.parse('2026-09-20T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf, observedCoverage: () => cov });

  const inGap = graded(window('2026-09-09T00:00:00Z', '2026-09-10T00:00:00Z'));
  assert.equal(inGap.classification, 'PENDING',
    'a window inside the outage was graded against an absence nobody observed');
  assert.equal(inGap.ungradeableReason, 'OBSERVED_RECORD_HAS_A_GAP');
  assert.match(inGap.classificationReason, /gap of more than \d+ hours/);

  // Control: a window inside an unbroken run still grades.
  const watched = graded(window('2026-09-11T01:00:00Z', '2026-09-11T03:00:00Z'));
  assert.equal(watched.classification, 'MISS_FALSE_POSITIVE',
    'a window that genuinely was watched throughout should still be gradeable');

  // And a window straddling the outage's edge is not covered either.
  assert.equal(graded(window('2026-09-10T00:00:00Z', '2026-09-11T02:00:00Z')).ungradeableReason,
    'OBSERVED_RECORD_HAS_A_GAP');
});

test('an isolated scan covers the moment it ran, not the days around it', () => {
  const usgs = { hazards: ['Earthquake'], scope: { kind: 'global' }, completeness: 'exhaustive', recordsObservations: true };
  const led = { providers: { usgs: usgs },
    scans: [{ scanTimestamp: '2026-09-07T00:00:00Z', providers: [{ provider: 'usgs', status: 'SCANNED' }] }] };
  const cov = V.observedCoverageFor(led, 'earthquake', { country: 'Nepal' });
  assert.equal(cov.intervals.length, 1);
  assert.equal(cov.intervals[0].from, cov.intervals[0].to,
    'one scan was treated as a span rather than an instant');
});

/* ------------- exhaustive about warnings is not exhaustive about disasters */

test('a feed of warnings or statuses can never establish that nothing happened', () => {
  /* The volcano feed lists every elevated alert level in its network, which
     made it exhaustive — but those records are statuses, they are excluded
     from the observed-disaster ledger, and a ledger that would never have
     recorded the eruption cannot show that none occurred. Its silence
     establishes that nothing was elevated, and nothing more. */
  const volcano = { hazards: ['Volcano'], scope: { kind: 'countries', countries: ['United States'] },
    completeness: 'exhaustive', recordsObservations: false };
  const quakes = { hazards: ['Earthquake'], scope: { kind: 'global' },
    completeness: 'exhaustive', recordsObservations: true };
  const eruption = { hazard: 'volcano', geography: { country: 'United States', lat: 19.4, lon: -155.3 } };

  assert.equal(V.providerCovers(volcano, eruption), true,
    'control: the volcano feed does publish US volcanoes');
  assert.equal(V.providerCanEstablishAbsence(volcano, eruption), false,
    'a feed of alert levels was accepted as proof that no eruption caused harm');
  assert.equal(V.providerCanEstablishAbsence(quakes, { hazard: 'earthquake', geography: { country: 'Nepal' } }), true,
    'control: a catalogue of events that happened can support an absence');

  const led = { providers: { volcano: volcano }, scans: [
    { scanTimestamp: '2026-09-01T00:00:00Z', providers: [{ provider: 'volcano', status: 'SCANNED' }] },
    { scanTimestamp: '2026-09-01T03:00:00Z', providers: [{ provider: 'volcano', status: 'SCANNED' }] }] };
  assert.equal(V.observedCoverageFor(led, 'volcano', eruption.geography).scans, 0,
    'successful scans of a warning feed were counted as coverage of the disasters it never records');
});

test('the served feed says, for every provider, whether its records are observations', async () => {
  const { meta } = await feed();
  const byName = Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));
  for (const p of meta.scan.providers) {
    assert.equal(typeof p.recordsObservations, 'boolean',
      p.provider + ' does not say whether its records are observations');
  }
  assert.equal(byName.nws.recordsObservations, false, 'a warning feed is recorded as observing disasters');
  assert.equal(byName.usgs_volcano.recordsObservations, false,
    'an alert-level feed is recorded as observing disasters');
  assert.equal(byName.usgs.recordsObservations, true, 'the earthquake catalogue is recorded as not observing');
});

/* ---------------------- a definition is never applied backwards */

test('a scan is read under the definitions it was recorded with', () => {
  /* One table overwritten every run meant that widening a provider's scope,
     or calling a selective feed exhaustive, reached back and turned scans
     that established nothing into evidence of an absence — silently changing
     verdicts already published. */
  const usOnly = { usgs: { hazards: ['Earthquake'], scope: { kind: 'countries', countries: ['United States'] },
    completeness: 'exhaustive', recordsObservations: true } };
  const global = { usgs: { hazards: ['Earthquake'], scope: { kind: 'global' },
    completeness: 'exhaustive', recordsObservations: true } };
  const led = {
    providers: global,
    providerVersions: { v1: { providers: usOnly }, v2: { providers: global } },
    scans: [
      { scanTimestamp: '2026-09-01T00:00:00Z', providerVersion: 'v1', providers: [{ provider: 'usgs', status: 'SCANNED' }] },
      { scanTimestamp: '2026-09-01T03:00:00Z', providerVersion: 'v2', providers: [{ provider: 'usgs', status: 'SCANNED' }] }
    ]
  };
  const cov = V.observedCoverageFor(led, 'earthquake', { country: 'Nepal' });
  assert.equal(cov.scans, 1,
    'a scan recorded under a US-only definition was read under a later global one');
  assert.equal(cov.intervals[0].from, '2026-09-01T03:00:00.000Z');

  // A ledger written before versions existed still works, under its one table.
  const old = { providers: global, scans: led.scans.map(s => ({ scanTimestamp: s.scanTimestamp, providers: s.providers })) };
  assert.equal(V.observedCoverageFor(old, 'earthquake', { country: 'Nepal' }).scans, 2);
});

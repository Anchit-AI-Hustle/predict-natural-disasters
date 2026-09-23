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

const ledgerWith = providers => ({
  providers: providers,
  retention: { detailFrom: '2026-09-01T00:00:00Z' },
  scans: [{ scanTimestamp: '2026-09-03T01:00:00Z',
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

  // The same disaster, with a genuinely global flood provider up, is the
  // forecaster's to answer for.
  const global = ledgerWith({ gdacs: { hazards: ['Flood'], scope: { kind: 'global' } } });
  assert.equal(V.assessCoverage(flood(), [], global, { hazardFamilyOf: OBS.familyOf }).status,
    'FORECAST_FAILURE');
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
  /* Codex's case exactly: only USGS online. Earthquakes were watched; floods
     were not, and an absence of floods that day is not evidence. */
  const led = {
    providers: {
      usgs: { hazards: ['Earthquake'], scope: { kind: 'global' } },
      gdacs: { hazards: ['Flood', 'Earthquake'], scope: { kind: 'global' } }
    },
    /* Two cycles, so the earthquake side covers a span rather than an
       instant; the flood provider is down for both. */
    scans: [
      { scanTimestamp: '2026-09-01T00:00:00Z', providers: [
        { provider: 'usgs', status: 'SCANNED' },
        { provider: 'gdacs', status: 'DATA_UNAVAILABLE' }] },
      { scanTimestamp: '2026-09-03T00:00:00Z', providers: [
        { provider: 'usgs', status: 'SCANNED' },
        { provider: 'gdacs', status: 'DATA_UNAVAILABLE' }] }]
  };
  const quake = V.observedCoverageFor(led, 'earthquake', { country: 'Nepal' });
  const fl = V.observedCoverageFor(led, 'flood', { country: 'Nepal' });
  assert.equal(quake.scans, 2, 'the earthquake scans were not counted');
  assert.equal(fl.scans, 0, 'a cycle with no flood source was counted as flood coverage');
  assert.equal(fl.from, null);

  // And a forecast over that period stays ungradeable rather than failing.
  const floodOutlook = { id: 'o', type: 'Flood', country: 'Nepal', lat: 27.7, lon: 85.3,
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-01T00:00:00Z',
    targetStart: '2026-09-01T12:00:00Z', targetEnd: '2026-09-02T12:00:00Z' };
  const v = V.verify(floodOutlook, [], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf,
    observedCoverage: claim => V.observedCoverageFor(led, claim.hazard, claim.geography) });
  assert.equal(v.classification, 'PENDING',
    'a flood outlook was failed for an absence on a day no flood source answered');
  assert.equal(v.gradeable, false);

  // Control: the earthquake equivalent, which genuinely was watched, grades.
  const quakeOutlook = Object.assign({}, floodOutlook, { id: 'q', type: 'Earthquake' });
  const vq = V.verify(quakeOutlook, [], { now: Date.parse('2026-09-10T00:00:00Z'),
    hazardFamilyOf: OBS.familyOf,
    observedCoverage: claim => V.observedCoverageFor(led, claim.hazard, claim.geography) });
  assert.equal(vq.classification, 'MISS_FALSE_POSITIVE',
    'a hazard that was watched should still be gradeable');
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

test('the ledger records the scope a forecast was issued for', async () => {
  const { events } = await feed();
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

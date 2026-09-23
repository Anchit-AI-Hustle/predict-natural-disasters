'use strict';
/*
 * Grading a frozen forecast against what actually happened.
 *
 * The danger in a verification engine is not that it is too harsh. It is that
 * every degree of freedom it leaves - a geography that can widen, a threshold
 * that can relax, an absence that can be read as a miss - moves in the
 * flattering direction unless something stops it. These tests are the
 * something.
 *
 * The sharpest case is the one that came out of building it. Run against the
 * committed observed ledger, which ships empty, the engine returned 280 false
 * positives and a precision of 0.9% - not because 280 forecasts were wrong,
 * but because there was nothing to match them against. A window the disaster
 * record does not cover cannot be graded, and saying it failed asserts that
 * nothing happened there, which nothing establishes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../verification-model.js');
const OBS = require('../observed-model.js');
const { callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async () => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
const H = OBS.familyOf;
const FULL_COVER = { from: '2000-01-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };

/* A frozen flood outlook for Nepal, and a flood that happened there. */
const prediction = over => Object.assign({
  id: 'OUT-test-1', type: 'Flood', title: '3-day Flood risk outlook — Nepal',
  country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3,
  forecastScope: 'country', forecastClass: 'independent-prospective',
  freezeTimestamp: '2026-09-01T00:00:00Z',
  targetStart: '2026-09-02T00:00:00Z', targetEnd: '2026-09-05T00:00:00Z'
}, over || {});

const disaster = over => Object.assign({
  canonicalEventId: 'OBS-flood-NEP-20260903T0000-n28e085',
  hazard: 'flood', significant: true, onset: '2026-09-03T00:00:00Z',
  geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
}, over || {});

const grade = (p, events, opts) => V.verify(p, events, Object.assign(
  { now: Date.parse('2026-09-10T00:00:00Z'), hazardFamilyOf: H, observedCoverage: FULL_COVER }, opts || {}));

/* ---------------------------------------------------- the five verdicts */

test('a forecast borne out inside its own geography and window is a hit', () => {
  const v = grade(prediction(), [disaster()]);
  assert.equal(v.classification, 'HIT');
  assert.deepEqual(v.observedEventIds, ['OBS-flood-NEP-20260903T0000-n28e085']);
  assert.ok(v.classificationReason.length > 30, 'a verdict with no stated reason cannot be audited');
  assert.equal(v.verificationVersion, V.VERIFICATION_VERSION);
});

test('a window still open is pending, not a miss', () => {
  const v = grade(prediction(), [], { now: Date.parse('2026-09-03T00:00:00Z') });
  assert.equal(v.classification, 'PENDING');
  assert.equal(v.ungradeableReason, 'WINDOW_STILL_OPEN');
});

test('a matured window with nothing observed is a false positive', () => {
  const v = grade(prediction(), []);
  assert.equal(v.classification, 'MISS_FALSE_POSITIVE');
  assert.equal(v.gradeable, true, 'a genuine miss must still be gradeable');
});

test('right hazard and window, wrong part of the geography, is a partial hit', () => {
  /* An outlook anchored on a point in Nepal; the flood happens in Nepal but
     far outside the published tolerance. Part of the claim held. */
  const p = prediction({ forecastScope: 'event', lat: 27.7, lon: 85.3 });
  const far = disaster({ geography: { country: 'Nepal', region: 'Far West', lat: 29.3, lon: 80.6 } });
  const d = V.distanceKm(27.7, 85.3, 29.3, 80.6);
  assert.ok(d > V.GEOGRAPHY_TOLERANCE_KM.flood, 'control: this should be outside the flood tolerance');
  const v = grade(p, [far]);
  assert.equal(v.classification, 'PARTIAL_HIT');
  assert.match(v.classificationReason, /only partly inside the geography/);
});

test('a forecast that cannot be shown to precede its window is never graded as one that did', () => {
  const v = grade(prediction({ forecastClass: 'invalid-post-event' }), [disaster()]);
  assert.equal(v.classification, 'INVALID_POST_EVENT');
  assert.deepEqual(v.observedEventIds, [], 'an ungraded forecast was still credited with an event');
});

test('a disaster that began before the forecast existed does not verify it', () => {
  /* The causality rule, in the one place it pays: the flood started two days
     before anything recorded this forecast. */
  const p = prediction({ freezeTimestamp: '2026-09-04T00:00:00Z' });
  const v = grade(p, [disaster({ onset: '2026-09-02T12:00:00Z' })]);
  assert.equal(v.classification, 'MISS_FALSE_POSITIVE');
  assert.match(v.classificationReason, /before this forecast can be shown to have existed/);
  assert.deepEqual(v.observedEventIds, [], 'an event predating the forecast was counted as predicted');
  // The same forecast, frozen early enough, does verify.
  assert.equal(grade(prediction(), [disaster({ onset: '2026-09-02T12:00:00Z' })]).classification, 'HIT');
});

/* -------------------------------------- what the engine refuses to decide */

test('a window the disaster record does not cover is not graded at all', () => {
  const p = prediction();
  const empty = grade(p, [], { observedCoverage: { from: null, to: null } });
  assert.equal(empty.classification, 'PENDING');
  assert.equal(empty.gradeable, false);
  assert.equal(empty.ungradeableReason, 'OBSERVED_RECORD_EMPTY');

  const later = grade(p, [], { observedCoverage: { from: '2026-09-20T00:00:00Z', to: '2026-09-30T00:00:00Z' } });
  assert.equal(later.ungradeableReason, 'OBSERVED_RECORD_STARTS_LATER');
  assert.equal(later.classification, 'PENDING', 'an unobservable window was called a false positive');

  // Control: with the record covering it, the same forecast is graded.
  assert.equal(grade(p, []).classification, 'MISS_FALSE_POSITIVE');
});

test('nothing gradeable produces no precision, rather than a flattering one', () => {
  const vers = [grade(prediction(), [], { observedCoverage: { from: null, to: null } })];
  const s = V.score(vers, []);
  assert.equal(s.precision, null, 'a precision was computed from nothing');
  assert.equal(s.recall, null);
  assert.equal(s.f1, null);
  assert.equal(s.ungradeable, 1);
  assert.deepEqual(s.ungradeableBy, { OBSERVED_RECORD_EMPTY: 1 });
});

/* --------------------------------------------- the geography cannot move */

test('the geography and threshold are carried on the verdict, not chosen per case', () => {
  const v = grade(prediction(), [disaster()]);
  assert.deepEqual(v.originalGeography.country, 'Nepal');
  assert.equal(v.originalWindow.targetEnd, '2026-09-05T00:00:00Z');
  assert.equal(v.originalThresholds.geographyToleranceKm, V.GEOGRAPHY_TOLERANCE_KM.flood);
  assert.equal(v.originalThresholds.partialHitWeight, 0.5);
  assert.ok(v.originalThresholds.requires.length > 20, 'the verdict does not state what it required');
});

test('the tolerance is a published rule, the same for every forecast of a hazard', () => {
  /* Tuning this per case is the one move that turns verification into
     curve-fitting, so it is a table, and changing it changes the version. */
  const families = Object.keys(V.GEOGRAPHY_TOLERANCE_KM);
  assert.ok(families.length >= 9, 'the tolerance table no longer covers every hazard family');
  for (const f of families) {
    assert.equal(typeof V.GEOGRAPHY_TOLERANCE_KM[f], 'number');
    assert.ok(V.GEOGRAPHY_TOLERANCE_KM[f] > 0);
  }
  const a = grade(prediction({ id: 'a', forecastScope: 'event' }), [disaster()]);
  const b = grade(prediction({ id: 'b', forecastScope: 'event' }), [disaster()]);
  assert.equal(a.originalThresholds.geographyToleranceKm, b.originalThresholds.geographyToleranceKm);
});

test('an event below the significance bar cannot verify a forecast', () => {
  const v = grade(prediction(), [disaster({ significant: false })]);
  assert.equal(v.classification, 'MISS_FALSE_POSITIVE',
    'a hazard record that is not a disaster was used to verify a forecast');
});

test('a different hazard in the right place cannot verify a forecast', () => {
  const v = grade(prediction(), [disaster({ hazard: 'earthquake' })]);
  assert.equal(v.classification, 'MISS_FALSE_POSITIVE');
});

/* ------------------------------------------------------ false negatives */

test('an absence of forecasts is never read as an absence of looking', () => {
  const a = V.assessCoverage(disaster(), [], { scans: [] });
  assert.equal(a.falseNegative, true);
  assert.equal(a.status, 'DATA_UNAVAILABLE',
    'with no scan record at all, this must not claim either that it looked or that it did not');
  assert.match(a.reason, /not evidence that nothing was/i);
});

test('a disaster before the scan record begins cannot be attributed either way', () => {
  const led = { scans: [{ scanTimestamp: '2026-10-01T00:00:00Z', providers: [] }],
    retention: { detailFrom: '2026-10-01T00:00:00Z' }, providers: {} };
  const a = V.assessCoverage(disaster(), [], led);
  assert.equal(a.status, 'DATA_UNAVAILABLE');
  assert.match(a.reason, /predates/i);
});

test('scanned and nothing forecast is a forecasting failure, not a coverage one', () => {
  const led = {
    retention: { detailFrom: '2026-09-01T00:00:00Z' },
    providers: { gdacs: { hazards: ['Flood', 'Earthquake'], scope: { kind: 'global' } } },
    /* An hour before onset: a scan that ran afterwards could not have put
       anyone in a position to forecast the thing it missed. */
    scans: [{ scanTimestamp: '2026-09-02T23:00:00Z',
      providers: [{ provider: 'gdacs', status: 'SCANNED' }] }]
  };
  const opts = { hazardFamilyOf: OBS.familyOf };
  const a = V.assessCoverage(disaster(), [], led, opts);
  assert.equal(a.status, 'FORECAST_FAILURE');

  /* And that is the whole of it: the same scan an hour after the disaster
     shows only that the provider came back, not that it was watching in time,
     so the disaster cannot be blamed on the forecaster. */
  const late = JSON.parse(JSON.stringify(led));
  late.scans[0].scanTimestamp = '2026-09-03T01:00:00Z';
  const l = V.assessCoverage(disaster(), [], late, opts);
  assert.equal(l.status, 'DATA_UNAVAILABLE',
    'a scan that ran after the disaster was read as having been in a position to forecast it');
  assert.match(l.reason, /before this disaster/i);

  // The same disaster, with the only covering provider unavailable, is the
  // other thing entirely.
  const down = JSON.parse(JSON.stringify(led));
  down.scans[0].providers[0].status = 'DATA_UNAVAILABLE';
  assert.equal(V.assessCoverage(disaster(), [], down, opts).status, 'COVERAGE_FAILURE');

  /* And a provider that covers the hazard but not the place is not coverage
     either - the case Codex raised, kept here beside its siblings. */
  const elsewhere = JSON.parse(JSON.stringify(led));
  elsewhere.providers.gdacs.scope = { kind: 'countries', countries: ['United States'] };
  assert.equal(V.assessCoverage(disaster(), [], elsewhere, opts).status, 'COVERAGE_FAILURE',
    'a US-only provider was credited with watching a flood in Nepal');
});

test('a disaster a qualifying forecast covered is not a false negative', () => {
  const led = { retention: { detailFrom: '2026-09-01T00:00:00Z' },
    providers: { gdacs: { hazards: ['Flood'], scope: { kind: 'global' } } },
    scans: [{ scanTimestamp: '2026-09-03T01:00:00Z', providers: [{ provider: 'gdacs', status: 'SCANNED' }] }] };
  const a = V.assessCoverage(disaster(), [prediction()], led, { hazardFamilyOf: OBS.familyOf });
  assert.equal(a.falseNegative, false);
  assert.equal(a.matched.length, 1);
  assert.equal(a.matched[0].result, 'HIT');
});

test('only an independent prospective forecast can answer a false negative', () => {
  const led = { retention: { detailFrom: '2026-09-01T00:00:00Z' },
    providers: { gdacs: { hazards: ['Flood'], scope: { kind: 'global' } } },
    scans: [{ scanTimestamp: '2026-09-03T01:00:00Z', providers: [{ provider: 'gdacs', status: 'SCANNED' }] }] };
  /* A continuation outlook describing a flood already under way does not make
     that flood a predicted one. */
  const a = V.assessCoverage(disaster(), [prediction({ forecastClass: 'continuation-outlook' })], led,
    { hazardFamilyOf: OBS.familyOf });
  assert.equal(a.falseNegative, true,
    'a continuation outlook was accepted as having predicted the disaster it describes');
});

/* ------------------------------------------------------------- scoring */

test('every score states the counts and the weighting it came from', () => {
  const vers = [
    grade(prediction({ id: 'a' }), [disaster()]),
    grade(prediction({ id: 'b', forecastScope: 'event' }),
      [disaster({ geography: { country: 'Nepal', lat: 29.3, lon: 80.6 } })]),
    grade(prediction({ id: 'c' }), [])
  ];
  const s = V.score(vers, [{ falseNegative: false, matched: [{ result: 'HIT' }] },
    { falseNegative: true, status: 'FORECAST_FAILURE', matched: [] }]);
  assert.equal(s.hit, 1); assert.equal(s.partial, 1); assert.equal(s.miss, 1);
  assert.equal(s.eligibleMaturedPredictions, 3);
  // (1 + 0.5 x 1) / 3
  assert.ok(Math.abs(s.precision - 0.5) < 1e-9, 'precision is not the stated formula');
  // (1 + 0.5 x 0) / 2
  assert.ok(Math.abs(s.recall - 0.5) < 1e-9, 'recall is not the stated formula');
  assert.ok(Math.abs(s.f1 - 0.5) < 1e-9);
  assert.equal(s.partialHitWeight, 0.5);
  assert.match(s.methodology.partialHitWeight, /PARTIAL HIT weight = 0\.5/);
  assert.match(s.methodology.f1, /not an accuracy/i);
});

/* ------------------------------------ and against the real recorded data */

test('the committed record cannot be graded yet, and says so', async () => {
  const { events } = await feed();
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const observedLedger = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'observed-disasters.json'), 'utf8'));
  const observed = OBS.canonicalise(events.filter(e => !e.forecast)).filter(c => c.significant);
  const cover = { from: observedLedger.events.length ? observedLedger.events[0].onset : null,
    to: observedLedger.updatedAt || null };

  const vers = ledger.map(p => V.verify(p, observed,
    { now: Date.now(), hazardFamilyOf: H, observedCoverage: cover }));
  const s = V.score(vers, []);
  assert.equal(s.precision, null,
    'a precision was published from a disaster record that does not cover the forecasts');
  assert.ok(s.ungradeable > 0, 'nothing was marked ungradeable, so the guard is not running');
  assert.equal(s.miss, 0,
    'matured forecasts were called false positives against an empty disaster record');
});

/* ------------------- a continuation outlook is about a disaster that began
                       before it was written                                */

test('a continuation outlook is graded on whether the disaster carried on', () => {
  /* Every continuation outlook was guaranteed to fail. It exists because a
     disaster is already under way, so the only matching event always has an
     onset before the freeze - and the engine treated a pre-freeze onset as
     proof the forecast had not predicted anything, which is the right rule
     for an independent prediction and a category error for this one. What
     must fall inside the window is not the onset: it is evidence that the
     disaster was still going. */
  const cont = prediction({
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  });
  const began = disaster({ onset: '2026-09-03T00:00:00Z' });

  const quiet = grade(cont, [began]);
  assert.equal(quiet.classification, 'PENDING',
    'a continuation outlook was graded although nothing shows whether the disaster continued');
  assert.equal(quiet.ungradeableReason, 'CONTINUATION_EVIDENCE_UNAVAILABLE');
  assert.equal(quiet.gradeable, false);

  const carried = grade(cont, [disaster({ onset: '2026-09-03T00:00:00Z',
    impactLastUpdated: '2026-09-05T12:00:00Z' })]);
  assert.equal(carried.classification, 'HIT',
    'a disaster still being reported inside the window did not bear out the outlook that said it would continue');
  assert.match(carried.classificationReason, /still being reported inside the window/i);
  assert.deepEqual(carried.observedEventIds, [began.canonicalEventId]);
});

test('each class that follows a disaster is graded by its own rule', () => {
  const began = disaster({ onset: '2026-09-03T00:00:00Z', impactLastUpdated: '2026-09-05T12:00:00Z' });
  const windowed = extra => prediction(Object.assign({
    freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  }, extra));
  /* A continuation and a warning-derived outlook say the hazard itself
     carries on, so the record being reassessed inside the window shows it. */
  for (const k of ['continuation-outlook', 'warning-derived']) {
    assert.equal(grade(windowed({ forecastClass: k }), [began]).classification, 'HIT',
      k + ' cannot be borne out by the disaster it follows');
  }
  /* An aftershock outlook claims new activity or new impacts, so the same
     reassessment is not enough for it — that is the whole difference. */
  assert.equal(grade(windowed({ forecastClass: 'post-event-conditional' }), [began]).classification,
    'PENDING', 'an aftershock outlook was credited with a routine reassessment');
  assert.equal(grade(windowed({ forecastClass: 'post-event-conditional' }), [disaster({
    onset: '2026-09-03T00:00:00Z',
    revisions: [{ at: '2026-09-05T12:00:00Z', field: 'deaths', from: 1, to: 6 }] })]).classification,
    'HIT', 'an impact that actually moved was not credited');
  /* And the rule does not leak. An independent prospective prediction frozen
     after the disaster began has still predicted nothing, however long that
     disaster then ran. */
  const indep = grade(windowed({ forecastClass: 'independent-prospective' }), [began]);
  assert.equal(indep.classification, 'MISS_FALSE_POSITIVE',
    'an independent prediction was credited with a disaster that began before it existed');
  assert.match(indep.classificationReason, /before this forecast can be shown to have existed/i);
});

test('a disaster that was over before the window opened did not continue into it', () => {
  const cont = prediction({
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  });
  const finished = disaster({ onset: '2026-09-01T00:00:00Z', end: '2026-09-02T00:00:00Z' });
  const v = grade(cont, [finished]);
  assert.equal(v.classification, 'PENDING',
    'an outlook was credited with a disaster that had already ended before its window opened');
  assert.equal(v.ungradeableReason, 'CONTINUATION_EVIDENCE_UNAVAILABLE');
  /* A revision dated inside the window is evidence of its own. */
  const revised = disaster({ onset: '2026-09-01T00:00:00Z',
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 3, to: 11 }] });
  const w = grade(cont, [revised]);
  assert.equal(w.classification, 'HIT');
  assert.match(w.classificationReason, /deaths was revised/);
});

test('a report dated after the window closed is not evidence from inside it', () => {
  /* The mirror image of the defect the continuation branch was written to
     fix, and the one that flatters: only the window's start was applied, so a
     mark at any later date counted. lastSeenAt advances every run while a
     record is in the feed, so an outlook that expired a fortnight ago would
     be graded a hit this morning on the strength of this morning's timestamp,
     reported as "inside the window". */
  const cont = prediction({
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  });
  const late = disaster({ onset: '2026-09-03T00:00:00Z', lastSeenAt: '2026-09-19T00:00:00Z' });
  const v = grade(cont, [late]);
  assert.equal(v.classification, 'PENDING',
    'a sighting a fortnight after the window closed was counted as activity inside it');
  assert.equal(v.ungradeableReason, 'CONTINUATION_EVIDENCE_UNAVAILABLE');

  // Control: the same sighting, inside the window.
  const inside = disaster({ onset: '2026-09-03T00:00:00Z', lastSeenAt: '2026-09-05T00:00:00Z' });
  assert.equal(grade(cont, [inside]).classification, 'HIT');

  // And the helper itself, at the boundary.
  const from = Date.parse('2026-09-04T00:00:00Z'), to = Date.parse('2026-09-07T00:00:00Z');
  const at = t => V.continuedActivity({ onset: '2026-09-03T00:00:00Z', lastSeenAt: t }, from, to);
  assert.ok(at('2026-09-07T00:00:00Z'), 'the closing instant is inside the window');
  assert.equal(at('2026-09-07T00:00:01Z'), null, 'a second after the window is not inside it');
});

test('an aftershock outlook is not verified by the mainshock still being in the feed', () => {
  /* Its published rule is "grade against observed aftershock activity and any
     additional impacts in the window". The mainshock sits in the USGS feed
     for days afterwards, so counting the record being seen again would make
     every aftershock outlook a hit whether or not one aftershock occurred. */
  const outlook = prediction({
    type: 'Earthquake aftershock sequence', title: 'Aftershock-sequence outlook — Nepal',
    forecastClass: 'post-event-conditional', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-08T00:00:00Z'
  });
  const mainshock = over => Object.assign({
    canonicalEventId: 'OBS-eq-main', hazard: 'earthquake', significant: true,
    onset: '2026-09-03T12:00:00Z',
    geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
  }, over || {});

  const seenAgain = grade(outlook, [mainshock({ lastSeenAt: '2026-09-06T00:00:00Z' })]);
  assert.notEqual(seenAgain.classification, 'HIT',
    'the mainshock still being carried by its provider verified an aftershock outlook');
  assert.equal(seenAgain.classification, 'PENDING',
    'and it is not a failure either: most aftershocks never reach the significance bar, so the record cannot answer it');

  /* The second limb of the rule: a new impact recorded inside the window. */
  const newImpact = grade(outlook, [mainshock({
    revisions: [{ at: '2026-09-06T00:00:00Z', field: 'deaths', from: 2, to: 9 }] })]);
  assert.equal(newImpact.classification, 'HIT',
    'additional impacts inside the window do not verify an aftershock outlook');

  /* The first limb: a separate significant aftershock, matched on its onset
     like any other observed event. */
  const aftershock = grade(outlook, [mainshock({
    canonicalEventId: 'OBS-eq-after', onset: '2026-09-06T04:00:00Z' })]);
  assert.equal(aftershock.classification, 'HIT');
  assert.deepEqual(aftershock.observedEventIds, ['OBS-eq-after']);

  /* And a continuation outlook, which claims the hazard itself continues, is
     still graded on the record being carried — the two classes are not one. */
  const cont = Object.assign({}, outlook, { forecastClass: 'continuation-outlook' });
  assert.equal(grade(cont, [mainshock({ lastSeenAt: '2026-09-06T00:00:00Z' })]).classification, 'HIT');
});

/* ---------------- what the ledger remembers is what can be graded */

test('a disaster carried through the window is not erased by the next run', () => {
  /* lastSeenAt is overwritten on every run, so the first cycle after an
     outlook's window closed replaced the evidence from inside it with a
     timestamp from outside it — and the window bound then correctly rejected
     that. A continuation observed on every scan inside its window became
     "no evidence either way", which is the opposite of what the ledger had
     just watched happen. The runs it was carried for are kept. */
  const cont = prediction({
    forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  });
  const carried = disaster({
    onset: '2026-09-03T00:00:00Z',
    lastSeenAt: '2026-09-09T12:00:00Z',                 // this morning's run
    sightings: [{ from: '2026-09-03T00:00:00Z', to: '2026-09-09T12:00:00Z' }]
  });
  const v = grade(cont, [carried]);
  assert.equal(v.classification, 'HIT',
    'a disaster carried by its provider throughout the window was graded as though nothing was known');
  assert.match(v.classificationReason, /carrying it from/);

  // A run that began only after the window closed is still not evidence.
  const later = disaster({ onset: '2026-09-03T00:00:00Z',
    lastSeenAt: '2026-09-09T12:00:00Z',
    sightings: [{ from: '2026-09-08T00:00:00Z', to: '2026-09-09T12:00:00Z' }] });
  assert.equal(grade(cont, [later]).ungradeableReason, 'CONTINUATION_EVIDENCE_UNAVAILABLE');
});

test('a routine refresh is not an additional impact', () => {
  /* impactLastUpdated is set from the newest provider timestamp on the
     record, whether or not a figure moved, so a mainshock being refreshed
     inside the window would have credited an aftershock outlook with
     "additional impacts" nobody reported. */
  const outlook = prediction({
    type: 'Earthquake aftershock sequence', title: 'Aftershock-sequence outlook — Nepal',
    forecastClass: 'post-event-conditional', freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-08T00:00:00Z'
  });
  const mainshock = over => Object.assign({
    canonicalEventId: 'OBS-eq-main', hazard: 'earthquake', significant: true,
    onset: '2026-09-03T12:00:00Z',
    geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
  }, over || {});

  assert.equal(grade(outlook, [mainshock({ impactLastUpdated: '2026-09-06T00:00:00Z' })]).classification,
    'PENDING', 'a refreshed timestamp was counted as an additional impact');
  assert.equal(grade(outlook, [mainshock({
    revisions: [{ at: '2026-09-06T00:00:00Z', field: 'displaced', from: 100, to: 400 }] })]).classification,
    'HIT', 'a figure that actually moved was not counted');
  // A revision to something that is not an impact is not one either.
  assert.equal(grade(outlook, [mainshock({
    revisions: [{ at: '2026-09-06T00:00:00Z', field: 'sourceUrl', from: 'a', to: 'b' }] })]).classification,
    'PENDING', 'a changed source link was counted as an additional impact');
});

test('a claim naming two hazards is graded against both', () => {
  /* The frozen benchmark is "Flood / Landslide" and its published rule
     accepts either inside its corridor. Reduced to its first family, a
     landslide there was a false positive under a rule that had promised to
     accept it. */
  const both = prediction({ type: 'Flood / Landslide',
    title: 'Central Vietnam flash-flood and landslide outlook',
    country: 'Vietnam', region: 'Huế corridor', forecastScope: null });
  const claim = V.frozenClaim(both, H);
  assert.deepEqual(claim.hazards, ['flood', 'landslide']);
  assert.equal(claim.hazard, 'flood', 'the primary family still names the claim');

  const slide = disaster({ canonicalEventId: 'OBS-ls-1', hazard: 'landslide',
    geography: { country: 'Vietnam', region: 'Huế corridor', lat: 27.7, lon: 85.3 } });
  assert.equal(grade(both, [slide]).classification, 'HIT',
    'a landslide inside the corridor did not satisfy a flood-or-landslide claim');
  // And the claim has not become a claim about everything.
  const quake = Object.assign({}, slide, { hazard: 'earthquake' });
  assert.equal(grade(both, [quake]).classification, 'MISS_FALSE_POSITIVE');
  // A single-hazard claim is unchanged.
  assert.deepEqual(V.frozenClaim(prediction(), H).hazards, ['flood']);
});

test('a claim naming two hazards needs both of them watched', () => {
  const exhaustive = (h) => ({ hazards: [h], scope: { kind: 'global' },
    completeness: 'exhaustive', recordsObservations: true });
  const at = (t, up) => ({ scanTimestamp: t, providers: [
    { provider: 'quake', status: 'SCANNED' },
    { provider: 'slide', status: up ? 'SCANNED' : 'DATA_UNAVAILABLE' }] });
  const led = { providers: { quake: exhaustive('Earthquake'), slide: exhaustive('Landslide') },
    scans: [at('2026-09-01T00:00:00Z', false), at('2026-09-01T03:00:00Z', true),
      at('2026-09-01T06:00:00Z', true)] };
  const one = V.observedCoverageFor(led, 'earthquake', { country: 'Nepal' });
  const both = V.observedCoverageFor(led, ['earthquake', 'landslide'], { country: 'Nepal' });
  assert.equal(one.intervals[0].from, '2026-09-01T00:00:00.000Z');
  assert.equal(both.intervals[0].from, '2026-09-01T03:00:00.000Z',
    'a compound claim was credited with coverage of only one of its hazards');
});

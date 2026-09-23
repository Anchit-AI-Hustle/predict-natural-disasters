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
const { closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
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

/*
 * The association tools/record-observed.js writes on a disaster that a
 * conditional claim follows: which claim, and which feed record that claim is
 * about. Without it the verifier cannot tell this mainshock from a
 * neighbouring one, so it declines to grade rather than crediting the wrong
 * sequence - which is the behaviour these fixtures have to carry to exercise
 * the grading at all. The default subject is prediction()'s own id, because
 * frozenClaim falls back to the id where a claim names no forecastOf.
 */
const followed = (d, subject) => Object.assign({}, d,
  { keptFor: [{ claim: 'ledger-key', subject: subject || 'OUT-test-1' }] });

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

test('a compound claim is graded on the tolerance of the hazard observed', () => {
  /* "Flood / Landslide" is one claim about two hazards, and the tolerance
     table is a statement about how far each hazard's effects reach from its
     centre. Grading the whole claim on the primary family gave an observed
     landslide the flood radius: 200 km from the forecast point was a full hit
     under 300 km when the published landslide tolerance is 150 - and the
     reason line said "the published 300 km tolerance for this hazard" about a
     hazard whose tolerance is not 300. */
  const p = prediction({ id: 'OUT-compound', type: 'Flood / Landslide',
    title: 'Flood / Landslide outlook \u2014 Nepal', forecastScope: 'event' });
  const claim = V.frozenClaim(p, H);
  assert.deepEqual(claim.hazards, ['flood', 'landslide'],
    'control: this claim should name both hazards');
  assert.deepEqual(claim.thresholds.geographyToleranceKmByHazard,
    { flood: V.GEOGRAPHY_TOLERANCE_KM.flood, landslide: V.GEOGRAPHY_TOLERANCE_KM.landslide },
    'the verdict must publish the tolerance for every hazard it accepts');

  const at = { country: 'Nepal', region: 'Gandaki', lat: 29.5, lon: 85.3 };
  const d = V.distanceKm(p.lat, p.lon, at.lat, at.lon);
  assert.ok(d > V.GEOGRAPHY_TOLERANCE_KM.landslide && d < V.GEOGRAPHY_TOLERANCE_KM.flood,
    'control: this distance has to fall between the two tolerances to prove anything');

  const slide = grade(p, [disaster({ canonicalEventId: 'OBS-landslide-NEP-1',
    hazard: 'landslide', geography: at })]);
  assert.equal(slide.classification, 'PARTIAL_HIT',
    'a landslide beyond its own published tolerance was a full hit under the flood radius');
  assert.match(slide.classificationReason, /150 km tolerance for landslide/);
  assert.match(slide.classificationReason, /^A significant landslide/,
    'the verdict describes the wrong hazard as the one observed');

  /* The other half of the same claim, at the same distance, still holds. */
  const flood = grade(p, [disaster({ hazard: 'flood', geography: at })]);
  assert.equal(flood.classification, 'HIT');
  assert.match(flood.classificationReason, /300 km tolerance for flood/);

  /* And a single-hazard claim is unchanged. */
  const plain = grade(prediction({ forecastScope: 'event' }),
    [disaster({ geography: at })]);
  assert.equal(plain.classification, 'HIT');
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
    /* A source that states what is expected: a catalogue of disasters already
       under way puts nobody in a position to forecast one, which this test is
       not about. */
    providers: { gdacs: { hazards: ['Flood', 'Earthquake'], scope: { kind: 'global' },
      inputKind: 'forecast' } },
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

test('the committed record is graded only where the written record can answer', () => {
  /* Graded the way the accuracy page grades it: against the observed ledger,
     with coverage read per hazard and place from the scan ledger. This used to
     take one window from the observed ledger's first onset to its last update,
     which was harmless while that record was empty; the first real run put an
     August flood in it, the window then spanned every recorded forecast, and
     the test graded all of them against disasters the scan record never
     covered. */
  const VD = require('../verdicts.js');
  const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const ledger = read('outlook-ledger.json');
  const observedLedger = read('observed-disasters.json');
  const scan = read('scan-ledger.json');
  const events = (observedLedger.events || []).filter(e => !e.supersededBy);
  const preds = ledger.map(r => Object.assign({}, r, { forecastClass: VD.forecastClassOf(r) }));
  const cover = c => V.observedCoverageFor(scan, c.hazards || c.hazard, c.geography);
  const vers = preds.map(p => V.verify(p, events, { now: Date.now(), hazardFamilyOf: H,
    observedCoverage: cover, supportingEvents: observedLedger.supporting || [] }));

  const ungradeable = vers.filter(v => v.gradeable === false && v.ungradeableReason &&
    v.ungradeableReason !== 'WINDOW_STILL_OPEN');
  assert.ok(ungradeable.length > 0, 'nothing was marked ungradeable, so the guard is not running');
  for (const v of ungradeable) assert.ok(v.classificationReason, v.predictionId + ' is ungradeable without saying why');

  /* A false positive needs a source whose silence is evidence. */
  for (const v of vers.filter(x => x.classification === 'MISS_FALSE_POSITIVE')) {
    assert.notEqual(v.absenceEstablishable, false,
      v.predictionId + ' was called a false positive where no absence could be established');
  }
  /* A hit is borne out by something recorded after the forecast existed. */
  for (const [i, v] of vers.entries()) {
    if (v.classification !== 'HIT' && v.classification !== 'PARTIAL_HIT') continue;
    assert.ok(v.evidence.length, v.predictionId + ' was credited with no evidence');
    const from = Date.parse(V.freezeOf(preds[i]));
    for (const e of v.evidence) {
      assert.ok(Date.parse(e.onset) >= from,
        v.predictionId + ' was credited with an observation from before it was recorded');
    }
  }

  /* No prediction rate from a record holding no independent prediction. */
  const headlineIdx = preds.map((p, i) => i).filter(i => preds[i].forecastClass === 'independent-prospective');
  const since = V.predictingSince(preds);
  const assessed = events.filter(e => V.inRecallPeriod(e, since))
    .map(e => V.assessCoverage(e, preds, scan, { hazardFamilyOf: H }));
  const s = V.score(headlineIdx.map(i => vers[i]), assessed);
  if (!headlineIdx.length) {
    assert.equal(since, null);
    assert.equal(s.precision, null, 'a precision was published with no independent prediction on record');
    assert.equal(s.recall, null, 'a recall was published with no independent prediction on record');
  }
});

test('a row written before freezes were recorded is credited only from when it was written', () => {
  /* Legacy ledger rows carry recordedAt and no freezeTimestamp. The row is
     the proof the forecast existed; before it, nothing shows that it did. */
  const legacy = { id: 'OUT-legacy', type: 'Earthquake aftershock sequence', forecastClass: 'post-event-conditional',
    country: 'Nepal', region: 'Bagmati', lat: 27.7, lon: 85.3,
    targetStart: '2026-09-14T00:00:00Z', targetEnd: '2026-09-21T00:00:00Z',
    recordedAt: '2026-09-15T12:00:00Z' };
  assert.equal(new Date(V.effectiveStart(legacy)).toISOString(), '2026-09-15T12:00:00.000Z');
  assert.equal(V.frozenClaim(legacy, H).freezeTimestamp, '2026-09-15T12:00:00Z');
  /* An explicit freeze still wins over the write time. */
  assert.equal(new Date(V.effectiveStart(Object.assign({}, legacy,
    { freezeTimestamp: '2026-09-14T06:00:00Z' }))).toISOString(), '2026-09-14T06:00:00.000Z');
});

test('recall is measured only over disasters from when something was predicting', () => {
  const pred = (cls, at) => ({ forecastClass: cls, freezeTimestamp: at });
  assert.equal(V.predictingSince([pred('continuation-outlook', '2026-09-01T00:00:00Z')]), null,
    'a conditional outlook is not an independent prediction');
  const since = V.predictingSince([pred('independent-prospective', '2026-09-10T00:00:00Z'),
    pred('independent-prospective', '2026-09-05T00:00:00Z')]);
  assert.equal(new Date(since).toISOString(), '2026-09-05T00:00:00.000Z', 'the earliest freeze starts the period');
  assert.equal(V.inRecallPeriod({ onset: '2026-09-04T23:00:00Z' }, since), false);
  assert.equal(V.inRecallPeriod({ onset: '2026-09-05T00:00:00Z' }, since), true);
  assert.equal(V.inRecallPeriod({ onset: null }, since), false, 'a disaster with no onset cannot be placed in the period');
  assert.equal(V.inRecallPeriod({ onset: '2026-09-06T00:00:00Z' }, null), false,
    'with nothing ever predicted, no disaster is in a recall');
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
  assert.equal(grade(windowed({ forecastClass: 'post-event-conditional' }), [followed(began)]).classification,
    'PENDING', 'an aftershock outlook was credited with a routine reassessment');
  assert.equal(grade(windowed({ forecastClass: 'post-event-conditional' }), [followed(disaster({
    onset: '2026-09-03T00:00:00Z',
    revisions: [{ at: '2026-09-05T12:00:00Z', field: 'deaths', from: 1, to: 6 }] }))]).classification,
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

test('the scan a forecast was derived from is not evidence that came after it', () => {
  /* Dating sightings by the scan that saw them keeps the ordinary case
     honest, but a forecast whose freeze is evidenced EARLIER than the
     recording - a hand-frozen record the repository can show - has a freeze
     before its own snapshot, and that snapshot's sighting then falls inside
     the window. It is still the record the forecast was drawn from, so it
     cannot show the hazard continued afterwards; the scan is named on both
     sides so the two can be told apart. */
  const p = prediction({ forecastClass: 'continuation-outlook',
    freezeTimestamp: '2026-09-02T00:00:00Z', sourceScanId: 'scan-1',
    targetStart: '2026-09-02T00:00:00Z', targetEnd: '2026-09-05T00:00:00Z' });
  const sighted = scan => disaster({ onset: '2026-09-01T00:00:00Z',
    sightings: [{ from: '2026-09-03T00:00:00Z', to: '2026-09-03T06:00:00Z',
      fromScan: scan, toScan: scan }] });

  const own = grade(p, [sighted('scan-1')]);
  assert.notEqual(own.classification, 'HIT',
    'a forecast was borne out by the snapshot it was derived from');
  assert.equal(own.gradeable, false);
  const later = grade(p, [sighted('scan-2')]);
  assert.equal(later.classification, 'HIT',
    'a later scan still carrying the hazard is what this class claims');
});

test('a withdrawn or reduced impact figure is not an additional impact', () => {
  /* The observed ledger deliberately records a figure that stopped being
     published as a revision to null - the reported figure is kept, and the
     withdrawal is recorded - and it records downward corrections too. Reading
     either as "an additional impact" made a mainshock's death toll being
     withdrawn, or corrected from 12 to 8, grade an aftershock outlook a hit
     though nothing further had happened. */
  const windowed = extra => prediction(Object.assign({
    forecastClass: 'post-event-conditional',
    freezeTimestamp: '2026-09-04T00:00:00Z',
    targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
  }, extra));
  const withRevision = rev => followed(disaster({ onset: '2026-09-03T00:00:00Z',
    revisions: [Object.assign({ at: '2026-09-05T12:00:00Z' }, rev)] }));

  assert.equal(grade(windowed(), [withRevision({ field: 'deaths', from: 12, to: null,
    note: 'No longer reported upstream; the recorded figure is kept.' })]).classification,
    'PENDING', 'a withdrawn death toll was credited as an additional impact');
  assert.equal(grade(windowed(), [withRevision({ field: 'deaths', from: 12, to: 8 })]).classification,
    'PENDING', 'a death toll corrected downwards was credited as an additional impact');
  assert.equal(grade(windowed(), [withRevision({ field: 'deaths', from: null, to: 0 })]).classification,
    'PENDING', 'a reported zero was credited as an additional impact');
  assert.equal(grade(windowed(), [withRevision({ field: 'infrastructureImpact',
    from: 'Bridges down', to: 'Roads closed' })]).classification,
    'PENDING', 'one description replacing another was credited as an additional impact');

  /* The controls: impact that actually grew, and impact reported where there
     was none, are what this class is graded on. */
  assert.equal(grade(windowed(), [withRevision({ field: 'deaths', from: 1, to: 6 })]).classification,
    'HIT', 'an impact that actually rose was not credited');
  assert.equal(grade(windowed(), [withRevision({ field: 'displaced', from: null, to: 400 })]).classification,
    'HIT', 'an impact reported where there was none was not credited');
  assert.equal(grade(windowed(), [withRevision({ field: 'infrastructureImpact',
    from: null, to: 'Two bridges lost' })]).classification,
    'HIT', 'newly reported damage was not credited');
  assert.equal(V.reportsMoreImpact({ field: 'deaths', from: 12, to: null }), false);
  assert.equal(V.reportsMoreImpact({ field: 'deaths', from: 12, to: 20 }), true);
});

test('an ordinary aftershock is what an aftershock outlook claims', () => {
  /* The published rule is "grade against observed aftershock activity and any
     additional impacts in the window", and the record it was graded against
     holds only significant disasters - so an ordinary aftershock, which is
     what a sequence is mostly made of, was invisible. Only an aftershock big
     enough to be a disaster of its own, or the mainshock's toll rising, could
     bear such an outlook out, and every ordinary successful one stayed
     ungradeable against a rule that had promised to accept it. */
  const p = prediction({ id: 'OUT-after', type: 'Earthquake aftershock sequence',
    title: 'Aftershock-sequence outlook \u2014 Nepal', forecastClass: 'post-event-conditional',
    forecastScope: 'event', freezeTimestamp: '2026-09-03T00:00:00Z', forecastOf: 'usgs-main',
    targetStart: '2026-09-03T00:00:00Z', targetEnd: '2026-09-10T00:00:00Z' });
  const mainshock = disaster({ canonicalEventId: 'OBS-main', hazard: 'earthquake',
    onset: '2026-09-02T00:00:00Z' });
  /* keptFor is the association the recorder wrote down: which frozen claims
     are graded on this observation, and which disaster each of them follows.
     Hazard, window and distance are satisfied by every neighbouring sequence,
     so this is the only thing that says whose aftershock it is. */
  const aftershock = { canonicalEventId: 'OBS-af-1', hazard: 'earthquake', significant: false,
    onset: '2026-09-05T00:00:00Z', magnitude: 4.4,
    geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.8, lon: 85.4 },
    keptFor: [{ claim: 'OUT-after@2026-09-03T00:00:00Z', subject: 'usgs-main' }] };
  const grade2 = (sup) => V.verify(p, [mainshock], { now: Date.parse('2026-09-12T00:00:00Z'),
    hazardFamilyOf: H, observedCoverage: FULL_COVER, supportingEvents: sup });

  assert.equal(grade2([]).classification, 'PENDING',
    'control: with nothing but the mainshock there is nothing to grade on');
  const v = grade2([aftershock]);
  assert.equal(v.classification, 'HIT', 'the activity this outlook is about did not count');
  assert.deepEqual(v.observedEventIds, ['OBS-af-1']);
  /* And it says what it counted: calling a magnitude-4 aftershock "a
     significant earthquake" would be the flattering misdescription. */
  assert.match(v.classificationReason, /^Observed earthquake activity/);
  assert.match(v.classificationReason, /not itself a disaster/i);
  assert.match(v.classificationReason, /counts towards no recall figure/i);

  /* It is evidence for this class alone. A continuation outlook says the
     hazard itself carries on and is graded on the disaster's own record; an
     independent prediction claims a disaster, and a record that is not one
     cannot bear it out. */
  for (const cls of ['independent-prospective', 'continuation-outlook', 'warning-derived']) {
    const other = V.verify(prediction({ id: 'OUT-' + cls, forecastClass: cls,
      freezeTimestamp: '2026-09-03T00:00:00Z', forecastScope: 'event',
      targetStart: '2026-09-03T00:00:00Z', targetEnd: '2026-09-10T00:00:00Z' }),
      [], { now: Date.parse('2026-09-12T00:00:00Z'), hazardFamilyOf: H,
        observedCoverage: FULL_COVER, supportingEvents: [aftershock] });
    assert.notEqual(other.classification, 'HIT',
      cls + ' was borne out by an observation that is not a disaster');
  }

  /* Outside the window, or outside the geography, it is not evidence either. */
  assert.equal(grade2([Object.assign({}, aftershock, { onset: '2026-09-11T00:00:00Z' })]).classification,
    'PENDING', 'an aftershock after the window closed was counted');
  assert.equal(grade2([Object.assign({}, aftershock,
    { geography: { country: 'Chile', lat: -33, lon: -70 } })]).classification,
    'PENDING', 'an aftershock on another continent was counted');
});

test('an aftershock of one quake does not grade the next quake\u2019s outlook', () => {
  /* Two mainshocks 167 km and a day apart each get a 7-day aftershock
     outlook. The published earthquake tolerance is 250 km, so each claim
     accepts the other's aftershocks in full: hazard, window and distance are
     all satisfied by both. Measured before this was tied to the mainshock, an
     ordinary M4.3 aftershock 7 km from quake A graded quake B's outlook a HIT
     with the line "observed activity of the sequence this outlook is about"
     about an event 161 km away that belonged to a different earthquake. */
  const T0 = Date.parse('2026-09-01T00:00:00Z');
  const iso = ms => new Date(ms).toISOString();
  const outlook = (id, of, lat, lon, at) => prediction({
    id, forecastOf: of, type: 'Earthquake aftershock sequence',
    title: 'Aftershock-sequence outlook \u2014 Hindu Kush',
    forecastClass: 'post-event-conditional', forecastScope: 'event',
    country: 'Afghanistan', region: 'Hindu Kush', lat, lon,
    freezeTimestamp: iso(at), targetStart: iso(at), targetEnd: iso(at + 7 * 864e5)
  });
  const A = outlook('OUT-aftershock-A', 'quake-A', 35.0, 70.0, T0);
  const B = outlook('OUT-aftershock-B', 'quake-B', 36.5, 70.0, T0 + 864e5);
  const after = keptFor => ({ canonicalEventId: 'OBS-eq-A1', hazard: 'earthquake',
    significant: false, onset: iso(T0 + 2 * 864e5), magnitude: 4.3,
    geography: { country: 'Afghanistan', region: 'Hindu Kush', lat: 35.05, lon: 70.05 },
    keptFor });
  const grade2 = (p, sup) => V.verify(p, [], { now: Date.parse('2026-09-15T00:00:00Z'),
    hazardFamilyOf: H, observedCoverage: FULL_COVER, supportingEvents: [sup] });

  // Control: both claims really do accept it on hazard, window and geography.
  for (const p of [A, B]) {
    const claim = V.frozenClaim(Object.assign({ forecast: true }, p), H);
    assert.ok(V.geographyMatch(claim, after([])), p.id + ' does not even reach it');
  }

  // Recorded as quake A's: A is borne out, B is not.
  const onlyA = [{ claim: 'k-A', subject: 'quake-A' }];
  assert.equal(grade2(A, after(onlyA)).classification, 'HIT',
    'the sequence the observation belongs to was not credited');
  assert.notEqual(grade2(B, after(onlyA)).classification, 'HIT',
    'another quake\u2019s aftershock was counted as this sequence\u2019s activity');

  // Claimed by both: neither is graded on it, and both say why.
  const both = [{ claim: 'k-A', subject: 'quake-A' }, { claim: 'k-B', subject: 'quake-B' }];
  for (const p of [A, B]) {
    const v = grade2(p, after(both));
    assert.equal(v.classification, 'PENDING', p.id + ' claimed an observation it cannot claim alone');
    assert.equal(v.ungradeableReason, 'SEQUENCE_ATTRIBUTION_AMBIGUOUS');
    assert.match(v.classificationReason, /which sequence it belongs to/);
  }

  // A revision of the same claim is not a second sequence.
  const revised = [{ claim: 'k-A', subject: 'quake-A' }, { claim: 'k-A-extended', subject: 'quake-A' }];
  assert.equal(grade2(A, after(revised)).classification, 'HIT',
    'two rows about one mainshock were read as two sequences');

  // An observation with no recorded association establishes nothing.
  assert.notEqual(grade2(A, after([])).classification, 'HIT',
    'an observation that says nothing about whose it is was credited anyway');
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
  const mainshock = over => followed(Object.assign({
    canonicalEventId: 'OBS-eq-main', hazard: 'earthquake', significant: true,
    onset: '2026-09-03T12:00:00Z',
    geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
  }, over || {}));

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
  const mainshock = over => followed(Object.assign({
    canonicalEventId: 'OBS-eq-main', hazard: 'earthquake', significant: true,
    onset: '2026-09-03T12:00:00Z',
    geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
  }, over || {}));

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

/* ------------- what a hit needs, and what a false positive needs */

test('a disaster on record bears a forecast out whether or not an absence could have been shown', () => {
  /* The coverage gate ran before the matching loop, so a window the record
     could not cover came back PENDING even with a matching disaster sitting
     in the ledger. No flood, wildfire or volcano source is exhaustive, so no
     outlook for those hazards could ever be a hit — only ungradeable —
     however plainly it had been borne out. */
  const nothingWatching = { from: null, to: null, scans: 0, intervals: [] };
  const borneOut = grade(prediction(), [disaster()], { observedCoverage: nothingWatching });
  assert.equal(borneOut.classification, 'HIT',
    'a disaster inside the frozen geography and window did not bear out the forecast');
  assert.equal(borneOut.absenceEstablishable, false,
    'the verdict does not record that the opposite could not have been shown');

  /* And the asymmetry is not silently averaged away: a rate made only of the
     outcomes that could be found is not a rate. */
  const s = V.score([borneOut], []);
  assert.equal(s.precision, null, 'a precision was published from hits alone');
  assert.equal(s.hit, 0);
  assert.equal(s.hitsOutsideCoverage, 1, 'the hit was dropped rather than counted and named');

  // Nothing observed, and nothing watching: still ungradeable.
  const quiet = grade(prediction(), [], { observedCoverage: nothingWatching });
  assert.equal(quiet.classification, 'PENDING');
  assert.equal(quiet.ungradeableReason, 'OBSERVED_RECORD_EMPTY');

  // Nothing observed, with coverage: a false positive, and countable.
  const failed = grade(prediction(), []);
  assert.equal(failed.classification, 'MISS_FALSE_POSITIVE');
  assert.equal(failed.absenceEstablishable, true);
  assert.equal(V.score([failed], []).precision, 0);
});

test('a hazard nobody forecasts is not the engine failing to forecast it', () => {
  /* The hazard table states which onsets can be anticipated at all, and the
     methodology page says plainly that no agency forecasts the onset of an
     individual earthquake. Blaming the engine for that would have dominated
     the reason a disaster went unforecast, earthquakes being the hazard this
     record sees most of. */
  const HAZ = require(path.join(ROOT, 'hazard-model.js'));
  assert.equal(HAZ.HAZARDS.Earthquake.forecastable, false, 'fixture: the table should say so');
  const led = {
    retention: { detailFrom: '2026-09-01T00:00:00Z' },
    providers: { usgs: { hazards: ['Earthquake'], scope: { kind: 'global' },
      completeness: 'exhaustive', recordsObservations: true } },
    scans: [{ scanTimestamp: '2026-09-02T23:00:00Z', providers: [{ provider: 'usgs', status: 'SCANNED' }] }]
  };
  const quake = { canonicalEventId: 'OBS-eq', hazard: 'earthquake', hazardLabel: 'Earthquake',
    significant: true, onset: '2026-09-03T00:00:00Z',
    geography: { country: 'Nepal', lat: 27.7, lon: 85.3 } };
  const forecastable = e => {
    const h = HAZ.HAZARDS[e.hazardLabel];
    return h ? h.forecastable !== false : true;
  };

  const a = V.assessCoverage(quake, [], led, { hazardFamilyOf: H, hazardForecastable: forecastable });
  assert.equal(a.status, 'NOT_FORECASTABLE',
    'an unpredicted earthquake was attributed to the engine failing to forecast it');
  assert.equal(a.falseNegative, true,
    'it still happened and nothing predicted it: that is still a false negative');
  assert.match(a.reason, /not forecastable/i);

  /* A hazard the table does say is forecastable does not take this exit: the
     only provider up here covers earthquakes, so a flood is a gap in the
     sources rather than a hazard nobody forecasts. */
  const flood = Object.assign({}, quake, { hazard: 'flood', hazardLabel: 'Flood' });
  assert.equal(V.assessCoverage(flood, [], led, { hazardFamilyOf: H, hazardForecastable: forecastable }).status,
    'COVERAGE_FAILURE');

  /* And without the table the earthquake is still not the forecaster's
     failure, for the other reason: USGS is a catalogue of earthquakes that
     have happened, and scanning it puts nobody in a position to predict one.
     Two different exceptions, and this record meets both. */
  assert.equal(V.assessCoverage(quake, [], led, { hazardFamilyOf: H }).status,
    'NO_PROSPECTIVE_INPUT');
});

/* ------------------- one sequence's activity is not another sequence's */

/*
 * Two earthquakes 167 km and a day apart, each with its own seven-day
 * aftershock outlook.
 *
 * Every test in this group is about the same hole. Hazard, window and
 * geography are satisfied by a neighbouring sequence just as fully as by the
 * right one - the published earthquake tolerance is 300 km, and two quakes in
 * the same belt are routinely closer together than that - so those three
 * tests alone cannot tell whose activity was observed. Measured before this:
 * quake A's magnitude-6 aftershock graded quake B's outlook a HIT at 161 km,
 * and so did quake A's own death toll rising inside B's window, at 167 km.
 * Both verdicts read "a significant earthquake was observed inside the frozen
 * geography and window", which was true, and about the wrong earthquake.
 */
const T0 = Date.parse('2026-09-01T00:00:00Z');
const iso = ms => new Date(ms).toISOString();
const seqOutlook = (id, of, lat, at) => ({
  id, forecast: true, forecastKind: 'aftershock-sequence', forecastOf: of,
  forecastClass: 'post-event-conditional', forecastScope: 'event',
  type: 'Earthquake aftershock sequence', title: 'Aftershock-sequence outlook',
  country: 'Afghanistan', region: 'Hindu Kush', lat, lon: 70,
  issuedAt: iso(at), freezeTimestamp: iso(at),
  targetStart: iso(at), targetEnd: iso(at + 7 * 864e5)
});
const OUT_A = seqOutlook('OUT-A', 'quake-A', 35.0, T0);
const OUT_B = seqOutlook('OUT-B', 'quake-B', 36.5, T0 + 864e5);
const keptBy = subjects => subjects.map(s => ({ claim: 'k-' + s, subject: s }));
const quake = (id, over) => Object.assign({
  canonicalEventId: id, hazard: 'earthquake', significant: true,
  geography: { country: 'Afghanistan', region: 'Hindu Kush', lat: 35.05, lon: 70.05 }
}, over || {});
const seqGrade = (p, events) => V.verify(p, events,
  { now: Date.parse('2026-09-15T00:00:00Z'), hazardFamilyOf: H, observedCoverage: FULL_COVER });

test('fixture: the two sequences are close enough for each to accept the other’s events', () => {
  /* If this ever stops being true the three tests below stop testing
     anything, because geography alone would separate the sequences. */
  const apart = OBS.distanceKm(OUT_A.lat, OUT_A.lon, OUT_B.lat, OUT_B.lon);
  assert.ok(apart > 100 && apart < 300,
    'the fixture quakes are ' + Math.round(apart) + ' km apart, outside the range this tests');
  const claimB = V.frozenClaim(OUT_B, H);
  assert.ok(V.geographyMatch(claimB, quake('OBS-probe')),
    'quake A’s epicentre no longer falls inside outlook B’s frozen geography');
});

test('a significant aftershock of one sequence does not verify a neighbouring sequence', () => {
  const big = quake('OBS-eq-A-big', { onset: iso(T0 + 2 * 864e5), magnitude: 6,
    keptFor: keptBy(['quake-A']) });

  assert.equal(seqGrade(OUT_A, [big]).classification, 'HIT',
    'the sequence this aftershock actually belongs to was not credited with it');

  const b = seqGrade(OUT_B, [big]);
  assert.notEqual(b.classification, 'HIT',
    'one sequence’s aftershock was credited to a different quake’s outlook');
  assert.equal(b.observedEventIds.length, 0,
    'an event recorded as another sequence’s is cited as this outlook’s evidence');
  assert.match(b.classificationReason, /quake-B/,
    'the verdict does not say which disaster this outlook was about');
});

test('one disaster’s impact rising does not verify another disaster’s outlook', () => {
  /* The mainshock's own death toll, revised upward inside the neighbouring
     outlook's window. Its onset predates both windows, so it is graded on
     continued activity - which is exactly the path that read one quake's
     revision as evidence about another. */
  const mainA = quake('OBS-eq-A-main', { onset: iso(T0 - 3600e3), magnitude: 6.6, deaths: 40,
    geography: { country: 'Afghanistan', region: 'Hindu Kush', lat: 35, lon: 70 },
    revisions: [{ at: iso(T0 + 3 * 864e5), field: 'deaths', from: 12, to: 40 }],
    keptFor: keptBy(['quake-A']) });

  assert.equal(seqGrade(OUT_A, [mainA]).classification, 'HIT',
    'the sequence whose mainshock this is was not credited with its own toll rising');

  const b = seqGrade(OUT_B, [mainA]);
  assert.notEqual(b.classification, 'HIT',
    'a different quake’s death toll rising was read as this sequence continuing');
  assert.equal(b.observedEventIds.length, 0);
});

test('an observation the record does not attribute leaves the claim waiting, not failed', () => {
  /* The regression this pair of tests nearly shipped. "Recorded as someone
     else's" and "nothing recorded" were collapsed into one answer, so an
     observation with no association on record was dropped - and the window
     then closed with nothing matched and was called a false positive. That
     asserts an absence the record cannot establish, which is the one move
     this file exists to refuse. It waits instead. */
  const unattached = quake('OBS-eq-unattached', { onset: iso(T0 + 2 * 864e5), magnitude: 6 });
  const v = seqGrade(OUT_A, [unattached]);
  assert.equal(v.classification, 'PENDING',
    'an unattributed observation was turned into a verdict in either direction');

  /* And a blank subject is not an attribution either. */
  const blank = quake('OBS-eq-blank', { onset: iso(T0 + 2 * 864e5),
    keptFor: [{ claim: 'k-A', subject: null }] });
  assert.equal(seqGrade(OUT_A, [blank]).classification, 'PENDING',
    'an association with no subject was treated as naming one');
});

test('an observation two sequences both claim is counted for neither, and says so', () => {
  const shared = quake('OBS-eq-shared', { onset: iso(T0 + 2 * 864e5), magnitude: 6,
    keptFor: keptBy(['quake-A', 'quake-B']) });
  const v = seqGrade(OUT_A, [shared]);
  assert.equal(v.classification, 'PENDING',
    'an event two sequences both claim was credited to one of them');
  assert.equal(v.ungradeableReason, 'SEQUENCE_ATTRIBUTION_AMBIGUOUS');
  assert.match(v.classificationReason, /quake-B/,
    'the verdict does not name the other sequence that claims it');
});

test('a claim that follows no particular disaster is not gated on attribution', () => {
  /* Only the post-event-conditional class names a subject. A flood outlook is
     not about one prior flood, so requiring an association from it would make
     every ordinary forecast ungradeable. */
  assert.equal(grade(prediction(), [disaster()]).classification, 'HIT',
    'an independent prospective forecast now needs an attribution it never had');
});

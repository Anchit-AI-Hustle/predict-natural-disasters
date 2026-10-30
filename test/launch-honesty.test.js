'use strict';
/*
 * The track record a forecasting scientist will open first (launch audit C).
 *
 * Every figure on /accuracy and the forecast pages has to be one a reader can
 * reproduce from the committed ledgers, under the rule the site publishes.
 * Each block below is one finding of that audit, written as the behaviour
 * the site must have now.
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
const FULL_COVER = { from: '2000-01-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };
const prediction = over => Object.assign({
  id: 'OUT-test-1', type: 'Flood', title: '3-day Flood risk outlook - Nepal',
  country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3,
  forecastScope: 'country', forecastClass: 'continuation-outlook',
  freezeTimestamp: '2026-09-04T00:00:00Z',
  targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
}, over || {});
const disaster = over => Object.assign({
  canonicalEventId: 'OBS-flood-NEP-20260903T0000-n28e085',
  hazard: 'flood', significant: true, onset: '2026-09-03T00:00:00Z',
  geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
}, over || {});
const grade = (p, events, opts) => V.verify(p, events, Object.assign(
  { now: Date.parse('2026-09-10T00:00:00Z'), hazardFamilyOf: OBS.familyOf, observedCoverage: FULL_COVER }, opts || {}));

/* ------------------------------------------------------------------ C1 */

test('C1: an agency still listing the hazard does not make a restated alert correct', () => {
  for (const cls of ['continuation-outlook', 'warning-derived']) {
    const listed = disaster({
      impactLastUpdated: '2026-09-05T12:00:00Z',
      lastSeenAt: '2026-09-06T00:00:00Z',
      sightings: [{ from: '2026-09-03T00:00:00Z', to: '2026-09-09T00:00:00Z', fromScan: 's1', toScan: 's9' }]
    });
    const v = grade(prediction({ forecastClass: cls }), [listed]);
    assert.notEqual(v.classification, 'HIT', cls + ' was graded correct because the agency kept listing it');
    assert.notEqual(v.classification, 'PARTIAL_HIT', cls);
    /* With sources whose silence counts, no new impact is the forecast not coming true. */
    assert.equal(v.classification, 'MISS_FALSE_POSITIVE', cls);
    assert.match(v.classificationReason, /no new (damage|impact)/i);
  }
});

test('C1: a new impact reported inside the window is what bears a restated alert out', () => {
  const v = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 3, to: 11 }] })]);
  assert.equal(v.classification, 'HIT');
  assert.match(v.classificationReason, /deaths rose to 11/);
  /* A figure revised down is not a new impact. */
  const down = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 11, to: 3 }] })]);
  assert.notEqual(down.classification, 'HIT');
});

test('C1: where no source could show an absence, a restated alert stays ungraded rather than failed', () => {
  const v = grade(prediction(), [disaster({ lastSeenAt: '2026-09-06T00:00:00Z' })],
    { observedCoverage: { from: null, to: null } });
  assert.equal(v.classification, 'PENDING');
  assert.equal(v.gradeable, false);
});

test('C1: the checker version moved with the rule', () => {
  assert.equal(V.VERIFICATION_VERSION, 'verify-1.4.0');
  assert.equal(V.CONTINUATION_EVIDENCE['continuation-outlook'], 'new-impact');
  assert.equal(V.CONTINUATION_EVIDENCE['warning-derived'], 'new-impact');
});

test('C1: the methodology publishes the rule the checker applies', () => {
  const html = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.match(html, /still listing|still lists/i, 'methodology does not say an agency still listing a hazard is not a hit');
  assert.match(html, /new (damage|impact)/i);
  assert.match(html, /verify-1\.4\.0/);
});

/* ------------------------------------------------------------ C3, C7, C8 */

const M = require('../forecast-models.js');
const MG = require('../tools/model-grades.js');
const readData = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n), 'utf8'));
const town = () => ({ id: 'rain-town', lat: 10, lon: 10,
  heat: { p95: [40, 0, 0, 0, 0, 0, 0], p99: [43, 0, 0, 0, 0, 0, 0] },
  rain: { p99: Array(12).fill(20), p99x3: Array(12).fill(40) }, fire: { p95: Array(12).fill(30) } });
const dayList = (from, n) => Array.from({ length: n }, (_, i) => M.windowDays(from + 'T00:00:00Z', from + 'T23:59:59Z')[0])
  .map((d, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
const dry = n => Array.from({ length: n }, () => ({ tmax: 30, rain: 0, dew: 15, wind: 10 }));
const rainForecast = (id, start, end, issued) => ({ id, issuedAt: issued, recordedAt: issued,
  targetStart: start + 'T00:00:00Z', targetEnd: end + 'T23:59:59Z', model: { hazard: 'rain', placeId: 'rain-town' } });

test('C3: the committed grades are exactly what the committed inputs give', () => {
  const ledger = readData('model-ledger.json'), runs = readData('model-runs.json');
  const clim = readData('climatology.json'), archive = readData('model-measured.json');
  const published = readData('model-verdicts.json');
  const again = MG.buildVerdicts(ledger, runs, clim, archive);
  assert.deepEqual(published.counts, again.counts, 'data/model-verdicts.json does not follow from the committed files');
  assert.deepEqual(published.outlooks.map(o => o.id + ':' + o.verdict), again.outlooks.map(o => o.id + ':' + o.verdict));
  /* missedDays is the misses recomputed now, not a list only ever added to. */
  assert.equal(published.counts.missedDays, published.misses.length);
  assert.equal(published.counts.missedDays, again.misses.length);
  /* And it is gradePublished over the settled measurements, per hazard. */
  const placeBy = Object.fromEntries(clim.places.map(p => [p.id, p]));
  const known = new Set(ledger.map(o => o.id));
  const pub = runs.filter(r => (r.outlooks || []).every(id => known.has(id)));
  let misses = 0;
  for (const hz of ['heat', 'rain', 'fire']) {
    const observed = {};
    for (const pid of Object.keys(archive.places)) {
      const ob = placeBy[pid] && M.observedFromArchive(placeBy[pid], archive.places[pid]);
      if (ob) observed[pid] = { measured: hz === 'fire' ? ob.fireMeasured : ob.measured, heat: ob.heat, rain: ob.rain, fire: ob.fire };
    }
    misses += M.gradePublished(ledger.filter(o => o.model.hazard === hz), observed, pub).misses.filter(m => m.hazard === hz).length;
  }
  assert.equal(published.counts.missedDays, misses);
  /* Every graded verdict names the measurements it was graded on. */
  for (const o of published.outlooks.filter(x => x.verdict !== 'pending')) {
    assert.ok(Array.isArray(o.measured) && o.measured.length === o.windowDays, o.id + ' does not show what was measured');
  }
});

test('C3: a provisional measurement neither makes a hit nor a miss; a settled one is never revised', () => {
  /* The 27 Oct withdrawn rain hits: eight forecasts graded correct on rain
     POWER later revised away (Toronto, 16 to 18 Oct: more than 10 mm a day,
     revised to 7.5 mm, 0 and 0). Graded on provisional values, the hits
     came and went, while misses graded the same way were kept for good. */
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: '2026-06-20T10:00:00Z', places: { 'rain-town': {} } };
  const wet = dry(20); wet[9] = { tmax: 30, rain: 35, dew: 15, wind: 10 };   // 10 June
  M.mergeMeasured(archive.places['rain-town'], days, wet, '2026-06-20');      // 10 days old: provisional
  const ledger = [rainForecast('model-rain-rain-town-2026-06-10', '2026-06-10', '2026-06-10', '2026-06-08T09:00:00Z'),
    rainForecast('model-rain-rain-town-2026-06-12', '2026-06-12', '2026-06-12', '2026-06-08T09:00:00Z')];
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ledger.map(o => o.id) }];
  const clim = { places: [town()] };
  let g = M.gradeModelRecord(ledger, runs, clim, archive);
  assert.equal(g.outlooks[0].verdict, 'pending', 'a forecast was graded on a provisional measurement');
  assert.equal(g.counts.missedDays, 0);
  /* POWER revises the day before it settles: the rain was never there. */
  const revised = dry(20);
  M.mergeMeasured(archive.places['rain-town'], days, revised, '2026-06-25');  // 15 days old: settles
  g = M.gradeModelRecord(ledger, runs, clim, archive);
  assert.equal(g.outlooks[0].verdict, 'false alarm');
  /* A later fetch cannot move a settled day, in either direction. */
  M.mergeMeasured(archive.places['rain-town'], days, wet, '2026-07-01');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, archive).outlooks[0].verdict, 'false alarm');
  /* And misses follow the same rule: a provisional wet day at 11 June that
     is revised before it settles leaves no miss behind. */
  const a2 = { updatedAt: '2026-06-21T10:00:00Z', places: { 'rain-town': {} } };
  const wet11 = dry(20); wet11[10] = { tmax: 30, rain: 35, dew: 15, wind: 10 };
  M.mergeMeasured(a2.places['rain-town'], days, wet11, '2026-06-21');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a2).counts.missedDays, 0, 'a provisional day became a miss');
  M.mergeMeasured(a2.places['rain-town'], days, dry(20), '2026-06-26');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a2).counts.missedDays, 0, 'a stale miss survived the revision');
  M.mergeMeasured(a2.places['rain-town'], days, wet11, '2026-06-20');
  const a3 = { updatedAt: 'x', places: { 'rain-town': {} } };
  M.mergeMeasured(a3.places['rain-town'], days, wet11, '2026-06-26');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a3).counts.missedDays, 1, 'a settled crossing nobody forecast was not a miss');
});

test('C7: an ended forecast is graded whether or not a later run checked its place', () => {
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: 'x', places: { 'rain-town': {} } };
  M.mergeMeasured(archive.places['rain-town'], days, dry(20), '2026-07-01');
  const ledger = [rainForecast('model-rain-rain-town-2026-06-10', '2026-06-10', '2026-06-11', '2026-06-08T09:00:00Z')];
  /* Every run after the one that issued it skipped the place. */
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: [ledger[0].id] },
    { at: '2026-06-09T09:00:00Z', checked: [], leadDays: [1, 7], outlooks: [] }];
  const g = M.gradeModelRecord(ledger, runs, { places: [town()] }, archive);
  assert.equal(g.outlooks[0].verdict, 'false alarm', 'a skipped place kept its false alarm pending');
  /* And run-models measures such a place even when the forecast run skips it. */
  assert.deepEqual([...MG.needsGrading(ledger, { outlooks: [] }, '2026-06-20')], ['rain-town']);
  assert.deepEqual([...MG.needsGrading(ledger, { outlooks: [{ id: ledger[0].id, verdict: 'false alarm' }] }, '2026-06-20')], []);
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-models.js'), 'utf8');
  assert.match(src, /needsGrading/);
  assert.doesNotMatch(src, /prev && prev\.misses/, 'misses are still carried over from the previous file');
});

test('C8: overlapping re-issues are one claim, and every rate has a denominator and a chance figure', () => {
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: 'x', places: { 'rain-town': {} } };
  const w = dry(20); w[10] = { tmax: 30, rain: 35, dew: 15, wind: 10 };       // 11 June
  M.mergeMeasured(archive.places['rain-town'], days, w, '2026-07-05');
  const ledger = [rainForecast('a', '2026-06-10', '2026-06-12', '2026-06-08T09:00:00Z'),
    rainForecast('b', '2026-06-11', '2026-06-13', '2026-06-09T09:00:00Z'),
    rainForecast('c', '2026-06-18', '2026-06-18', '2026-06-12T09:00:00Z')];
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['a'] },
    { at: '2026-06-09T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['b'] },
    { at: '2026-06-12T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['c'] }];
  const g = M.gradeModelRecord(ledger, runs, { places: [town()] }, archive);
  assert.equal(g.counts.correct, 2, 'control: each forecast id has its own verdict');
  assert.deepEqual({ total: g.events.total, correct: g.events.correct, falseAlarms: g.events.falseAlarms }, { total: 2, correct: 1, falseAlarms: 1 },
    'two re-issues of one rainy spell counted as two successes');
  const t = g.days.rain;
  assert.equal(t.hits + t.falseAlarms + t.misses + t.correctNegatives, t.days);
  assert.equal(t.hits, 1); assert.equal(t.misses, 0);
  assert.equal(t.baseRate, Math.round(1 / t.days * 1e4) / 1e4);
  const a = g.outlooks.find(o => o.id === 'a');
  assert.equal(a.chance, Math.round((1 - Math.pow(1 - t.baseRate, 3)) * 1000) / 1000);
  assert.deepEqual(a.leadDays, [2, 4]);
});

test('C8: the confidence line quotes the lead the window covers', () => {
  const b = readData('model-backtest.json');
  const s = M.skillText(b, 'heat', 1, 7);
  assert.match(s, /days 1 to 7 ahead/);
  assert.match(s, /tested only on forecasts made 3 and 5 days ahead/);
  assert.match(s, /beyond 5 ahead were not tested/);
  assert.doesNotMatch(s, /–|—/);
  assert.match(M.skillText(b, 'fire', 2, 3), /only the last day/);
});

test('C11: model hazards are named for what they measure', () => {
  assert.equal(M.MODEL_HAZARDS.heat.word, 'Unusually hot days');
  assert.equal(M.MODEL_HAZARDS.rain.word, 'Unusually heavy rain');
  assert.equal(M.MODEL_HAZARDS.fire.word, 'High fire-weather index');
  const old = { title: 'Extreme heat forecast for Lima, 30 Oct to 5 Nov', model: { hazard: 'heat' } };
  assert.equal(M.modelDisplay(old).title, 'Unusually hot days forecast for Lima, 30 Oct to 5 Nov');
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-models.js'), 'utf8');
  assert.doesNotMatch(src, /usual worst/);
  assert.doesNotMatch(src, /'Heavy rain and flooding'|'Extreme heat'|'Wildfire weather'/);
});
